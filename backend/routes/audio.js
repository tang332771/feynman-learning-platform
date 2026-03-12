const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { transcribeAudio, transcodeAudio, evaluateFeynmanAttempt } = require('../controllers/baiduAiController');

// 使用内存存储，文件会暴露在 req.file.buffer 中
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/audio/transcribe  —— 任意格式转码为 16k wav 后再识别
router.post('/transcribe', auth, upload.single('audio'), transcribeAudio);

// POST /api/audio/transcode  —— 仅做转码并返回 wav(16k, mono)
router.post('/transcode', auth, upload.single('audio'), transcodeAudio);

// POST /api/audio/evaluate —— AI 评价
router.post('/evaluate', auth, evaluateFeynmanAttempt);

module.exports = router;
