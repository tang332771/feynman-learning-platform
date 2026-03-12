const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateQuestion, gradeAnswer, answerWithRAG, generateQuestionFromFiles, generateRiddleGame } = require('../controllers/baiduAiController');

// @route   POST /api/ai/generate-question
// @desc    Generate a quiz question based on knowledge point content
// @access  Private
router.post('/generate-question', auth, generateQuestion);

// @route   POST /api/ai/generate-riddle
// @desc    Generate a riddle game based on a random knowledge point
// @access  Private
router.post('/generate-riddle', auth, generateRiddleGame);

// @route   POST /api/ai/generate-question-from-files
// @desc    Randomly pick one uploaded study file and generate a question
// @access  Private
router.post('/generate-question-from-files', auth, generateQuestionFromFiles);

// @route   POST /api/ai/grade-answer
// @desc    Grade a short answer question using AI
// @access  Private
router.post('/grade-answer', auth, gradeAnswer);

// @route   POST /api/ai/rag-qa
// @desc    Answer questions using RAG (Retrieval Augmented Generation)
// @access  Private
router.post('/rag-qa', auth, answerWithRAG);

module.exports = router;
