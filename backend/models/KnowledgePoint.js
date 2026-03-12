// models/KnowledgePoint.js
        const mongoose = require('mongoose');

        const KnowledgePointSchema = new mongoose.Schema({
            user: { // 关联到用户
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User' // 引用User模型
            },
            title: {
                type: String,
                required: true
            },
            content: { // 存放Markdown, LaTeX, Mermaid等原始内容
                type: String,
                required: true
            },
            category: {
                type: String,
                default: '默认分类'
            },
            status: { // 学习状态： 'not_started', 'in_progress', 'mastered'
                type: String,
                default: 'not_started'
            }
        }, { timestamps: true });

        module.exports = mongoose.model('KnowledgePoint', KnowledgePointSchema);
