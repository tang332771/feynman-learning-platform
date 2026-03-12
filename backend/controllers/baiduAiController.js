const axios = require('axios');
const AipSpeechClient = require("baidu-aip-sdk").speech;
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const vectorStoreService = require('../services/vectorStoreService');
const StudyFile = require('../models/StudyFile');
const KnowledgePoint = require('../models/KnowledgePoint');

// Avoid rebuilding too frequently (in-memory throttle per user)
const __ragRebuildThrottle = new Map();
const RAG_REBUILD_COOLDOWN_MS = 5 * 60 * 1000;

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

// 从环境变量中获取凭证
const APP_ID = process.env.BAIDU_APP_ID;
const API_KEY = process.env.BAIDU_API_KEY;
const SECRET_KEY = process.env.BAIDU_SECRET_KEY;

// 优先使用 ASR 专用环境变量，否则回退到通用变量
const ASR_APP_ID = process.env.BAIDU_ASR_APP_ID || APP_ID;
const ASR_API_KEY = process.env.BAIDU_ASR_API_KEY || API_KEY;
const ASR_SECRET_KEY = process.env.BAIDU_ASR_SECRET_KEY || SECRET_KEY;

// 新建一个AipSpeechClient对象
const client = new AipSpeechClient(ASR_APP_ID, ASR_API_KEY, ASR_SECRET_KEY);

// 使用本地 ffmpeg 将任意音频转码为 16k 单声道 WAV（PCM16）缓冲区
async function convertToWav16k(buffer) {
    return new Promise((resolve, reject) => {
        const ffmpegPath = process.env.FFMPEG_PATH || path.resolve(__dirname, '..', 'ffmpeg.exe');
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'];
        const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        const chunks = [];
        ff.stdout.on('data', (d) => chunks.push(d));
        let errMsg = '';
        ff.stderr.on('data', (d) => { errMsg += d.toString(); });
        ff.on('error', reject);
        ff.on('close', (code) => {
            if (code === 0) return resolve(Buffer.concat(chunks));
            reject(new Error(`ffmpeg failed (${code}): ${errMsg}`));
        });
        ff.stdin.write(buffer);
        ff.stdin.end();
    });
}

exports.transcribeAudio = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ msg: 'No audio file uploaded.' });
    }

    try {
        const wav16k = await convertToWav16k(req.file.buffer);
        const result = await client.recognize(wav16k, 'wav', 16000, { dev_pid: 1537 });
        if (result.err_no === 0) {
            return res.json({ result: result.result[0] });
        }
        return res.status(500).json({ msg: 'Baidu ASR service error', error: result });
    } catch (error) {
        console.error('Transcription error:', error);
        return res.status(500).json({ msg: 'Server error during transcription.', error: String(error) });
    }
};

exports.transcodeAudio = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ msg: 'No audio file uploaded.' });
    }
    try {
        const wav16k = await convertToWav16k(req.file.buffer);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `inline; filename="${(req.file.originalname || 'audio').replace(/\.[^/.]+$/, '')}.wav"`);
        return res.status(200).send(wav16k);
    } catch (error) {
        console.error('Transcode error:', error);
        return res.status(500).json({ msg: 'Server error during transcode.', error: String(error) });
    }
};

// --- 大模型相关 ---

