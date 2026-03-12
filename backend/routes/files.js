const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const auth = require('../middleware/auth');
const StudyFile = require('../models/StudyFile');

// Use memory storage: store extracted text in Mongo, not raw files.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 32,
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
});

const MAX_TEXT_CHARS = 20000;

function normalizeOriginalName(originalName) {
  const name = String(originalName || '');
  if (!name) return '';

  // Multer/busboy may decode header values as latin1.
  // Re-decode as utf8 to fix common Windows/Chinese filename mojibake.
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');

    // Heuristic: if decoded looks more reasonable than the original, use it.
    const looksBroken = (s) => /\uFFFD/.test(s) || /[ÃÂÐÑØÞ]/.test(s);
    if (looksBroken(name) || (!looksBroken(decoded) && decoded.trim().length > 0)) {
      return decoded;
    }
  } catch (e) {
    // ignore
  }
  return name;
}

async function extractTextFromUpload(file) {
  if (!file) return '';

  const safeOriginalName = normalizeOriginalName(file.originalname || '');
  const ext = path.extname(safeOriginalName || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();

  // Plain text-like
  const isTextLike =
    mime.startsWith('text/') ||
    ['.txt', '.md', '.markdown', '.json', '.csv', '.log'].includes(ext);

  if (isTextLike) {
    return (file.buffer || Buffer.from('')).toString('utf8');
  }

  // PDF (optional dependency)
  const isPdf = mime === 'application/pdf' || ext === '.pdf';
  if (isPdf) {
    try {
      // Lazy require so dev still works if pdf-parse not installed yet.
      // eslint-disable-next-line global-require
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      return data && data.text ? String(data.text) : '';
    } catch (e) {
      return '';
    }
  }

  // Fallback: do not try to parse binary formats.
  return '';
}

function normalizeText(text) {
  const t = String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (t.length <= MAX_TEXT_CHARS) return t;
  // Keep head+tail to preserve context variety.
  const head = t.slice(0, 12000);
  const tail = t.slice(-8000);
  return `${head}\n\n...（中间内容已截断）...\n\n${tail}`;
}

function normalizeNameForResponse(name) {
  const normalized = normalizeOriginalName(name);
  // As a last resort, keep something non-empty to show in UI
  return normalized && String(normalized).trim() ? normalized : String(name || '');
}

// @route   POST /api/files/upload
// @desc    Upload study files and store extracted text
// @access  Private
router.post('/upload', auth, upload.array('files', 32), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ msg: 'No files uploaded. Use form-data field "files".' });
    }

    const created = [];
    for (const file of files) {
      const originalName = normalizeOriginalName(file.originalname);
      const rawText = await extractTextFromUpload(file);
      const text = normalizeText(rawText);

      const doc = await StudyFile.create({
        user: req.user.id,
        originalName,
        mimeType: file.mimetype,
        size: file.size,
        text,
        textLength: text.length,
      });

      created.push({
        _id: doc._id,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        textLength: doc.textLength,
        createdAt: doc.createdAt,
      });
    }

    return res.json({ files: created });
  } catch (err) {
    // Multer errors are also caught here
    console.error('Upload files error:', err);
    return res.status(500).json({ msg: 'Failed to upload files.' });
  }
});

// @route   GET /api/files
// @desc    List current user's study files
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const docs = await StudyFile.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .select('_id originalName mimeType size textLength createdAt updatedAt');

    // Normalize names for UI display (fix legacy mojibake without DB rewrite)
    return res.json(
      docs.map((d) => {
        const obj = d.toObject ? d.toObject() : d;
        return {
          ...obj,
          originalName: normalizeNameForResponse(obj.originalName),
        };
      })
    );
  } catch (err) {
    console.error('List files error:', err);
    return res.status(500).json({ msg: 'Failed to list files.' });
  }
});

// @route   DELETE /api/files
// @desc    Delete ALL current user's study files (bulk)
// @access  Private
router.delete('/', auth, async (req, res) => {
  try {
    const result = await StudyFile.deleteMany({ user: req.user.id });
    return res.json({ deleted: result && typeof result.deletedCount === 'number' ? result.deletedCount : 0 });
  } catch (err) {
    console.error('Bulk delete files error:', err);
    return res.status(500).json({ msg: 'Failed to delete files.' });
  }
});

// @route   DELETE /api/files/:id
// @desc    Delete a study file
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await StudyFile.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!doc) return res.status(404).json({ msg: 'File not found.' });
    return res.json({ msg: 'Deleted.' });
  } catch (err) {
    console.error('Delete file error:', err);
    return res.status(500).json({ msg: 'Failed to delete file.' });
  }
});

module.exports = router;
