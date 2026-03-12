const { HNSWLib } = require("@langchain/community/vectorstores/hnswlib");
const { Embeddings } = require("@langchain/core/embeddings");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Windows 下 HNSWLib 的原生依赖可能无法处理包含中文的绝对路径。
// 因此默认把向量库放到更“安全”的系统目录（可用 FEYNMAN_VECTOR_STORE_PATH 覆盖）。
function resolveVectorStoreRoot() {
    if (process.env.FEYNMAN_VECTOR_STORE_PATH) {
        return path.resolve(process.env.FEYNMAN_VECTOR_STORE_PATH);
    }

    // Prefer an ASCII-safe path.
    const candidates = [
        // Most machines allow writing here (no admin) and path is typically ASCII.
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'feynman-platform', 'vector_store') : null,
        // Fallbacks
        process.env.TEMP ? path.join(process.env.TEMP, 'feynman-platform', 'vector_store') : null,
        os.tmpdir() ? path.join(os.tmpdir(), 'feynman-platform', 'vector_store') : null,
    ].filter(Boolean);

    for (const p of candidates) {
        try {
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
            return p;
        } catch (_) {
            // try next
        }
    }

    // Last resort: relative directory (may still contain non-ascii depending on cwd)
    return path.resolve(__dirname, '..', 'vector_store');
}

const VECTOR_STORE_ROOT = resolveVectorStoreRoot();

if (!fs.existsSync(VECTOR_STORE_ROOT)) {
    fs.mkdirSync(VECTOR_STORE_ROOT, { recursive: true });
}

console.log('VECTOR_STORE_ROOT:', VECTOR_STORE_ROOT);

console.log("BAIDU_API_KEY:", process.env.BAIDU_API_KEY ? "已设置" : "未设置");

class CustomBaiduEmbeddings extends Embeddings {
    constructor(fields) {
        super(fields);
        this.apiKey = fields.apiKey;
        this.secretKey = fields.secretKey;
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        this.batchSize = 16; 
    }

    async getAccessToken() {
        // 如果是 V2 Key (bce-v3 开头)，直接返回，不需要换取 Access Token
        if (this.apiKey && this.apiKey.startsWith('bce-v3')) {
            return { token: this.apiKey, type: 'Bearer' };
        }

        // 如果 Access Token 有效，直接返回
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return { token: this.accessToken, type: 'Query' };
        }