async function getQianfanAccessToken() {
    const apiKey = (process.env.BAIDU_API_KEY || process.env.QIANFAN_API_KEY || '').trim();
    const secretKey = (process.env.BAIDU_SECRET_KEY || process.env.QIANFAN_SECRET_KEY || '').trim();

    if (!apiKey || !secretKey) {
        throw new Error('Missing BAIDU/QIANFAN API key or secret key');
    }

    // In-memory cache (V1 access token)
    if (!global.__QIANFAN_ACCESS_TOKEN_CACHE) {
        global.__QIANFAN_ACCESS_TOKEN_CACHE = { token: null, expiresAt: 0 };
    }
    const cache = global.__QIANFAN_ACCESS_TOKEN_CACHE;
    if (cache.token && Date.now() < cache.expiresAt) {
        return cache.token;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
    const fetchOnce = async () => {
        const response = await axios.post(url, null, { timeout: 15000 });
        const token = response?.data?.access_token;
        const expiresIn = Number(response?.data?.expires_in || 0);
        if (!token) throw new Error('Failed to get Access Token');
        // refresh 60s earlier
        cache.token = token;
        cache.expiresAt = Date.now() + Math.max(0, expiresIn - 60) * 1000;
        return token;
    };

    try {
        return await fetchOnce();
    } catch (error) {
        const msg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error getting Qianfan Access Token:', msg);
        // Retry once on transient failures
        try {
            return await fetchOnce();
        } catch (e2) {
            const msg2 = e2.response ? JSON.stringify(e2.response.data) : e2.message;
            console.error('Error getting Qianfan Access Token (retry):', msg2);
            throw new Error('Failed to get Access Token');
        }
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isTransientAxiosError(error) {
    const code = error?.code;
    const status = error?.response?.status;
    const message = String(error?.message || '').toLowerCase();
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EAI_AGAIN') return true;
    if (status && status >= 500) return true;
    if (message.includes('timeout') || message.includes('network')) return true;
    return false;
}

async function callBaiduAI(messages) {
    // 优先使用 QIANFAN_API_KEY (V3)，如果不存在则尝试 BAIDU_API_KEY
    const apiKey = (process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY || '').trim();
    
    console.log('callBaiduAI called with apiKey prefix:', apiKey.substring(0, 10));

    if (apiKey.startsWith('bce-v3')) {
        // V2 API (ModelBuilder)
        const url = "https://qianfan.baidubce.com/v2/chat/completions";
        const sendOnce = async () => {
            console.log('Sending request to V2 API...');
            const response = await axios.post(url, {
                model: "ernie-speed-8k",
                messages: messages
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 60000 // 60s timeout
            });

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content;
            }
            console.error('Unexpected V2 API response structure:', JSON.stringify(response.data));
            return undefined;
        };

        try {
            return await sendOnce();
        } catch (error) {
            console.error("V2 API Error:", error.response ? error.response.data : error.message);
            if (isTransientAxiosError(error)) {
                await sleep(600);
                try {
                    return await sendOnce();
                } catch (e2) {
                    console.error("V2 API Error (retry):", e2.response ? e2.response.data : e2.message);
                    throw e2;
                }
            }
            throw error;
        }
    } else {
        // V1 API (Console)
        const accessToken = await getQianfanAccessToken();
        const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed?access_token=${accessToken}`;
        const sendOnce = async () => {
            const response = await axios.post(url, { messages: messages }, { timeout: 60000 });
            return response.data.result;
        };
        try {
            return await sendOnce();
        } catch (error) {
            console.error("V1 API Error:", error.response ? error.response.data : error.message);
            if (isTransientAxiosError(error)) {
                await sleep(600);
                try {
                    return await sendOnce();
                } catch (e2) {
                    console.error("V1 API Error (retry):", e2.response ? e2.response.data : e2.message);
                    throw e2;
                }
            }
            throw error;
        }
    }
}

function tryParseJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        let jsonStr = String(text);

        // Strip common Markdown fences like ```json ... ```
        jsonStr = jsonStr.replace(/^\s*```[a-zA-Z0-9_-]*\s*/m, '');
        jsonStr = jsonStr.replace(/\s*```\s*$/m, '');

        // Prefer extracting the first JSON object/array block
        const firstObj = jsonStr.indexOf('{');
        const lastObj = jsonStr.lastIndexOf('}');
        const firstArr = jsonStr.indexOf('[');
        const lastArr = jsonStr.lastIndexOf(']');

        if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
            jsonStr = jsonStr.substring(firstObj, lastObj + 1);
        } else if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
            jsonStr = jsonStr.substring(firstArr, lastArr + 1);
        }

        // Remove trailing commas before closing braces/brackets (common LLM mistake)
        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

        const obj = JSON.parse(jsonStr);
        return obj && typeof obj === 'object' ? obj : null;
    } catch {
        return null;
    }
}

// 题目质量控制：禁止生成“作业/任务/写代码/改项目”类指令题
function isLikelyAssignmentStyleQuestion(questionText) {
    const q = String(questionText || '').trim();
    if (!q) return true;

    // Too long usually indicates pasted instructions
    if (q.length > 140) return true;

    // Obvious instruction/task patterns
    const instructionStarts = /^(请|请你|请按照|按|根据|参考|遵循).{0,10}(上述|以下|给定|提供|步骤|指导)/;
    if (instructionStarts.test(q)) return true;

    // Coding/task verbs combined with engineering nouns
    const taskVerbs = /(修改|实现|编写|完成|搭建|配置|重构|封装|优化|开发|联调|部署|提交|创建|生成|设计|实现一下|改造)/;
    const engineeringNouns = /(代码|项目|工程|接口|API|前端|后端|组件|页面|路由|请求|数据库|服务|鉴权|Axios|React|Vue|Node|Express|Context|Hooks?)/i;
    if (taskVerbs.test(q) && engineeringNouns.test(q)) return true;

    // Explicit “use X” tasks are typically unanswerable in chat without a codebase
    const useX = /(使用|采用|基于).{0,12}(Axios|React|Vue|Node|Express|Context|Hooks?|TypeScript|Vite)/i;
    if (useX.test(q)) return true;

    return false;
}

function normalizeQuestionShape(jsonResult, fallbackRawText) {
    if (!jsonResult || typeof jsonResult !== 'object') return jsonResult;

    const looksLikeInstructionEcho = (s) => {
        const t = String(s || '').trim();
        if (!t) return true;
        // Common failure: model repeats the instruction instead of producing a concrete question.
        return (
            /^请根据/.test(t) ||
            /生成一道/.test(t) ||
            /严格以纯JSON格式返回/.test(t) ||
            /不要包含Markdown/.test(t) ||
            /知识点内容/.test(t) ||
            /返回格式/.test(t)
        );
    };

    const pickFirstString = (obj, keys) => {
        for (const k of keys) {
            const v = obj[k];
            if (typeof v === 'string' && v.trim()) return v;
        }
        return '';
    };

    if (!jsonResult.question || (typeof jsonResult.question === 'string' && !jsonResult.question.trim())) {
        const q = pickFirstString(jsonResult, [
            'question',
            '题目',
            '问题',
            'prompt',
            'stem',
            'title',
            '题干',
            'questionText',
        ]);
        if (q) jsonResult.question = q;
    }

    if (jsonResult.explanation && typeof jsonResult.explanation !== 'string') {
        jsonResult.explanation = String(jsonResult.explanation);
    }
    if (jsonResult.answer && typeof jsonResult.answer !== 'string') {
        jsonResult.answer = String(jsonResult.answer);
    }

    // If still no question, mark as failed and attach raw for debugging.
    if (!jsonResult.question || (typeof jsonResult.question === 'string' && !jsonResult.question.trim())) {
        jsonResult.question = '题目生成失败，请重试。';
        if (!jsonResult.explanation) jsonResult.explanation = String(fallbackRawText || '');
        jsonResult.generationOk = false;
    }

    // If question is just an instruction echo, treat as failed.
    if (jsonResult.question && looksLikeInstructionEcho(jsonResult.question)) {
        jsonResult.question = '题目生成失败，请重试。';
        if (!jsonResult.explanation) jsonResult.explanation = String(fallbackRawText || '');
        jsonResult.generationOk = false;
    }

    return jsonResult;
}

exports.evaluateFeynmanAttempt = async (req, res) => {
    const { originalContent, transcribedText } = req.body;

    if (!originalContent || !transcribedText) {
        return res.status(400).json({ msg: 'Original content and transcribed text are required.' });
    }

    try {
        const safeDeterministicPolish = (text) => {
            let t = String(text || '').trim();
            if (!t) return '';

            // normalize whitespace
            t = t.replace(/\s+/g, ' ');

            // collapse suspicious duplicated chinese characters (typos like "鲁鲁迅"), but keep common interjections
            const allowRepeat = new Set(['哈', '呵', '嘿', '啊', '嗯', '哦', '呀', '哇']);
            const chars = Array.from(t);
            const out = [];
            for (let i = 0; i < chars.length; i++) {
                const cur = chars[i];
                const prev = out.length ? out[out.length - 1] : '';
                const next = i + 1 < chars.length ? chars[i + 1] : '';
                const isCjk = (c) => /[\u4e00-\u9fff]/.test(c);

                if (cur === prev && isCjk(cur) && !allowRepeat.has(cur)) {
                    // if the next is a chinese char/letter/number, it's likely a duplicated typo
                    if (next && (isCjk(next) || /[A-Za-z0-9]/.test(next))) {
                        continue;
                    }
                }
                out.push(cur);
            }
            t = out.join('');

            // light punctuation normalization
            t = t.replace(/[，,]\s*[。.!！?？]/g, '。');
            t = t.replace(/\s*([。.!！?？])/g, '$1');

            // add comma after a short subject if pattern fits (e.g., “鲁迅原名...”)
            t = t.replace(/^(.{1,12}?)(原名)/, '$1，$2');

            // ensure it ends with a Chinese period if it looks like a sentence
            if (!/[。.!！?？]$/.test(t)) {
                t += '。';
            }
            return t;
        };

        const looksExpanded = (polished, original) => {
            const p = String(polished || '').trim();
            const o = String(original || '').trim();
            if (!p) return true;
            if (!o) return false;
            // If model adds a lot more text, treat as expansion
            if (p.length > Math.max(o.length * 1.25, o.length + 30)) return true;
            // If it introduces many more sentences, treat as expansion
            const countSent = (s) => (String(s || '').match(/[。.!！?？]/g) || []).length;
            if (countSent(p) > countSent(o) + 1) return true;
            return false;
        };

        const prompt = `
        你是一个严格而友善的计算机科学学习教练。你的任务是评估学生对一个知识点的复述，并给出反馈。

        【原始知识点】:
        ${originalContent}

        【学生的复述】:
        ${transcribedText}

        请从以下几个维度进行评估，并以纯JSON格式返回结果（不要包含Markdown代码块标记）：
        1.  **score**: 0-100分，基于复述的准确性、完整性和逻辑清晰度。
        2.  **evaluation**: 一段简短的评语，指出学生理解得好的地方和误解的地方。
        3.  **polishedText**: 只对【学生的复述】进行“润色改写”，严禁补充/扩写任何新事实信息。
            - 只能做：改错别字、去重复、补标点、让表达更通顺。
            - 严禁做：添加背景介绍、补充生平/定义/例子、引入原文里没有的新观点。
            - 输出长度不要明显变长（最多比原复述长20%），不要新增多句解释。
        4.  **strengths**: 数组，列出2-3个优点。
        5.  **weaknesses**: 数组，列出2-3个待改进之处。

        返回格式示例：
        {
            "score": 85,
            "evaluation": "你对核心概念的理解很到位...",
            "polishedText": "...",
            "strengths": ["理解准确", "举例恰当"],
            "weaknesses": ["术语使用不够规范"]
        }
        `;

        const resultText = await callBaiduAI([{ role: 'user', content: prompt }]);
        
        let llmResult;
        try {
            let jsonStr = resultText;
            const firstOpen = resultText.indexOf('{');
            const lastClose = resultText.lastIndexOf('}');
            
            if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
                jsonStr = resultText.substring(firstOpen, lastClose + 1);
            }
            
            llmResult = JSON.parse(jsonStr);
        } catch (e) {
            console.error('Failed to parse LLM result:', resultText);
            llmResult = { 
                evaluation: resultText, 
                score: 0,
                polishedText: '',
                strengths: [],
                weaknesses: []
            }; 
        }

        // Guardrail: polishedText must be a rewrite, not an expansion.
        try {
            const polished = typeof llmResult.polishedText === 'string' ? llmResult.polishedText : '';
            if (looksExpanded(polished, transcribedText)) {
                llmResult.polishedText = safeDeterministicPolish(transcribedText);
            }
        } catch (_) {
            llmResult.polishedText = safeDeterministicPolish(transcribedText);
        }

        res.json(llmResult);

    } catch (error) {
        console.error('Error calling LLM API for grading:', error.message);
        res.status(500).json({ 
            msg: 'Server error during grading.',
            mockData: {
                score: 0,
                evaluation: "服务器连接AI服务超时，请检查网络或API Key配置。",
                polishedText: "",
                strengths: [],
                weaknesses: []
            }
        });
    }
};

exports.answerWithRAG = async (req, res) => {
    const { question, history } = req.body;
    if (!question) {
        return res.status(400).json({ msg: 'Question is required.' });
    }

    const isGreeting = (q) => {
        const t = String(q || '').trim();
        if (!t) return false;
        return /^(你好|您好|在吗|嗨|hi|hello|hey|哈喽)[\s\S]*$/i.test(t);
    };

    const normalizeHistory = (h) => {
        if (!Array.isArray(h)) return [];
        return h
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
    };

    const wantsSimilarities = (q) => /相同|共同|一样|共性/.test(String(q || ''));
    const wantsDifferences = (q) => /不同|差异|区别|差别/.test(String(q || ''));

    const isFollowUpMore = (q) => /还有更多|更多吗|再说说|继续|展开|详细|补充|进一步|更具体|能再多讲|能讲多一点/.test(String(q || ''));

    const isGenericSmallTalk = (q) => {
        const t = String(q || '').trim();
        if (!t) return true;
        // Generic continuation / acknowledgement that usually lacks topic keywords
        if (isFollowUpMore(t)) return true;
        if (/^(?:嗯|哦|好|好的|谢谢|收到|明白了|懂了|然后呢|还有呢|还有吗|还有吗\?|还有\?|继续\?|再来\?)\s*[。.!！?？]*$/i.test(t)) return true;
        return false;
    };

    const findLastTopicQuery = (h) => {
        if (!Array.isArray(h) || h.length === 0) return '';
        for (let i = h.length - 1; i >= 0; i--) {
            const m = h[i];
            if (!m || m.role !== 'user') continue;
            const t = String(m.content || '').trim();
            if (!t) continue;
            if (isGenericSmallTalk(t)) continue;
            return t.slice(0, 200);
        }
        return '';
    };

    const extractCompareEntities = (text) => {
        const t = String(text || '').trim();
        if (!t) return null;

        // Very simple heuristic for Chinese comparisons: “A和B… / A与B… / A vs B …”
        const patterns = [
            /(.{1,20}?)(?:和|与|及|对比|比較|比较|vs\.?|VS\.?|V\.S\.?|&)(.{1,20}?)(?:有|的|在|谁|哪|哪些|什么|怎|吗|？|\?|。|，|,|\s|$)/,
        ];
        for (const re of patterns) {
            const m = t.match(re);
            if (m) {
                const a = String(m[1] || '').trim().replace(/[，,。.?？!！:：\s]+$/g, '');
                const b = String(m[2] || '').trim().replace(/^[，,。.?？!！:：\s]+/g, '').replace(/[，,。.?？!！:：\s]+$/g, '');
                if (a && b && a !== b) return [a, b];
            }
        }
        return null;
    };

    const mergeDocs = (a, b) => {
        const all = [...(a || []), ...(b || [])];
        const seen = new Set();
        const out = [];
        for (const d of all) {
            const key = `${d?.pageContent || ''}__${JSON.stringify(d?.metadata || {})}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(d);
        }
        return out;
    };

    const normalizeSnippet = (text, maxLen = 260) => {
        let t = String(text || '');

        // If the knowledge point content includes rich HTML (e.g., pasted from web),
        // strip tags so sources look readable in UI.
        t = t
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ');

        // Decode common HTML entities (&nbsp; etc.)
        t = t
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&#(\d+);/g, (_, n) => {
                const code = Number(n);
                if (!Number.isFinite(code) || code <= 0) return '';
                try { return String.fromCodePoint(code); } catch { return ''; }
            })
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
                const code = parseInt(hex, 16);
                if (!Number.isFinite(code) || code <= 0) return '';
                try { return String.fromCodePoint(code); } catch { return ''; }
            });

        t = t
            .replace(/\u0000/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!t) return '';
        return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
    };

    const toSources = (docs) => {
        const list = Array.isArray(docs) ? docs : [];
        const byKp = new Map();

        for (const doc of list) {
            const meta = doc?.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
            const knowledgePointId = meta.knowledgePointId ? String(meta.knowledgePointId) : '';
            const title = meta.title ? String(meta.title) : '';
            const key = knowledgePointId || title || JSON.stringify(meta) || 'unknown';

            if (byKp.has(key)) continue;

            byKp.set(key, {
                title,
                knowledgePointId,
                sourceType: meta.sourceType ? String(meta.sourceType) : '',
                snippet: normalizeSnippet(doc?.pageContent || ''),
            });
        }

        return Array.from(byKp.values()).slice(0, 6).map((x, idx) => ({
            index: idx + 1,
            ...x,
        }));
    };

    try {
        console.log(`RAG Query: ${question}`);

        const safeHistory = normalizeHistory(history);

        const followUp = isFollowUpMore(question) || isGenericSmallTalk(question);
        const topicQuery = followUp ? findLastTopicQuery(safeHistory) : '';

        // 尝试提取比较对象（用于“相同点/不同点”追问时的定向检索兜底）
        let entities = extractCompareEntities(question);
        if (!entities && safeHistory.length) {
            for (let i = safeHistory.length - 1; i >= 0; i--) {
                const m = safeHistory[i];
                if (m.role !== 'user') continue;
                const found = extractCompareEntities(m.content);
                if (found) {
                    entities = found;
                    break;
                }
            }
        }

        const a = entities ? entities[0] : '';
        const b = entities ? entities[1] : '';
        const isCompareIntent = Boolean(a && b) || wantsSimilarities(question) || wantsDifferences(question);

        let docs = [];
        try {
            docs = await vectorStoreService.queryVectorStore(req.user.id, question, { k: followUp ? 10 : (isCompareIntent ? 8 : 6) });
            console.log(`RAG found ${docs.length} docs.`);
        } catch (err) {
            console.error('Vector Store Query Failed:', err.message);
            // Fallback to empty docs, proceed to general chat
        }

        // 追问场景（例如“还有更多吗”）往往检索不到主题：用上一轮主题再检索一次，拉更多片段
        if (topicQuery) {
            try {
                const moreDocs = await vectorStoreService.queryVectorStore(req.user.id, topicQuery, { k: 12 });
                docs = mergeDocs(docs, moreDocs);
                console.log(`RAG follow-up topic="${topicQuery}" merged docs=${docs.length}`);
            } catch (err) {
                console.error('Vector Store Follow-up Topic Query Failed:', err.message);
            }
        }

        // 若用户已有知识点但向量索引缺失：自动重建一次并重试检索（解决“已录入但检索不到”）
        if ((!docs || docs.length === 0) && !vectorStoreService.isUserVectorStoreReady(req.user.id)) {
            const hasEmbeddingKey = Boolean(process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY);
            if (hasEmbeddingKey) {
                try {
                    const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
                    if (kps && kps.length) {
                        console.log(`Vector store missing. Rebuilding for user=${req.user.id}, kps=${kps.length}`);
                        await vectorStoreService.rebuildVectorStoreForUser(req.user.id, kps);
                        docs = await vectorStoreService.queryVectorStore(req.user.id, question, { k: isCompareIntent ? 8 : 4 });
                        console.log(`RAG after rebuild found ${docs.length} docs.`);
                    }
                } catch (err) {
                    console.error('Auto rebuild vector store failed:', err.message);
                }
            }
        }

        // 如果整句问题没命中，但能识别出比较对象：分别用实体名回查知识库，再合并上下文
        if ((!docs || docs.length === 0) && a && b) {
            try {
                const docsA = await vectorStoreService.queryVectorStore(req.user.id, a, { k: 6 });
                const docsB = await vectorStoreService.queryVectorStore(req.user.id, b, { k: 6 });
                docs = mergeDocs(docsA, docsB);
                console.log(`RAG fallback (entities) found ${docs.length} docs.`);
            } catch (err) {
                console.error('Vector Store Entity Fallback Failed:', err.message);
            }
        }

        // 关键防护：仅允许返回当前用户仍存在的知识点内容。
        // 这样即使向量索引里还残留“已删除知识点”的旧切片，也会被过滤掉。
        const originalDocCount = Array.isArray(docs) ? docs.length : 0;
        if (Array.isArray(docs) && docs.length) {
            // Only keep knowledgePoint sources
            docs = docs.filter((d) => d && d.metadata && d.metadata.sourceType === 'knowledgePoint');

            const kpIds = Array.from(new Set(
                docs
                    .map((d) => d && d.metadata ? d.metadata.knowledgePointId : null)
                    .filter(Boolean)
                    .map((id) => String(id))
            ));

            if (kpIds.length) {
                const existing = await KnowledgePoint.find({ _id: { $in: kpIds }, user: req.user.id }).select('_id');
                const allowed = new Set((existing || []).map((x) => String(x._id)));
                docs = docs.filter((d) => {
                    const id = d && d.metadata ? d.metadata.knowledgePointId : null;
                    if (!id) return false;
                    return allowed.has(String(id));
                });
            } else {
                docs = [];
            }
        }

        if (originalDocCount && (!docs || docs.length === 0)) {
            console.log('RAG docs were filtered out as stale (likely deleted KPs).');
        }

        // 进一步的“精准来源”过滤：
        // 向量检索 topK 有时会夹带不相关的知识点（例如用户只问“鲁迅”，却返回了“莎士比亚”）。
        // 对于这种“短、像实体名”的查询，要求来源片段/标题必须包含该关键词。
        const qTrim = String(question || '').trim();
        const looksLikeEntityOnly = (
            qTrim.length >= 1 &&
            qTrim.length <= 12 &&
            !/[\s]/.test(qTrim) &&
            /^[\u4e00-\u9fffA-Za-z0-9·\.]+$/.test(qTrim)
        );
        if (looksLikeEntityOnly && Array.isArray(docs) && docs.length) {
            const before = docs.length;
            const key = qTrim;
            docs = docs.filter((d) => {
                const meta = d && d.metadata ? d.metadata : {};
                const title = meta && meta.title ? String(meta.title) : '';
                const text = d && d.pageContent ? String(d.pageContent) : '';
                return title.includes(key) || text.includes(key);
            });
            if (before !== docs.length) {
                console.log(`RAG entity-filter applied for "${qTrim}": ${before} -> ${docs.length}`);
            }
        }

        // 进一步的“约束词”过滤（适用于：包含国家/地区等约束的泛类问题）
        // 例如："中国著名文学家" 理论上不应把 "莎士比亚" 当作来源。
        const deriveQueryTokens = (q) => {
            const t = String(q || '');
            const tokens = [];

            // Region / nationality constraints
            const regionWords = ['中国', '我国', '国内', '美国', '英国', '法国', '德国', '日本', '俄国', '苏联', '欧洲', '亚洲'];
            for (const w of regionWords) {
                if (t.includes(w)) tokens.push(w);
            }

            // Category keywords (keep a small, high-signal list)
            const catWords = ['文学家', '文学', '作家', '诗人', '小说家', '戏剧家', '哲学家', '科学家', '思想家', '艺术家'];
            for (const w of catWords) {
                if (t.includes(w)) tokens.push(w);
            }

            // De-dupe
            return Array.from(new Set(tokens));
        };

        const constraintTokens = deriveQueryTokens(qTrim);
        const hasRegionConstraint = constraintTokens.some((x) => ['中国', '我国', '国内', '美国', '英国', '法国', '德国', '日本', '俄国', '苏联', '欧洲', '亚洲'].includes(x));
        if (hasRegionConstraint && Array.isArray(docs) && docs.length && constraintTokens.length >= 2) {
            const before = docs.length;
            const scoreDoc = (d) => {
                const meta = d && d.metadata ? d.metadata : {};
                const title = meta && meta.title ? String(meta.title) : '';
                const text = d && d.pageContent ? String(d.pageContent) : '';
                const hay = `${title}\n${text}`;
                let hit = 0;
                for (const tok of constraintTokens) {
                    if (hay.includes(tok)) hit += 1;
                }
                return hit;
            };

            const filtered = docs
                .map((d) => ({ d, hit: scoreDoc(d) }))
                // Require at least 2 tokens to be present (e.g., 中国 + 文学/文学家)
                .filter((x) => x.hit >= 2)
                .sort((a, b) => b.hit - a.hit)
                .map((x) => x.d);

            // Safe fallback: if we over-filtered everything, keep original docs.
            if (filtered.length > 0) {
                docs = filtered;
                console.log(`RAG constraint-filter applied tokens=${JSON.stringify(constraintTokens)}: ${before} -> ${docs.length}`);
            } else {
                console.log(`RAG constraint-filter would empty results; keeping original docs. tokens=${JSON.stringify(constraintTokens)}`);
            }
        }

        // 如果用户确实有知识点，但检索无命中：可能是索引过期/不同步。
        // 做一次节流的自动重建再重试（避免频繁重建）。
        if ((!docs || docs.length === 0)) {
            const hasEmbeddingKey = Boolean(process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY);
            if (hasEmbeddingKey) {
                try {
                    const kpCount = await KnowledgePoint.countDocuments({ user: req.user.id });
                    if (kpCount > 0) {
                        const lastAt = __ragRebuildThrottle.get(req.user.id) || 0;
                        const now = Date.now();
                        if (now - lastAt > RAG_REBUILD_COOLDOWN_MS) {
                            __ragRebuildThrottle.set(req.user.id, now);
                            const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
                            console.log(`RAG no-hit but user has kps=${kps.length}. Rebuilding index (throttled).`);
                            await vectorStoreService.rebuildVectorStoreForUser(req.user.id, kps);
                            docs = await vectorStoreService.queryVectorStore(req.user.id, question, { k: isCompareIntent ? 8 : 4 });
                            // Re-apply stale filter
                            if (Array.isArray(docs) && docs.length) {
                                docs = docs.filter((d) => d && d.metadata && d.metadata.sourceType === 'knowledgePoint');
                                const kpIds = Array.from(new Set(
                                    docs
                                        .map((d) => d && d.metadata ? d.metadata.knowledgePointId : null)
                                        .filter(Boolean)
                                        .map((id) => String(id))
                                ));
                                if (kpIds.length) {
                                    const existing = await KnowledgePoint.find({ _id: { $in: kpIds }, user: req.user.id }).select('_id');
                                    const allowed = new Set((existing || []).map((x) => String(x._id)));
                                    docs = docs.filter((d) => allowed.has(String(d.metadata.knowledgePointId)));
                                } else {
                                    docs = [];
                                }
                            }
                            console.log(`RAG after throttled rebuild found ${docs ? docs.length : 0} docs.`);
                        }
                    }
                } catch (err) {
                    console.error('Throttled rebuild attempt failed:', err.message);
                }
            }
        }

        // 严格模式：若知识库无命中，直接返回固定提示，不使用通用知识作答。
        const STRICT_KB_ONLY = true;
        if (!docs || docs.length === 0) {
            if (STRICT_KB_ONLY) {
                return res.json({
                    answer: '抱歉，我的知识库中没有关于这个问题的记录，请尝试询问已录入的知识点。',
                    noHit: true,
                    sources: [],
                    context: '',
                    fromKnowledgeBase: false,
                });
            }
        }

        const historyText = safeHistory.length
            ? safeHistory
                .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
                .join('\n')
            : '';

        const context = docs.map((doc, i) => `--- 文档 ${i + 1} ---\n${doc.pageContent}`).join("\n\n");
        const followUpInstruction = followUp
            ? '用户这次是在追问“补充/更多/继续”。请在不重复已说内容的前提下，基于【参考信息】补充更多要点；如果【参考信息】没有更多可补充，再明确说明没有更多记录。'
            : '';

        const prompt = `你是一个严格的知识库问答助手。你的任务是仅根据下面提供的【参考信息】回答用户问题。

重要规则：
1) 只能使用【参考信息】中的内容回答，严禁使用外部常识/百科。
2) 对话上下文仅用于消解指代（如“它/这个/上面那个”），不能作为事实来源。
3) 若【参考信息】不足以回答，请原样回复：抱歉，我的知识库中没有关于这个问题的记录，请尝试询问已录入的知识点。
4) ${followUpInstruction || '回答要尽量信息密度高，分点输出。'}

【对话上下文】（仅用于理解指代，可为空）：
${historyText || '（无）'}

【参考信息】：
${context}

【当前问题】：
${question}

你的回答：`;

        const answer = await callBaiduAI([{ role: 'user', content: prompt }]);
        console.log('RAG Answer generated.');
        res.json({
            answer,
            sources: toSources(docs),
            context,
            fromKnowledgeBase: true,
        });

    } catch (error) {
        console.error('RAG Chain execution error:', error.message);
        res.status(500).send('Error answering question with RAG.');
    }
};

