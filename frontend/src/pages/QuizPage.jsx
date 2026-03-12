import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/axios';

function QuizPage() {
    const { id } = useParams(); // 知识点ID
    const navigate = useNavigate();

    const [knowledgePoint, setKnowledgePoint] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [question, setQuestion] = useState(null);
    const [result, setResult] = useState(null);
    const [selectedOption, setSelectedOption] = useState('');
    const [questionType, setQuestionType] = useState('single-choice'); // 'single-choice' or 'short-answer'
    const [isGrading, setIsGrading] = useState(false);

    // 1. 加载知识点内容
    useEffect(() => {
        const fetchKp = async () => {
            try {
                const response = await apiClient.get(`/knowledge-points/${id}`);
                setKnowledgePoint(response.data);
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchKp();
    }, [id]);

    // 2. 获取题目 (在知识点加载后)
    const fetchQuestion = async (difficulty) => {
        if (!knowledgePoint) return;
        setIsLoading(true);
        setQuestion(null);
        setResult(null);
        setSelectedOption('');
        try {
            const response = await apiClient.post('/ai/generate-question', {
                knowledgePointContent: knowledgePoint.content,
                difficulty: difficulty,
                type: questionType
            });
            setQuestion(response.data);
        } catch (error) {
            console.error(error);
            alert('出题失败，请稍后再试');
        } finally {
            setIsLoading(false);
        }
    };
    
    // 3. 提交答案
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedOption) {
            alert('请输入或选择一个答案！');
            return;
        }

        if (question.type === 'short-answer') {
            setIsGrading(true);
            try {
                const response = await apiClient.post('/ai/grade-answer', {
                    question: question.question,
                    answerKeyPoints: question.answer_key_points,
                    studentAnswer: selectedOption
                });
                const gradeResult = response.data;
                setResult({
                    isCorrect: gradeResult.isCorrect,
                    explanation: gradeResult.explanation
                });
            } catch (error) {
                console.error('阅卷失败', error);
                alert('阅卷失败，请重试');
            } finally {
                setIsGrading(false);
            }
        } else {
            // 单选题逻辑
            const isCorrect = selectedOption === question.answer;
            setResult({
                isCorrect: isCorrect,
                explanation: question.explanation
            });
        }
    };

    if (!knowledgePoint && isLoading) return <p>加载知识点信息...</p>;
    if (!knowledgePoint) {
        return (
            <div className="page">
                <div className="alert alert-danger" role="alert">未找到知识点</div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">知识点测评：{knowledgePoint.title}</h1>
                    <p className="page-subtitle">选择题或简答题，简答题会调用 AI 阅卷。</p>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>返回主页</button>
                </div>
            </div>

            {!question && (
                <div className="card">
                    <div className="field" style={{ maxWidth: '360px' }}>
                        <label htmlFor="question-type">题目类型</label>
                        <select
                            id="question-type"
                            className="select"
                            value={questionType}
                            onChange={(e) => setQuestionType(e.target.value)}
                        >
                            <option value="single-choice">单项选择题</option>
                            <option value="short-answer">简答题</option>
                        </select>
                        <div className="help">简答题会调用 AI 阅卷。</div>
                    </div>

                    <div style={{ marginTop: '1rem' }}>
                        <p style={{ marginBottom: '0.6rem' }}>请选择难度开始测评：</p>
                        <div className="row">
                            <button className="btn btn-primary" type="button" onClick={() => fetchQuestion('基础')}>基础</button>
                            <button className="btn btn-primary" type="button" onClick={() => fetchQuestion('中等')}>中等</button>
                            <button className="btn btn-primary" type="button" onClick={() => fetchQuestion('困难')}>困难</button>
                        </div>
                    </div>
                </div>
            )}

            {isLoading && question === null && (
                <div className="alert" style={{ marginTop: '1rem' }}>AI 正在出题中...</div>
            )}

            {question && !result && (
                <div className="card" style={{ marginTop: '1rem' }}>
                    <div className="row" style={{ marginBottom: '0.75rem' }}>
                        <span className="badge badge-accent">{question.difficulty}</span>
                        <span className="badge badge-purple">{question.type === 'short-answer' ? '简答题' : '单选题'}</span>
                    </div>

                    <h3 style={{ marginTop: 0 }}>{question.question}</h3>

                    <form onSubmit={handleSubmit} className="stack" style={{ marginTop: '0.75rem' }}>
                        {question.type === 'single-choice' ? (
                            <div className="stack" style={{ gap: '0.6rem' }}>
                                {Object.entries(question.options).map(([key, value]) => (
                                    <label key={key} className="card soft" style={{ padding: '0.65rem 0.8rem' }}>
                                        <div className="row" style={{ gap: '0.6rem' }}>
                                            <input
                                                type="radio"
                                                id={key}
                                                name="option"
                                                value={key}
                                                checked={selectedOption === key}
                                                onChange={(e) => setSelectedOption(e.target.value)}
                                            />
                                            <span style={{ fontWeight: 700 }}>{key}.</span>
                                            <span>{value}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <div className="field">
                                <label htmlFor="short-answer">你的答案</label>
                                <textarea
                                    id="short-answer"
                                    className="textarea"
                                    value={selectedOption}
                                    onChange={(e) => setSelectedOption(e.target.value)}
                                    placeholder="请输入你的答案..."
                                />
                            </div>
                        )}

                        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                            <button type="submit" disabled={isGrading} className="btn btn-primary">
                                {isGrading ? 'AI 阅卷中...' : '提交答案'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {result && (
                <div className="card" style={{ marginTop: '1rem' }}>
                    <div className="card-header">
                        <h2 style={{ margin: 0 }}>测评结果</h2>
                        <span className={`badge ${result.isCorrect ? 'badge-success' : 'badge-danger'}`}>
                            {result.isCorrect ? '正确' : '错误'}
                        </span>
                    </div>

                    <div className={`alert ${result.isCorrect ? 'alert-success' : 'alert-danger'}`}>
                        <strong>{result.isCorrect ? '✅ 回答正确！' : '❌ 回答错误！'}</strong>
                        {question.type === 'single-choice' && (
                            <div style={{ marginTop: '0.4rem' }}>正确答案：<strong>{question.answer}</strong></div>
                        )}
                    </div>

                    <div style={{ marginTop: '0.75rem' }}>
                        <h3 style={{ marginBottom: '0.35rem' }}>解释</h3>
                        <p style={{ marginBottom: 0 }}>{result.explanation}</p>
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button className="btn btn-primary" type="button" onClick={() => fetchQuestion(question.difficulty)}>再来一题</button>
                        <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>返回主页</button>
                    </div>
                </div>
            )}
        </div>
    );
}
export default QuizPage;
