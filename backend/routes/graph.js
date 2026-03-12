const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const purify = DOMPurify(window);

// @route   GET /api/graph/knowledge-map
// @desc    获取知识图谱数据（ECharts graph: nodes + links）
// @access  Private
router.get('/knowledge-map', auth, async (req, res) => {
    try {
        const kps = await KnowledgePoint.find({ user: req.user.id });

        if (!kps || kps.length === 0) {
            return res.json({ nodes: [], links: [] });
        }

        const nodes = kps.map((kp) => {
            const safeTitle = purify.sanitize(kp.title);
            const safeContent = purify.sanitize(kp.content);
            return {
                id: kp._id.toString(),
                name: safeTitle,
                value: safeContent.substring(0, 100),
                category: kp.category || '默认分类',
                symbolSize: 20 + Math.min(safeContent.length / 50, 30),
                status: kp.status,
            };
        });

        const links = [];

        const getEvidence = (content, needle) => {
            const text = String(content || '');
            const key = String(needle || '').trim();
            if (!text || !key) return '';
            const idx = text.indexOf(key);
            if (idx === -1) return '';
            const before = Math.max(0, idx - 24);
            const after = Math.min(text.length, idx + key.length + 24);
            const snippet = text.slice(before, after).replace(/\s+/g, ' ').trim();
            return snippet;
        };

        for (const sourceKp of kps) {
            for (const targetKp of kps) {
                if (sourceKp._id.toString() === targetKp._id.toString()) continue;

                const sourceContent = sourceKp.content || '';
                const targetTitle = targetKp.title || '';
                if (!targetTitle) continue;

                if (sourceContent.includes(targetTitle)) {
                    links.push({
                        source: sourceKp._id.toString(),
                        target: targetKp._id.toString(),
                        relation: '引用',
                        matchType: 'title-mention',
                        evidence: purify.sanitize(getEvidence(sourceContent, targetTitle)),
                        label: { show: true, formatter: '引用' },
                    });
                }
            }
        }

        return res.json({ nodes, links });
    } catch (error) {
        console.error('Error generating knowledge graph:', error);
        return res.status(500).send('Server Error');
    }
});

module.exports = router;