exports.generateQuestion = async (req, res) => {
    const { content, knowledgePointContent, difficulty = '中等', type = '单选题' } = req.body;
    const textToUse = knowledgePointContent || content;

    if (!textToUse) {
        return res.status(400).json({ msg: 'Content (or knowledgePointContent) is required.' });
    }

    try {
        let prompt;
        const isSingleChoice = type.includes('单选') || type.includes('single');

        // When the model returns malformed JSON (truncated, prefixed with explanations, etc.),
        // try to salvage key fields so we can still serve a usable question.
        const salvageFromText = (rawText) => {
            const raw = String(rawText || '');
            if (!raw.trim()) return null;

            const pick = (re) => {
                const m = raw.match(re);
                return m && m[1] ? String(m[1]).trim() : '';
            };

            const q = pick(/"question"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|$)/);
            if (!q) return null;

            const explanation = pick(/"explanation"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|$)/);

            if (!isSingleChoice) {
                const ans = pick(/"(?:answer_key_points|answer)"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|$)/);
                return {
                    question: q,
                    answer: ans,
                    answer_key_points: ans,
                    explanation: explanation,
                    type: 'short-answer',
                };
            }

            // single-choice salvage (best-effort): answer letter and options (object form)
            const answerLetter = pick(/"answer"\s*:\s*"\s*([A-Fa-f])\s*"/).toUpperCase();
            const optionsObj = {};
            // Try to grab options like "A": "..."
            const optRe = /"([A-Fa-f])"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|$)/g;
            let mm;
            while ((mm = optRe.exec(raw)) !== null) {
                const k = String(mm[1] || '').toUpperCase();
                const v = String(mm[2] || '').trim();
                if (k && v && ['A','B','C','D','E','F'].includes(k)) {
                    // Avoid capturing unrelated keys
                    if (k === 'A' || k === 'B' || k === 'C' || k === 'D') optionsObj[k] = v;
                }
            }

            return {
                question: q,
                options: Object.keys(optionsObj).length ? optionsObj : undefined,
                answer: answerLetter,
                explanation: explanation,
                type: 'single-choice',
            };
        };

        if (isSingleChoice) {
            prompt = `
            请根据以下知识点内容生成一道${difficulty}难度的单项选择题。
            
            【知识点内容】:
            ${textToUse}

            请严格以纯JSON格式返回，不要包含Markdown代码块标记。格式如下：
            {
                "question": "题目描述",
                "options": ["选项A的内容", "选项B的内容", "选项C的内容", "选项D的内容"],
                "answer": "正确选项的字母（仅返回A、B、C或D）",
                "explanation": "答案解析"
            }
            `;
        } else {
            prompt = `
            请根据以下知识点内容生成一道${difficulty}难度的简答题。
            
            【知识点内容】:
            ${textToUse}

            请严格以纯JSON格式返回，不要包含Markdown代码块标记。格式如下：
            {
                "question": "题目描述",
                "answer": "参考答案",
                "explanation": "答案解析"
            }

            额外要求：
            1) "question" 必须是针对内容的一个具体问题（例如“请解释……”、“为什么……”、“如何实现……并说明关键点”）。
            2) 禁止在 "question" 中复述本指令（例如以“请根据……生成……”开头，或出现“知识点内容/JSON/格式”等字样）。
            `;
        }

        const attemptOnce = async (p) => {
            const t = await callBaiduAI([{ role: 'user', content: p }]);
            let obj = tryParseJsonObject(t);
            // Some models return an array of objects; use the first element.
            if (Array.isArray(obj) && obj.length && obj[0] && typeof obj[0] === 'object') {
                obj = obj[0];
            }
            if (!obj) {
                obj = salvageFromText(t);
            }
            return { raw: t, obj };
        };

        // First attempt
        let { raw: resultText, obj: jsonResult } = await attemptOnce(prompt);

        // Retry once if JSON is missing or lacks required fields
        const needsRetry = () => {
            if (!jsonResult || typeof jsonResult !== 'object') return true;
            const q = typeof jsonResult.question === 'string' ? jsonResult.question.trim() : '';
            if (!q) return true;

            // For short-answer: forbid assignment-like questions
            if (!isSingleChoice && isLikelyAssignmentStyleQuestion(q)) return true;

            // Retry if model echoed the instruction as the question
            if (/^请根据/.test(q) || /生成一道/.test(q) || /知识点内容/.test(q) || /JSON/.test(q)) return true;
            if (isSingleChoice) {
                const hasOptions = Array.isArray(jsonResult.options) || (jsonResult.options && typeof jsonResult.options === 'object');
                return !hasOptions;
            }
            return false;
        };

        if (needsRetry()) {
            const extraShortAnswerRules = !isSingleChoice
                ? '\n额外禁止：\n- 禁止“请按照/根据上述/按步骤/参考指导”等作业指令题\n- 禁止要求“修改代码/实现功能/搭建项目/使用某框架或库”\n- 题目必须是可在 3-8 句话内用概念/原理/流程/对比来回答的具体问题\n'
                : '';
            const repairPrompt = `你刚才的输出不符合要求（缺少必要字段、不是合法JSON，或题目质量不合格）。\n\n请重新生成，并严格只输出一个JSON对象（不要Markdown、不要多余文字），且必须包含：\n- question（非空字符串，必须是一个具体问题，禁止以“请根据…”开头，禁止出现“知识点内容/JSON/格式/生成一道”等字样）\n${isSingleChoice ? '- options（4个选项的数组或对象）\n- answer（A/B/C/D 之一）\n' : '- answer（参考答案字符串）\n'}- explanation（字符串）${extraShortAnswerRules}\n\n以下是知识点内容：\n${textToUse}`;
            const second = await attemptOnce(repairPrompt);
            // Only overwrite if second parse succeeded
            if (second.obj) {
                resultText = second.raw;
                jsonResult = second.obj;
            }
        }

        // If still assignment-like for short answer, mark as not ok so frontend can ask retry
        if (!isSingleChoice) {
            const q = typeof jsonResult?.question === 'string' ? jsonResult.question.trim() : '';
            if (q && isLikelyAssignmentStyleQuestion(q)) {
                jsonResult.generationOk = false;
                jsonResult.explanation = '题目质量不合格：检测到“作业/改代码/实现功能”类指令题，已拦截。请重试以生成可回答的概念题。';
            }
        }

        if (!jsonResult || typeof jsonResult !== 'object') {
            console.error('Failed to parse generated question JSON:', resultText);
            jsonResult = {
                question: '题目生成失败，请重试。',
                options: [],
                answer: '',
                explanation: String(resultText || ''),
                generationOk: false,
            };
        }

        jsonResult = normalizeQuestionShape(jsonResult, resultText);

        // 适配前端：如果是单选题，确保 options 是对象格式 {A:..., B:...}
        // 并且返回 type 字段
        if (isSingleChoice) {
            jsonResult.type = 'single-choice';
            if (Array.isArray(jsonResult.options)) {
                const optionsObj = {};
                const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
                jsonResult.options.forEach((opt, idx) => {
                    if (idx < labels.length) {
                        optionsObj[labels[idx]] = opt;
                    }
                });
                jsonResult.options = optionsObj;
            }

            // 修复：确保 answer 字段只包含选项字母（A, B, C, D），避免包含完整文本导致前端判断错误
            if (jsonResult.answer && typeof jsonResult.answer === 'string') {
                // 提取第一个匹配的 A-F 字母
                const match = jsonResult.answer.match(/([A-F])/i);
                if (match) {
                    jsonResult.answer = match[1].toUpperCase();
                }
            }
        } else {
            jsonResult.type = 'short-answer';
        }

        // Mark generation OK if we have a non-empty question and the expected fields.
        if (typeof jsonResult.generationOk !== 'boolean') {
            const hasQuestion = typeof jsonResult.question === 'string' && jsonResult.question.trim().length > 0;
            if (isSingleChoice) {
                const hasOptions = jsonResult.options && typeof jsonResult.options === 'object' && Object.keys(jsonResult.options).length >= 2;
                const hasAnswer = typeof jsonResult.answer === 'string' && jsonResult.answer.trim().length > 0;
                jsonResult.generationOk = !!(hasQuestion && hasOptions && hasAnswer);
            } else {
                jsonResult.generationOk = !!(hasQuestion && !isLikelyAssignmentStyleQuestion(jsonResult.question));
            }
        }
        
        // 确保 answer_key_points 存在，兼容前端
        if (jsonResult.answer && !jsonResult.answer_key_points) {
            jsonResult.answer_key_points = jsonResult.answer;
        }

        // 直接返回对象，不要包裹在 result 中
        res.json(jsonResult);
    } catch (error) {
        console.error('Generate Question Error:', error);
        res.status(500).json({ msg: 'Error generating question' });
    }
};

