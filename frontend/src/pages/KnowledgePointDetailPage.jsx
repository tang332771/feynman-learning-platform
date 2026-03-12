import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/axios';
import MarkdownRenderer from '../components/MarkdownRenderer';

function KnowledgePointDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [kp, setKp] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchKp = async () => {
            try {
                setLoading(true);
                const response = await apiClient.get(`/knowledge-points/${id}`);
                setKp(response.data);
            } catch (err) {
                console.error('获取知识点详情失败', err);
                setError('获取知识点详情失败，请稍后重试。');
            } finally {
                setLoading(false);
            }
        };
        fetchKp();
    }, [id]);

    const handleDelete = async () => {
        if (window.confirm('你确定要删除这个知识点吗？')) {
            try {
                await apiClient.delete(`/knowledge-points/${id}`);
                navigate('/');
            } catch (error) {
                console.error('删除失败:', error);
                alert('删除失败，请稍后重试');
            }
        }
    };

    if (loading) return <div className="page"><p>加载中...</p></div>;
    if (error) return <div className="page"><div className="alert alert-danger">{error}</div></div>;
    if (!kp) return <div className="page"><div className="alert alert-warning">未找到该知识点</div></div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{kp.title}</h1>
                    <div className="page-subtitle">
                        <span className="badge" style={{ 
                            marginRight: '0.5rem', 
                            backgroundColor: kp.category && kp.category !== '默认分类' ? '#3b82f6' : '#94a3b8',
                            color: 'white',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px'
                        }}>
                            {kp.category || '默认分类'}
                        </span>
                        创建于 {new Date(kp.createdAt).toLocaleDateString()}
                    </div>
                </div>
                <div className="row">
                    <Link to="/" className="btn btn-secondary">返回列表</Link>
                    <Link to={`/kp/edit/${kp._id}`} className="btn btn-primary">编辑</Link>
                    <button onClick={handleDelete} className="btn btn-danger">删除</button>
                </div>
            </div>

            <div className="card">
                <div className="markdown-content" style={{ maxHeight: 'none', maskImage: 'none' }}>
                    <MarkdownRenderer content={kp.content} />
                </div>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <h3>开始学习</h3>
                <div className="row">
                    <Link to={`/feynman/${kp._id}`} className="btn btn-success">开始复述</Link>
                    <Link to={`/quiz/${kp._id}`} className="btn btn-info" style={{ backgroundColor: 'var(--info)', color: 'white' }}>开始测评</Link>
                </div>
            </div>
        </div>
    );
}

export default KnowledgePointDetailPage;
