// routes/knowledgePoints.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth'); // 引入认证中间件
const KnowledgePoint = require('../models/KnowledgePoint');
const { addKnowledgePointToStore, rebuildVectorStoreForUser } = require('../services/vectorStoreService');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const purify = DOMPurify(window);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: 2 * 1024 * 1024, // 2MB
    },
});

function normalizeOriginalName(originalName) {
    const name = String(originalName || '');
    if (!name) return '';
    try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        const looksBroken = (s) => /\uFFFD/.test(s) || /[ÃÂÐÑØÞ]/.test(s);
        if (looksBroken(name) || (!looksBroken(decoded) && decoded.trim().length > 0)) {
            return decoded;
        }
    } catch (e) {
        // ignore
    }
    return name;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Convert plain text into Quill-friendly HTML (<p> blocks)
function textToQuillHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const html = lines
        .map((line) => {
            const trimmed = String(line || '');
            if (!trimmed) return '<p><br/></p>';
            return `<p>${escapeHtml(trimmed)}</p>`;
        })
        .join('');
    return html || '<p><br/></p>';
}

// @route   POST /api/knowledge-points/import-txt
// @desc    上传 TXT 并解析为知识点内容（用于“新建知识点”页面导入）
// @access  Private
router.post('/import-txt', auth, upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ msg: 'No file uploaded. Use form-data field "file".' });
        }

        const originalName = normalizeOriginalName(file.originalname || '');
        const ext = path.extname(originalName).toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();

        const isTxt = ext === '.txt' || mime === 'text/plain';
        if (!isTxt) {
            return res.status(400).json({ msg: 'Only .txt files are supported for knowledge point import.' });
        }

        const raw = (file.buffer || Buffer.from('')).toString('utf8');
        const text = String(raw || '').replace(/\u0000/g, '').trim();
        if (!text) {
            return res.status(400).json({ msg: 'The uploaded TXT file is empty.' });
        }

        const defaultTitle = originalName ? path.basename(originalName, ext) : '导入的知识点';

        // Return sanitized HTML to match current editor storage format
        const contentHtml = purify.sanitize(textToQuillHtml(text));

        return res.json({
            title: purify.sanitize(defaultTitle),
            content: contentHtml,
            textLength: text.length,
            originalName,
        });
    } catch (err) {
        console.error(err.message);
        return res.status(500).send('Server Error');
    }
});

// @route   GET /api/knowledge-points/categories
// @desc    获取当前用户的所有分类
// @access  Private
router.get('/categories', auth, async (req, res) => {
    try {
        const categories = await KnowledgePoint.distinct('category', { user: req.user.id });
        // 过滤掉 null 或空字符串，并确保 '默认分类' 总是存在（如果前端需要，或者前端自己处理）
        const cleanCategories = categories.filter(c => c).sort();
        res.json(cleanCategories);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/knowledge-points
// @desc    创建一个新的知识点
// @access  Private (需要登录)
router.post('/', auth, async (req, res) => { // 在这里使用auth中间件
    try {
        const { title, content, category } = req.body;

        // 消毒用户输入
        const sanitizedTitle = purify.sanitize(title);
        const sanitizedContent = purify.sanitize(content);
        const sanitizedCategory = category ? purify.sanitize(category) : '默认分类';

        const newKp = new KnowledgePoint({
            title: sanitizedTitle,
            content: sanitizedContent,
            category: sanitizedCategory,
            user: req.user.id // 从auth中间件附加的req.user中获取用户ID
        });
        const kp = await newKp.save();

        // 异步调用，无需等待其完成即可返回响应给用户，提升体验
        addKnowledgePointToStore(kp);

        res.json(kp);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/knowledge-points
// @desc    获取当前用户的所有知识点（返回前进行消毒，防止数据库中存在未清洗的内容）
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
        const safeKps = kps.map(kp => ({
            _id: kp._id,
            user: kp.user,
            title: purify.sanitize(kp.title),
            content: purify.sanitize(kp.content),
            category: kp.category || '默认分类',
            status: kp.status,
            createdAt: kp.createdAt,
            updatedAt: kp.updatedAt
        }));
        res.json(safeKps);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/knowledge-points/reindex
// @desc    重建当前用户的知识库向量索引（用于修复“录入了但检索不到”的情况）
// @access  Private
router.post('/reindex', auth, async (req, res) => {
    try {
        const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
        const result = await rebuildVectorStoreForUser(req.user.id, kps);
        res.json({ msg: 'Vector store rebuilt', count: kps.length, ...result });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/knowledge-points/:id
// @desc    获取单个知识点详情（返回前进行消毒）
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const kp = await KnowledgePoint.findById(req.params.id);
        if (!kp) return res.status(404).json({ msg: 'Knowledge point not found' });
        if (kp.user && kp.user.toString && kp.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });
        const safeKp = {
            _id: kp._id,
            user: kp.user,
            title: purify.sanitize(kp.title),
            content: purify.sanitize(kp.content),
            category: kp.category || '默认分类',
            status: kp.status,
            createdAt: kp.createdAt,
            updatedAt: kp.updatedAt
        };
        res.json(safeKp);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/knowledge-points/:id
// @desc    更新一个知识点
// @access  Private
router.put('/:id', auth, async (req, res) => {
    try {
        const { title, content, status, category } = req.body;

        let updateFields = {};
        if (title) updateFields.title = purify.sanitize(title);
        if (content) updateFields.content = purify.sanitize(content);
        if (category) updateFields.category = purify.sanitize(category);
        if (status) updateFields.status = status;

        let kp = await KnowledgePoint.findById(req.params.id);
        if (!kp) return res.status(404).json({ msg: 'Knowledge point not found' });
        // 确保是该用户自己的知识点
        if (kp.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        const oldContent = kp.content;

        kp = await KnowledgePoint.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true } // 返回更新后的文档
        );

        // 当内容发生变化时，才重新索引
        if (typeof updateFields.content !== 'undefined' && kp.content !== oldContent) {
            addKnowledgePointToStore(kp);
        }

        res.json(kp);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/knowledge-points/sanitize
// @desc    清理数据库中的知识点（移除恶意内容）
// @access  Private
router.get('/sanitize', auth, async (req, res) => {
    try {
        const kps = await KnowledgePoint.find();
        for (const kp of kps) {
            kp.title = purify.sanitize(kp.title);
            kp.content = purify.sanitize(kp.content);
            await kp.save();
        }
        res.json({ msg: 'Knowledge points sanitized' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/knowledge-points/:id
// @desc    删除一个知识点，并同步重建当前用户的向量索引（确保 AI 立即无法检索到已删除内容）
// @access  Private
router.delete('/:id', auth, async (req, res) => {
    try {
        const kp = await KnowledgePoint.findById(req.params.id);
        if (!kp) return res.status(404).json({ msg: 'Knowledge point not found' });

        // 确保是该用户自己的知识点
        if (kp.user && kp.user.toString && kp.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        await KnowledgePoint.deleteOne({ _id: kp._id });

        // 删除后立即重建该用户索引，避免向量库残留导致“删除了还能回答”
        const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
        await rebuildVectorStoreForUser(req.user.id, kps);

        return res.json({ msg: 'Deleted.', rebuilt: true, remaining: kps.length });
    } catch (err) {
        console.error(err.message);
        return res.status(500).send('Server Error');
    }
});

module.exports = router;