exports.generateQuestionFromFiles = async (req, res) => {
    const { difficulty = '中等', type = '单选题', fileIds } = req.body || {};

    try {
        const query = { user: req.user.id };
        if (Array.isArray(fileIds) && fileIds.length > 0) {
            query._id = { $in: fileIds };
        }

        const files = await StudyFile.find(query).select('_id originalName text textLength');
        if (!files || files.length === 0) {
            return res.status(400).json({ msg: 'No study files found. Please upload files first.' });
        }

        const takeSlice = (raw, maxLen) => {
            const text = String(raw || '');
            if (text.length <= maxLen) return text;
            // pick a random window to increase diversity & avoid always using the very beginning
            const start = Math.max(0, Math.floor(Math.random() * Math.max(1, text.length - maxLen)));
            return text.slice(start, start + maxLen);
        };

        const isOkPayload = (payload) => {
            if (!payload || typeof payload !== 'object') return false;
            const q = typeof payload.question === 'string' ? payload.question.trim() : '';
            if (!q) return false;
            if (typeof payload.generationOk === 'boolean' && payload.generationOk === false) return false;
            if (/题目生成失败/.test(q)) return false;
            // Extra guard for short-answer
            if (String(payload.type || '').includes('short') && isLikelyAssignmentStyleQuestion(q)) return false;
            return true;
        };

        const runGenerateOnce = async (content) => {
            let statusCode = 200;
            let payload = null;
            req.body = { knowledgePointContent: content, difficulty, type };
            await exports.generateQuestion(req, {
                status(code) { statusCode = code; return this; },
                json(obj) { payload = obj; return obj; },
            });
            return { statusCode, payload };
        };

        // Try a few times: if one file is too long/poorly formatted or model transiently fails,
        // try another file/slice before returning failure to frontend.
        const remaining = [...files];
        const maxAttempts = Math.min(3, remaining.length);
        let lastError = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const pickedIndex = Math.floor(Math.random() * remaining.length);
            const picked = remaining.splice(pickedIndex, 1)[0];
            const rawContent = picked && picked.text ? String(picked.text) : '';
            if (!rawContent.trim()) {
                lastError = { statusCode: 400, payload: { msg: 'Picked file has no extractable text.' }, picked };
                continue;
            }

            // Keep prompt small to reduce first-call timeouts
            const maxLen = String(type || '').includes('简答') ? 4500 : 3000;
            const content = takeSlice(rawContent, maxLen);

            const { statusCode, payload } = await runGenerateOnce(content);
            if (statusCode < 400 && isOkPayload(payload)) {
                return res.status(200).json({
                    ...payload,
                    source: {
                        fileId: picked._id,
                        fileName: normalizeOriginalName(picked.originalName),
                        textLength: picked.textLength,
                    },
                });
            }

            lastError = { statusCode, payload, picked };
            // small backoff for transient model failures
            await sleep(300);
        }

        const status = lastError?.statusCode && lastError.statusCode >= 400 ? lastError.statusCode : 500;
        return res.status(status).json({
            msg: 'Error generating question from files',
            detail: lastError?.payload?.msg || undefined,
            source: lastError?.picked
                ? {
                    fileId: lastError.picked._id,
                    fileName: normalizeOriginalName(lastError.picked.originalName),
                    textLength: lastError.picked.textLength,
                }
                : undefined,
        });
    } catch (error) {
        console.error('Generate Question From Files Error:', error);
        return res.status(500).json({ msg: 'Error generating question from files' });
    }
};

