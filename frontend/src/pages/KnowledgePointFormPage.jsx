import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/axios';
import ReactQuill from 'react-quill'; // 引入ReactQuill
import 'react-quill/dist/quill.snow.css'; // 引入默认的雪花主题样式
import DOMPurify from 'dompurify'; // 引入DOMPurify
import './KnowledgePointFormPage.css';

function KnowledgePointFormPage() {
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('默认分类');
    const [content, setContent] = useState(''); // content现在将存储HTML
    const [status, setStatus] = useState('not_started');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');
    const [txtFile, setTxtFile] = useState(null);
    const [existingCategories, setExistingCategories] = useState([]);
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditing = Boolean(id);

    // 获取现有分类
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const { data } = await apiClient.get('/knowledge-points/categories');
                setExistingCategories(data);
            } catch (error) {
                console.error('获取分类失败', error);
            }
        };
        fetchCategories();
    }, []);

    useEffect(() => {
        if (isEditing) {
            const fetchKp = async () => {
                try {
                    const { data } = await apiClient.get(`/knowledge-points/${id}`);
                    setTitle(data.title);
                    if (data.category) setCategory(data.category);
                    setContent(data.content);
                    if (data.status) setStatus(data.status);
                } catch (error) {
                    console.error('获取知识点失败', error);
                }
            };
            fetchKp();
        }
    }, [id, isEditing]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log('提交知识点:', { title, content, status });

        // 对内容进行消毒
        const sanitizedContent = DOMPurify.sanitize(content);
        const kpData = { title, content: sanitizedContent, status, category };

        try {
            let response;
            if (isEditing) {
                response = await apiClient.put(`/knowledge-points/${id}`, kpData);
            } else {
                response = await apiClient.post('/knowledge-points', kpData);
            }
            console.log('提交成功:', response);
            navigate('/');
        } catch (error) {
            console.error('提交失败:', error);
        }
    };

    const handleImportTxt = async () => {
        if (!txtFile) {
            setImportError('请先选择一个 TXT 文件再导入。');
            return;
        }

        setImportError('');
        setImporting(true);
        try {
            const formData = new FormData();
            formData.append('file', txtFile);
            const { data } = await apiClient.post('/knowledge-points/import-txt', formData);
            if (data?.title) setTitle(data.title);
            if (data?.content) setContent(data.content);
        } catch (error) {
            console.error('导入 TXT 失败', error);
            const status = error?.response?.status;
            const msg = error?.response?.data?.msg;
            setImportError(msg || (status ? `导入失败：请求返回 ${status}。` : '导入失败：请稍后重试。'));
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{isEditing ? '编辑知识点' : '新建知识点'}</h1>
                    <p className="page-subtitle">标题清晰、内容结构化，会更利于复述与测评。</p>
                </div>
            </div>

            <div className="card">
                <form onSubmit={handleSubmit} className="stack">
                    {!isEditing && (
                        <div className="kp-import">
                            <div className="kp-import-head">
                                <div>
                                    <div className="kp-import-title">从 TXT 导入</div>
                                    <div className="help">支持上传 .txt 文件，系统会解析为知识点内容并填充到下方编辑器。</div>
                                </div>
                                <span className="badge">可选</span>
                            </div>

                            <div className="kp-import-row">
                                <input
                                    className="input kp-file-input"
                                    type="file"
                                    accept=".txt,text/plain"
                                    onChange={(e) => setTxtFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                                />
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={handleImportTxt}
                                    disabled={importing}
                                >
                                    {importing ? '导入中...' : '导入到编辑器'}
                                </button>
                            </div>

                            {importError ? (
                                <div className="alert alert-danger kp-import-error">{importError}</div>
                            ) : null}
                        </div>
                    )}

                    {!isEditing && <hr className="divider" />}

                    <div className="field">
                        <label htmlFor="kp-title">标题</label>
                        <input
                            id="kp-title"
                            className="input"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="例如：牛顿第二定律"
                            required
                        />
                    </div>

                    <div className="field">
                        <label htmlFor="kp-category">分类</label>
                        <input
                            id="kp-category"
                            className="input"
                            type="text"
                            list="category-list"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            placeholder="输入新分类或选择已有分类"
                        />
                        <datalist id="category-list">
                            <option value="默认分类" />
                            {existingCategories.map((cat) => (
                                <option key={cat} value={cat} />
                            ))}
                        </datalist>
                    </div>

                    <div className="field">
                        <label htmlFor="kp-status">学习状态</label>
                        <select
                            id="kp-status"
                            className="input"
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            <option value="not_started">未开始</option>
                            <option value="in_progress">学习中</option>
                            <option value="mastered">已掌握</option>
                        </select>
                    </div>

                    <div className="field quill-wrap">
                        <label>内容</label>
                        <ReactQuill theme="snow" value={content} onChange={setContent} style={{ height: '320px' }} />
                        <div className="help">支持富文本、公式与 Mermaid 代码块（language-mermaid）。</div>
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                        <button type="submit" className="btn btn-primary">{isEditing ? '更新' : '创建'}</button>
                        <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>取消</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default KnowledgePointFormPage;