        // 否则，使用 API Key 和 Secret Key 换取 Access Token
        const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`;
        try {
            const response = await axios.post(url);
            if (response.data && response.data.access_token) {
                this.accessToken = response.data.access_token;
                // 提前 60 秒过期，确保安全
                this.tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
                return { token: this.accessToken, type: 'Query' };
            } else {
                throw new Error('Failed to get Access Token from Baidu');
            }
        } catch (error) {
            console.error('Error getting Qianfan Access Token:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async embedDocuments(documents) {
        const batches = [];
        for (let i = 0; i < documents.length; i += this.batchSize) {
            batches.push(documents.slice(i, i + this.batchSize));
        }

        const embeddings = [];
        for (const batch of batches) {
            const results = await Promise.all(batch.map(text => this.embedQuery(text)));
            embeddings.push(...results);
        }
        return embeddings;
    }

    async embedQuery(text) {
        try {
            const tokenInfo = await this.getAccessToken();
            
            let url = 'https://qianfan.baidubce.com/v2/embeddings';
            const headers = {
                'Content-Type': 'application/json'
            };

            if (tokenInfo.type === 'Bearer') {
                headers['Authorization'] = 'Bearer ' + tokenInfo.token;
            } else {
                url += `?access_token=${tokenInfo.token}`;
            }

            const response = await axios.post(
                url,
                {
                    input: [text],
                    model: "bge-large-zh"
                },
                { headers }
            );
            
            if (response.data && response.data.data && response.data.data[0]) {
                return response.data.data[0].embedding;
            } else {
                console.error('Baidu Embedding API Error Response:', JSON.stringify(response.data));
                throw new Error('百度 API 返回结构无效: ' + JSON.stringify(response.data));
            }
        } catch (error) {
            console.error('Embedding 错误详情:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

const embeddings = new CustomBaiduEmbeddings({
    apiKey: process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY,
    secretKey: process.env.QIANFAN_SECRET_KEY || process.env.BAIDU_SECRET_KEY
});

const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
});

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function getUserStorePath(userId) {
    const safe = String(userId || 'default');
    const p = path.join(VECTOR_STORE_ROOT, safe);
    ensureDir(p);
    return p;
}

exports.isUserVectorStoreReady = (userId) => {
    const storePath = getUserStorePath(userId);
    const indexPath = path.join(storePath, 'hnswlib.index');
    return fs.existsSync(indexPath);
};

function dedupeDocs(docs) {
    const seen = new Set();
    const out = [];
    for (const d of docs || []) {
        const key = `${d?.pageContent || ''}__${JSON.stringify(d?.metadata || {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
    }
    return out;
}

exports.addKnowledgePointToStore = async (knowledgePoint) => {
    try {
        console.log('正在为知识点 ' + knowledgePoint._id + ' 创建向量...');

        const userId = knowledgePoint.user ? knowledgePoint.user.toString() : 'default';
        const storePath = getUserStorePath(userId);

        const title = String(knowledgePoint.title || '').trim();
        const content = String(knowledgePoint.content || '').trim();
        const combined = [title, content].filter(Boolean).join('\n\n');
        if (!combined) {
            console.warn('知识点内容为空，跳过索引:', knowledgePoint._id);
            return;
        }

        const docs = await textSplitter.createDocuments(
            [combined],
            [{
                knowledgePointId: knowledgePoint._id.toString(),
                userId,
                title,
                sourceType: 'knowledgePoint'
            }]
        );

        console.log(`知识点被分割成 ${docs.length} 个文本块。`);

        let vectorStore;
        try {
            // 尝试加载现有的向量库
            console.log('尝试从路径加载向量库:', storePath);
            vectorStore = await HNSWLib.load(storePath, embeddings);
            await vectorStore.addDocuments(docs);
            console.log('向已存在的向量库中添加了新文档。');
        } catch (e) {
            console.error('加载向量库失败，详细错误:', e.message);
            console.log('正在创建新的向量库...');
            vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
        }

        // 保存 args.json 和 docstore.json
        await vectorStore.save(storePath);
        
        // 手动处理 hnswlib.index 文件
        // 注意：Windows 下跨盘符 rename 会失败（EXDEV），因此必须在 storePath 内生成临时文件。
        if (vectorStore.index) {
            const targetIndexPath = path.join(storePath, 'hnswlib.index');
            const tempFileName = 'temp_hnswlib_' + Date.now() + '.index';
            const tempIndexPath = path.join(storePath, tempFileName);

            const prevCwd = process.cwd();
            try {
                process.chdir(storePath);
                vectorStore.index.writeIndex(tempFileName);
                console.log('调试: 已写入临时索引文件:', tempIndexPath);
            } catch (err) {
                console.error('调试: 写入临时索引失败:', err);
            } finally {
                try {
                    process.chdir(prevCwd);
                } catch (_) {
                    // ignore
                }
            }

            try {
                if (fs.existsSync(tempIndexPath)) {
                    if (fs.existsSync(targetIndexPath)) fs.unlinkSync(targetIndexPath);
                    fs.renameSync(tempIndexPath, targetIndexPath);
                    console.log('调试: 成功生成索引文件:', targetIndexPath);
                } else {
                    console.error('调试: 写入后未找到临时文件:', tempIndexPath);
                }
            } catch (err) {
                console.error('调试: 手动保存索引失败:', err);
            }

            // 清理遗留的临时索引文件
            try {
                const files = fs.readdirSync(storePath);
                for (const f of files) {
                    if (/^temp_hnswlib_\d+\.index$/.test(f)) {
                        try {
                            fs.unlinkSync(path.join(storePath, f));
                        } catch (_) {
                            // ignore
                        }
                    }
                }
            } catch (_) {
                // ignore
            }
        }

        const files = fs.readdirSync(storePath);
        console.log('调试: vector_store 目录下的文件:', files);

        if (files.includes('hnswlib.index')) {
            console.log('知识点 ' + knowledgePoint._id + ' 的向量已成功保存到 ' + storePath);
        } else {
            console.error('警告: hnswlib.index 文件仍然缺失! storePath=' + storePath);
        }

    } catch (error) {
        console.error('添加到向量库失败:', error);
    }
};

/**
 * 从向量数据库中检索与问题相关的文档
 * @param {string} query - 用户的问题
 * @returns {Promise<Document[]>} - 返回相关文档片段的数组
 */
exports.queryVectorStore = async (userId, query, options = {}) => {
    try {
        // Backward-compatible signature: queryVectorStore(query)
        let resolvedUserId = userId;
        let resolvedQuery = query;
        let resolvedOptions = options;
        if (typeof query === 'undefined' && typeof userId === 'string') {
            resolvedQuery = userId;
            resolvedUserId = 'default';
            resolvedOptions = {};
        }

        const storePath = getUserStorePath(resolvedUserId);

        const indexPath = path.join(storePath, 'hnswlib.index');
        if (!fs.existsSync(indexPath)) {
            return [];
        }

        // 1. 加载向量数据库
        const vectorStore = await HNSWLib.load(storePath, embeddings);

        // 2. 从向量存储创建一个检索器 (Retriever)
        // .asRetriever(k) 表示返回最相关的 k 个结果
        const k = Number.isFinite(resolvedOptions.k) ? resolvedOptions.k : 4;
        const retriever = vectorStore.asRetriever(Math.max(1, Math.min(12, k)));

        // 3. 使用检索器获取相关文档
        const relevantDocs = await retriever.invoke(resolvedQuery);
        
        console.log(`为问题 "${resolvedQuery}" 检索到 ${relevantDocs.length} 个相关文档。`);
        return dedupeDocs(relevantDocs);

    } catch (error) {
        console.error('从向量库检索失败:', error);
        // 如果向量库不存在，可以返回空数组或特定错误
        if (error.message.includes('No such file or directory')) {
            return [];
        }
        throw error;
    }
};

/**
 * 重建某个用户的向量库（适用于：之前未成功索引/更换启动目录/新增 title 索引等场景）
 * @param {string} userId
 * @param {Array<{_id:any,title?:string,content?:string}>} knowledgePoints
 */
exports.rebuildVectorStoreForUser = async (userId, knowledgePoints = []) => {
    const resolvedUserId = String(userId || 'default');
    const storePath = getUserStorePath(resolvedUserId);

    // 清空旧索引文件
    try {
        const existing = fs.readdirSync(storePath);
        for (const f of existing) {
            try {
                fs.unlinkSync(path.join(storePath, f));
            } catch (_) {
                // ignore
            }
        }
    } catch (_) {
        // ignore
    }

    const docs = [];
    for (const kp of knowledgePoints || []) {
        const title = String(kp.title || '').trim();
        const content = String(kp.content || '').trim();
        const combined = [title, content].filter(Boolean).join('\n\n');
        if (!combined) continue;

        const chunks = await textSplitter.createDocuments(
            [combined],
            [{
                knowledgePointId: kp._id?.toString?.() ? kp._id.toString() : String(kp._id),
                userId: resolvedUserId,
                title,
                sourceType: 'knowledgePoint'
            }]
        );
        docs.push(...chunks);
    }

    if (docs.length === 0) {
        return { ok: true, chunks: 0, storePath };
    }

    const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
    await vectorStore.save(storePath);

    if (vectorStore.index) {
        const targetIndexPath = path.join(storePath, 'hnswlib.index');
        const tempFileName = 'temp_hnswlib_' + Date.now() + '.index';
        const tempIndexPath = path.join(storePath, tempFileName);

        const prevCwd = process.cwd();
        try {
            process.chdir(storePath);
            vectorStore.index.writeIndex(tempFileName);
        } catch (err) {
            console.error('重建向量库: 写入临时索引失败:', err);
        } finally {
            try {
                process.chdir(prevCwd);
            } catch (_) {
                // ignore
            }
        }

        try {
            if (fs.existsSync(tempIndexPath)) {
                if (fs.existsSync(targetIndexPath)) fs.unlinkSync(targetIndexPath);
                fs.renameSync(tempIndexPath, targetIndexPath);
            }
        } catch (err) {
            console.error('重建向量库: 手动保存索引失败:', err);
        }

        // 清理遗留的临时索引文件
        try {
            const files = fs.readdirSync(storePath);
            for (const f of files) {
                if (/^temp_hnswlib_\d+\.index$/.test(f)) {
                    try {
                        fs.unlinkSync(path.join(storePath, f));
                    } catch (_) {
                        // ignore
                    }
                }
            }
        } catch (_) {
            // ignore
        }
    }

    return { ok: true, chunks: docs.length, storePath };
};