exports.gradeAnswer = async (req, res) => {
    // 前端传参可能不一致，这里做兼容处理
    // 前端传: { question, answerKeyPoints, studentAnswer }
    const { question, userAnswer, studentAnswer, correctAnswer, answerKeyPoints } = req.body;
    
    const finalUserAnswer = studentAnswer || userAnswer;
    const finalCorrectAnswer = answerKeyPoints || correctAnswer || "未提供标准答案";

    const isNoAnswer = (text) => {
        const t = String(text || '').trim();
        if (!t) return true;
        // Common “I give up / I don't know” patterns
        return /^(?:不知道|不清楚|不太清楚|忘了|忘记了|不记得|没印象|不会|不会做|不会写|不懂|不会回答|没学过|不会这个|不会这题|无|n\/?a|na)\s*[。.!！?？]*$/i.test(t);
    };

    // 如果用户明确表示未作答/不会，直接判 0 分，避免模型给“鼓励分”
    if (isNoAnswer(finalUserAnswer)) {
        return res.json({
            score: 0,
            isCorrect: false,
            explanation: '你这次没有提供有效作答（例如仅回复“忘记了/不知道/不会”）。按未作答计 0 分。建议尝试写出你记得的关键点或举例，我再帮你按点给分。',
        });
    }

    try {
        const prompt = `
        你是一个严格的阅卷老师，要对学生的简答题进行“按点给分”。
        
        【题目】：${question}
        【参考答案/要点】：${finalCorrectAnswer}
        【学生回答】：${finalUserAnswer}

        评分规则：
        1) 满分 100 分。回答覆盖要点越多、越准确，分数越高。
        2) 只答到部分要点也要给部分分，不要直接判“正确”。
        3) 如果存在明显错误概念或关键缺失，应扣分并说明原因。

        请严格以纯JSON格式返回（不要Markdown、不要多余文字），格式如下：
        {
            "score": 0,              // 0-100 的整数
            "isCorrect": false,      // 仅当 score >= 80 才可为 true
            "explanation": "..."     // 简明说明：答对了哪些点、缺了哪些点、为什么扣分
        }
        `;
        
        const resultText = await callBaiduAI([{ role: 'user', content: prompt }]);
        
        const salvageGradeFromText = (rawText) => {
            const raw = String(rawText || '');
            if (!raw.trim()) return null;
            const scoreMatch = raw.match(/"score"\s*:\s*([0-9]{1,3})/);
            const isCorrectMatch = raw.match(/"isCorrect"\s*:\s*(true|false)/i);
            const explanationMatch = raw.match(/"explanation"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|$)/);
            if (!scoreMatch && !explanationMatch) return null;
            const score = scoreMatch ? Number(scoreMatch[1]) : 0;
            const isCorrect = isCorrectMatch ? String(isCorrectMatch[1]).toLowerCase() === 'true' : false;
            const explanation = explanationMatch && explanationMatch[1] ? String(explanationMatch[1]).trim() : raw;
            return { score, isCorrect, explanation };
        };

        let jsonResult = null;
        try {
            let parsed = tryParseJsonObject(resultText);
            // Some models return an array like [{...}] for grading.
            if (Array.isArray(parsed) && parsed.length && parsed[0] && typeof parsed[0] === 'object') {
                parsed = parsed[0];
            }
            if (parsed && typeof parsed === 'object') {
                jsonResult = parsed;
            } else {
                jsonResult = salvageGradeFromText(resultText);
            }
        } catch {
            jsonResult = salvageGradeFromText(resultText);
        }

        if (!jsonResult || typeof jsonResult !== 'object') {
            console.error('Failed to parse grade result:', resultText);
            jsonResult = {
                score: 0,
                isCorrect: false,
                explanation: String(resultText || ''),
            };
        }

        // Normalize / clamp
        const rawScore = Number(jsonResult.score);
        const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
        const explanation = typeof jsonResult.explanation === 'string' ? jsonResult.explanation : String(jsonResult.explanation || '');
        const isCorrect = typeof jsonResult.isCorrect === 'boolean' ? jsonResult.isCorrect : score >= 80;

        res.json({ score, isCorrect: isCorrect && score >= 80, explanation });
    } catch (error) {
        console.error('Grade Answer Error:', error);
        res.status(500).json({ msg: 'Error grading answer' });
    }
};

