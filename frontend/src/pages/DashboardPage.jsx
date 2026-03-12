import { useState, useEffect } from 'react';
import apiClient from '../api/axios';
import { Link } from 'react-router-dom';
import MarkdownRenderer from '../components/MarkdownRenderer';

function DashboardPage() {
    const [knowledgePoints, setKnowledgePoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('全部');

    useEffect(() => {
        const fetchKnowledgePoints = async () => {
            try {
                setLoading(true);
                const response = await apiClient.get('/knowledge-points');
                setKnowledgePoints(response.data);
            } catch (err) {
                setError('获取知识点失败');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchKnowledgePoints();
    }, []);

    const handleDelete = async (id) => {
        console.log('删除知识点 ID:', id);
        if (window.confirm('你确定要删除这个知识点吗？')) {
            try {
                const response = await apiClient.delete(`/knowledge-points/${id}`);
                console.log('删除成功:', response);
                setKnowledgePoints(knowledgePoints.filter(kp => kp._id !== id));
            } catch (error) {
                console.error('删除失败:', error);
                const status = error?.response?.status;
                const msg = error?.response?.data?.msg;
                alert(msg ? `删除失败：${msg}` : status ? `删除失败：请求返回 ${status}` : '删除失败：请稍后重试');
            }
        }
    };

    // 计算分类列表
    const categories = ['全部', ...new Set(knowledgePoints.map(kp => kp.category || '默认分类'))];

    // 过滤逻辑
    const filteredKnowledgePoints = knowledgePoints.filter(kp => {
        const matchesSearch = kp.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              kp.content.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === '全部' || (kp.category || '默认分类') === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    if (loading) return <p>加载中...</p>;
    if (error) {
        return (
            <div className="page">
                <div className="alert alert-danger" role="alert">{error}</div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">我的知识点</h1>
                    <p className="page-subtitle">管理知识点、复述与测评，逐步掌握。</p>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Link to="/kp/new" className="btn btn-primary">+ 新建知识点</Link>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div className="row" style={{ gap: '1rem', alignItems: 'center' }}>
                    <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="搜索知识点标题或内容..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="field" style={{ width: '200px', marginBottom: 0 }}>
                        <select 
                            className="input" 
                            value={selectedCategory} 
                            onChange={(e) => setSelectedCategory(e.target.value)}
                        >
                            {categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {filteredKnowledgePoints.length === 0 ? (
                <div className="card">
                    <p style={{ marginBottom: 0 }}>
                        {knowledgePoints.length === 0 
                            ? "你还没有任何知识点，快去创建一个吧！" 
                            : "没有找到匹配的知识点。"}
                    </p>
                </div>
            ) : (
                <ul className="kp-list">
                    {filteredKnowledgePoints.map((kp) => (
                        <li key={kp._id} className="card kp-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                <Link to={`/kp/${kp._id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
                                    <h2 className="kp-title" style={{ margin: 0 }}>{kp.title}</h2>
                                </Link>
                                <span className="badge" style={{ 
                                    marginLeft: '1rem', 
                                    fontSize: '0.8rem', 
                                    whiteSpace: 'nowrap',
                                    backgroundColor: kp.category && kp.category !== '默认分类' ? '#3b82f6' : '#94a3b8',
                                    color: 'white',
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '4px'
                                }}>
                                    {kp.category || '默认分类'}
                                </span>
                            </div>
                            <div className="markdown-content">
                                <MarkdownRenderer content={kp.content} />
                            </div>

                            <div className="kp-actions">
                                <Link to={`/kp/${kp._id}`} className="btn btn-secondary btn-sm">查看</Link>
                                <Link to={`/kp/edit/${kp._id}`} className="btn btn-ghost btn-sm">编辑</Link>
                                <Link to={`/feynman/${kp._id}`} className="btn btn-ghost btn-sm">开始复述</Link>
                                <Link to={`/quiz/${kp._id}`} className="btn btn-success btn-sm">开始测评</Link>
                                <button onClick={() => handleDelete(kp._id)} className="btn btn-danger btn-sm">删除</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
export default DashboardPage;