exports.generateRiddleGame = async (req, res) => {
    let kps = [];
    const userId = req.user.id;

    try {
        // 1. Pick ONE random "Anchor" Knowledge Point
        const count = await KnowledgePoint.countDocuments({ user: userId });
        
        if (count > 0) {
            const random = Math.floor(Math.random() * count);
            const anchorKp = await KnowledgePoint.findOne({ user: userId }).skip(random);

            if (anchorKp) {
                // 2. Find Related KPs using Vector Search
                let relatedKps = [];
                try {
                    // Search for more than we need (e.g. 6) to filter out duplicates or self
                    const similarDocs = await vectorStoreService.queryVectorStore(userId, anchorKp.title, { k: 6 });
                    
                    // Extract IDs
                    const similarIds = similarDocs
                        .map(d => d.metadata.knowledgePointId)
                        .filter(id => id && id !== anchorKp._id.toString()); // Exclude self

                    if (similarIds.length > 0) {
                        // Fetch actual docs from DB to ensure they exist (handling "deleted" items)
                        relatedKps = await KnowledgePoint.find({ 
                            _id: { $in: similarIds },
                            user: userId 
                        });
                    }
                } catch (vecError) {
                    console.warn("Vector search failed, falling back to random:", vecError);
                }

                // 3. Combine and Deduplicate
                const combinedMap = new Map();
                combinedMap.set(anchorKp._id.toString(), anchorKp);
                
                relatedKps.forEach(kp => {
                    if (!combinedMap.has(kp._id.toString())) {
                        combinedMap.set(kp._id.toString(), kp);
                    }
                });

                // 4. Fill with Randoms if < 4
                if (combinedMap.size < 4) {
                    const needed = 4 - combinedMap.size;
                    const existingIds = Array.from(combinedMap.keys());
                    
                    const randomFillers = await KnowledgePoint.aggregate([
                        { $match: { user: new mongoose.Types.ObjectId(userId), _id: { $nin: existingIds.map(id => new mongoose.Types.ObjectId(id)) } } },
                        { $sample: { size: needed } }
                    ]);
                    
                    randomFillers.forEach(kp => combinedMap.set(kp._id.toString(), kp));
                }

                // Convert back to array and shuffle
                kps = Array.from(combinedMap.values());
            }
        }
    } catch (dbError) {
        console.error("DB Error in generateRiddleGame:", dbError);
    }

    // Fallback if DB is empty or fails
    if (!kps || kps.length === 0) {
        kps = [{
            _id: "fallback",
            title: "费曼技巧",
            content: "费曼技巧是一种学习方法，核心在于通过用简单的语言向别人解释概念来检验自己的理解。"
        }];
    }

    // Ensure we have at least 2 options for a game, otherwise pad with dummies
    while (kps.length < 4) {
        const dummies = [
            { title: "番茄工作法", content: "一种时间管理方法。" },
            { title: "艾宾浩斯遗忘曲线", content: "描述记忆遗忘规律的曲线。" },
            { title: "刻意练习", content: "有目的、有计划的练习方式。" }
        ];
        kps.push(dummies[kps.length % dummies.length]);
    }

    // Pick one as the target answer
    const targetKp = kps[Math.floor(Math.random() * kps.length)];
    const otherKps = kps.filter(k => k.title !== targetKp.title);

    try {
        // 2. Construct Prompt with Context
        const contextDesc = kps.map((k, i) => `${i+1}. 【${k.title}】: ${k.content ? k.content.substring(0, 100).replace(/\s+/g, ' ') : '暂无内容'}...`).join('\n');
        
        const prompt = `
        你是一个知识渊博的谜题设计者。请利用以下一组知识点，设计一个“找不同”或“猜概念”的谜题。

        【候选知识点集合】：
        ${contextDesc}

        请从上述集合中选择【${targetKp.title}】作为谜底。
        
        请生成：
        1. 一个“谜面”（riddle）：
           - 必须描述【${targetKp.title}】的特征。
           - 尝试对比其他候选知识点（例如：“我不像[干扰项A]那样...，而是...”）。
           - 绝对不能直接出现【${targetKp.title}】这几个字。
        2. “选项”（options）：必须直接使用上述候选知识点的标题。
        3. “解析”（explanation）：解释为什么谜底是它，并简要说明它与其他选项的区别。

        请以纯JSON格式返回：
        {
            "riddle": "...",
            "options": ["${kps[0].title}", "${kps[1].title}", "${kps[2].title}", "${kps[3].title}"],
            "answer": "${targetKp.title}",
            "explanation": "..."
        }
        注意：
        1. "answer"必须严格等于【${targetKp.title}】。
        2. "options"必须包含所有候选知识点的标题。
        `;

        // 3. Call AI
        const resultText = await callBaiduAI([{ role: 'user', content: prompt }]);

        // 4. Parse Result
        let jsonResult;
        let jsonStr = resultText;
        const firstOpen = resultText.indexOf('{');
        const lastClose = resultText.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1) {
            jsonStr = resultText.substring(firstOpen, lastClose + 1);
        }
        jsonResult = JSON.parse(jsonStr);
        
        // Robustness checks
        jsonResult.answer = targetKp.title; // Force correct answer
        // Ensure options are exactly our KPs (AI might hallucinate slightly different strings)
        jsonResult.options = kps.map(k => k.title).sort(() => 0.5 - Math.random());

        return res.json(jsonResult);

    } catch (error) {
        console.error('AI Generation Failed, switching to local fallback:', error);
        
        // 5. Local Fallback Generation (Robust Mode)
        try {
            const options = kps.map(k => k.title).sort(() => 0.5 - Math.random());

            // Process content for riddle
            let cleanContent = targetKp.content || "暂无内容";
            cleanContent = cleanContent.replace(/<[^>]+>/g, '');
            const titleRegex = new RegExp(targetKp.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            let riddleContent = cleanContent.replace(titleRegex, '【???】');
            if (riddleContent.length > 120) riddleContent = riddleContent.substring(0, 120) + "...";

            const fallbackResult = {
                riddle: `(AI 离线模式) 请从下列选项中找出符合描述的概念：${riddleContent}`,
                options: options,
                answer: targetKp.title,
                explanation: `这是关于“${targetKp.title}”的描述。其他选项为：${otherKps.map(k => k.title).join('、')}。`
            };

            return res.json(fallbackResult);

        } catch (fallbackError) {
            console.error("Even fallback failed:", fallbackError);
            return res.status(500).json({ msg: 'Game generation failed completely.' });
        }
    }
};
