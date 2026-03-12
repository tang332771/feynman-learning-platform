import { useState, useRef, useEffect } from 'react';
import axios from '../api/axios';
import './AgentPage.css';

const AgentPage = ({ view = 'quiz' }) => {
  const [quizMessages, setQuizMessages] = useState([
    { id: 1, text: '这里是“随机出题”板块：你可以上传题库文件并随机出题，作答后我会判分与解析。', sender: 'ai' }
  ]);
  const [chatMessages, setChatMessages] = useState([
    { id: 1, text: '这里是“知识点聊天”板块：你可以直接问我关于你已录入知识点的问题。', sender: 'ai' }
  ]);
  const [quizInput, setQuizInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [quizLoading, setQuizLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [studyFiles, setStudyFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [quizDifficulty, setQuizDifficulty] = useState('中等');
  const [quizType, setQuizType] = useState('single-choice');
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const fileInputRef = useRef(null);
  const quizMessagesEndRef = useRef(null);
  const chatMessagesEndRef = useRef(null);

  const formatSource = (source) => {
    if (!source) return '';
    const fileId = source.fileId ? String(source.fileId) : '';
    const fileName = source.fileName ? String(source.fileName) : '';

    const looksGarbled = (s) => /\uFFFD/.test(s) || /[ÃÂÐÑØÞ]/.test(s);
    const safeName = fileName && !looksGarbled(fileName) ? fileName : (fileId ? `文件-${fileId}` : '文件');
    return `\n\n（来源：${safeName}）`;
  };

  const extractChoiceLetter = (text) => {
    const t = String(text || '').trim().toUpperCase();
    const m = t.match(/\b([A-D])\b/);
    if (m) return m[1];
    // also accept like "选C" / "答案是C" / "C." etc.
    const m2 = t.match(/([A-D])/);
    return m2 ? m2[1] : '';
  };

  const isNoShortAnswer = (text) => {
    const t = String(text || '').trim();
    if (!t) return true;
    return /^(?:不知道|不清楚|不太清楚|忘了|忘记了|不记得|没印象|不会|不会做|不会写|不懂|不会回答|没学过|不会这个|不会这题|无|n\/?a|na)\s*[。.!！?？]*$/i.test(t);
  };

  const scrollToEnd = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToEnd(quizMessagesEndRef);
  }, [quizMessages]);

  useEffect(() => {
    scrollToEnd(chatMessagesEndRef);
  }, [chatMessages]);

  useEffect(() => {
    if (view !== 'quiz') return;
    const fetchFiles = async () => {
      try {
        const res = await axios.get('/files');
        const list = Array.isArray(res.data) ? res.data : [];
        setStudyFiles(list);
        setSelectedFiles(list.map((f) => f._id));
      } catch {
        // ignore
      }
    };
    fetchFiles();
  }, [view]);

  const refreshFiles = async () => {
    const res = await axios.get('/files');
    const list = Array.isArray(res.data) ? res.data : [];
    setStudyFiles(list);
    setSelectedFiles(list.map((f) => f._id));
    return list;
  };

  const formatBytes = (bytes) => {
    const n = Number(bytes || 0);
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const val = n / Math.pow(1024, idx);
    return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const handleDeleteStudyFile = async (fileId) => {
    if (!fileId) return;
    try {
      await axios.delete(`/files/${fileId}`);
      await refreshFiles();
      setQuizMessages((prev) => [
        ...prev,
        { id: Date.now(), sender: 'ai', text: '已删除旧文件。你可以重新上传一批文件。' },
      ]);
    } catch (err) {
      console.error('Delete file failed:', err);
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.msg;
      const tip = serverMsg
        ? `删除失败：${serverMsg}`
        : status
          ? `删除失败：请求返回 ${status}。`
          : '删除失败：请稍后重试。';
      setQuizMessages((prev) => [
        ...prev,
        { id: Date.now(), sender: 'ai', text: tip, isError: true },
      ]);
    }
  };

  const handleDeleteAllStudyFiles = async () => {
    const ok = window.confirm('确定要清空题库吗？这会删除你上传的所有题库文件。');
    if (!ok) return;

    try {
      const res = await axios.delete('/files');
      const deleted = res?.data?.deleted;
      await refreshFiles();
      setActiveQuiz(null);
      setQuizMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: 'ai',
          text: typeof deleted === 'number' ? `已批量删除 ${deleted} 个文件。` : '已清空题库。',
        },
      ]);
    } catch (err) {
      console.error('Bulk delete files failed:', err);
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.msg;
      const tip = serverMsg
        ? `清空失败：${serverMsg}`
        : status
          ? `清空失败：请求返回 ${status}。`
          : '清空失败：请稍后重试。';
      setQuizMessages((prev) => [
        ...prev,
        { id: Date.now(), sender: 'ai', text: tip, isError: true },
      ]);
    }
  };

  const handleUploadFiles = async () => {
    const inputEl = fileInputRef.current;
    const files = inputEl && inputEl.files ? Array.from(inputEl.files) : [];
    if (!files.length) {
      setQuizMessages((prev) => [...prev, { id: Date.now(), text: '请先选择要上传的文件（建议 16 个）。', sender: 'ai', isError: true }]);
      return;
    }

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));

    setUploading(true);
    try {
      // 不要手动设置 Content-Type，让浏览器/axios 自动带上 boundary，否则后端可能收不到文件。
      await axios.post('/files/upload', formData);

      const list = await refreshFiles();

      setQuizMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          text: `文件上传成功：当前题库共 ${list.length} 个文件。你可以点击“随机出题”。`,
          sender: 'ai',
        },
      ]);

      if (inputEl) inputEl.value = '';
    } catch (error) {
      console.error('Upload files failed:', error);

      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.msg;
      let tip = '上传失败：请稍后重试。';

      if (status === 401) {
        tip = '上传失败：当前登录已失效，请重新登录后再上传。';
      } else if (status === 400) {
        tip = `上传失败：${serverMsg || '后端未收到文件，请重新选择文件后重试。'}`;
      } else if (status === 413) {
        tip = '上传失败：文件过大（单个文件上限 10MB）。';
      } else if (serverMsg) {
        tip = `上传失败：${serverMsg}`;
      } else if (status) {
        tip = `上传失败：请求返回 ${status}。`;
      }

      setQuizMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          text: tip,
          sender: 'ai',
          isError: true,
        },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const handleRandomQuiz = async () => {
    if (!selectedFiles.length) {
      setQuizMessages((prev) => [...prev, { id: Date.now(), text: '题库为空：请先上传文件。', sender: 'ai', isError: true }]);
      return;
    }

    setQuizLoading(true);
    try {
      const type = quizType === 'short-answer' ? '简答题' : '单选题';
      const res = await axios.post('/ai/generate-question-from-files', {
        difficulty: quizDifficulty,
        type,
        fileIds: selectedFiles,
      });

      const q = res.data;
      const sourceName = formatSource(q && q.source ? q.source : null);

      const safeQuestion = (q && typeof q.question === 'string' && q.question.trim())
        ? q.question
        : '题目生成失败，请重试。';

      const generationOk = q && typeof q.generationOk === 'boolean' ? q.generationOk : true;
      const isFailureQuestion = safeQuestion.includes('题目生成失败');

      if (!generationOk || isFailureQuestion) {
        setActiveQuiz(null);
        const extra = q && q.explanation ? `\n\n（调试信息：${String(q.explanation).slice(0, 200)}）` : '';
        setQuizMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            sender: 'ai',
            text: `出题失败：请点击“随机出题”重试。${sourceName}${extra}`,
            isError: true,
          },
        ]);
        return;
      }

      // 记录当前题目，便于用户直接回答 A/B/C/D 或简答内容
      setActiveQuiz({
        ...q,
        meta: {
          difficulty: quizDifficulty,
          requestedType: quizType,
        },
      });

      if (q && q.type === 'single-choice' && q.options) {
        const optionsText = Object.entries(q.options)
          .map(([k, v]) => `${k}. ${v}`)
          .join('\n');
        setQuizMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            sender: 'ai',
            text: `随机出题（${quizDifficulty}｜单选题）\n\n${safeQuestion}\n\n${optionsText}${sourceName}`,
          },
        ]);
      } else {
        setQuizMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            sender: 'ai',
            text: `随机出题（${quizDifficulty}｜简答题）\n\n${safeQuestion}${sourceName}`,
          },
        ]);
      }

      // 给用户一个明确的作答提示
      if (q && q.type === 'single-choice') {
        setQuizMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, sender: 'ai', text: '请直接回复 A / B / C / D 作答，我会帮你判分并给解析。' },
        ]);
      } else {
        setQuizMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, sender: 'ai', text: '请直接输入你的简答内容作答，我会帮你判分并给反馈。' },
        ]);
      }
    } catch (error) {
      console.error('Random quiz failed:', error);
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.msg;
      const detail = error?.response?.data?.detail;
      const tip = serverMsg
        ? `出题失败：${serverMsg}${detail ? `（${detail}）` : ''}`
        : status
          ? `出题失败：请求返回 ${status}。`
          : '出题失败：请确认题库里有可解析文本内容的文件。';
      setQuizMessages((prev) => [
        ...prev,
        { id: Date.now(), sender: 'ai', text: tip, isError: true },
      ]);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleQuizSend = async (e) => {
    e.preventDefault();
    if (!quizInput.trim()) return;

    if (quizLoading || uploading) return;

    // 如果当前有题目在等待作答，优先走“答题判分”逻辑
    if (activeQuiz && activeQuiz.question) {
      const userInput = quizInput;
      const quiz = activeQuiz;

      const userMessage = { id: Date.now(), text: userInput, sender: 'user' };
      setQuizMessages((prev) => [...prev, userMessage]);
      setQuizInput('');

      // 单选题：本地比对答案
      if (quiz.type === 'single-choice' && quiz.answer) {
        const chosen = extractChoiceLetter(userInput);
        if (!chosen) {
          setQuizMessages((prev) => [
            ...prev,
            { id: Date.now() + 1, sender: 'ai', text: '请用 A / B / C / D 作答（例如：C）。', isError: true },
          ]);
          return;
        }

        const correct = String(quiz.answer || '').trim().toUpperCase();
        const isCorrect = chosen === correct;
        const explanation = quiz.explanation ? `\n\n解析：${quiz.explanation}` : '';
        const sourceName = formatSource(quiz.source || null);

        setQuizMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 2,
            sender: 'ai',
            text: `你的答案：${chosen}\n结果：${isCorrect ? '正确' : '错误'}\n正确答案：${correct}${explanation}${sourceName}`,
          },
        ]);

        setActiveQuiz(null);
        return;
      }

      // 简答题：调用后端 AI 阅卷
      if (quiz.type === 'short-answer') {
        const sourceName = formatSource(quiz.source || null);
        if (isNoShortAnswer(userInput)) {
          setQuizMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 2,
              sender: 'ai',
              text: `评分：0/100\n\n你这次没有提供有效作答（例如仅回复“忘记了/不知道/不会”）。按未作答计 0 分。建议写出你记得的关键点或举例，我再帮你按点给分。${sourceName}`,
            },
          ]);
          setActiveQuiz(null);
          return;
        }

        setQuizLoading(true);
        try {
          const res = await axios.post('/ai/grade-answer', {
            question: quiz.question,
            studentAnswer: userInput,
            answerKeyPoints: quiz.answer_key_points || quiz.answer,
          });

          const scoreRaw = res.data?.score;
          const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null;
          const explanation = res.data?.explanation ? String(res.data.explanation) : '';
          // sourceName computed above

          setQuizMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 2,
              sender: 'ai',
              text: `${score === null ? '评分：' : `评分：${score}/100`}\n\n${explanation || '（未返回评语）'}${sourceName}`,
            },
          ]);
        } catch (err) {
          console.error('Grade answer failed:', err);
          setQuizMessages((prev) => [
            ...prev,
            { id: Date.now() + 2, sender: 'ai', text: '判分失败：请稍后再试（或检查后端 AI 配置）。', isError: true },
          ]);
        } finally {
          setQuizLoading(false);
          setActiveQuiz(null);
        }
        return;
      }
    }

    // 没有在答题：提示用户先出题
    const userMessage = { id: Date.now(), text: quizInput, sender: 'user' };
    setQuizMessages((prev) => [...prev, userMessage]);
    setQuizInput('');
    setQuizMessages((prev) => [
      ...prev,
      { id: Date.now() + 1, sender: 'ai', text: '当前没有正在进行的题目。请先点击“随机出题”，再作答。', isError: true },
    ]);
  };

  const handleChatSend = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = { id: Date.now(), text: chatInput, sender: 'user' };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);

    try {
      // 带上最近对话，便于后端理解“继续问/指代”
      const history = [...chatMessages, userMessage]
        .filter((m) => m && (m.sender === 'user' || m.sender === 'ai') && typeof m.text === 'string')
        .slice(-12)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: String(m.text).slice(0, 1000),
        }));

      const response = await axios.post('/ai/rag-qa', { question: userMessage.text, history });
      const aiMessage = { 
        id: Date.now() + 1, 
        text: response.data.answer, 
        sender: 'ai'
      };
      setChatMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = { id: Date.now() + 1, text: '抱歉，我遇到了一些问题，请稍后再试。', sender: 'ai', isError: true };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="agent-page page">
      {view === 'quiz' && (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <h2 style={{ margin: 0 }}>题库文件（随机出题）</h2>
              <span className="badge badge-accent">{studyFiles.length} 个文件</span>
            </div>

            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, minWidth: '240px' }}>
                <label>上传文件（建议一次选择 16 个）</label>
                <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.markdown,.pdf" />
                <div className="help">支持：txt / md / pdf（会提取文本用于出题）</div>
              </div>

              <button className="btn btn-ghost" type="button" onClick={handleUploadFiles} disabled={uploading}>
                {uploading ? '上传中...' : '上传题库'}
              </button>
            </div>

            <div className="row" style={{ marginTop: '0.75rem' }}>
              <div className="field" style={{ minWidth: '180px' }}>
                <label>难度</label>
                <select className="select" value={quizDifficulty} onChange={(e) => setQuizDifficulty(e.target.value)}>
                  <option value="基础">基础</option>
                  <option value="中等">中等</option>
                  <option value="困难">困难</option>
                </select>
              </div>
              <div className="field" style={{ minWidth: '180px' }}>
                <label>题型</label>
                <select className="select" value={quizType} onChange={(e) => setQuizType(e.target.value)}>
                  <option value="single-choice">单选题</option>
                  <option value="short-answer">简答题</option>
                </select>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleRandomQuiz} disabled={quizLoading || uploading}>
                {quizLoading ? '出题中...' : '随机出题'}
              </button>
            </div>

            <div className="studyfile-section" style={{ marginTop: '1rem' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="help" style={{ margin: 0 }}>已上传文件列表（可删除旧文件后重新上传）</div>
                <div className="row" style={{ gap: '0.5rem' }}>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setFilesExpanded((v) => !v)}
                    disabled={uploading || quizLoading || studyFiles.length === 0}
                  >
                    {filesExpanded ? '收起' : '展开'}
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={refreshFiles} disabled={uploading || quizLoading}>
                    刷新
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={handleDeleteAllStudyFiles} disabled={uploading || quizLoading || studyFiles.length === 0}>
                    清空题库
                  </button>
                </div>
              </div>

              {studyFiles.length === 0 ? (
                <div className="help" style={{ marginTop: '0.5rem' }}>当前没有文件。</div>
              ) : !filesExpanded ? (
                <div className="studyfile-collapsed" style={{ marginTop: '0.5rem' }}>
                  <span className="badge badge-muted">共 {studyFiles.length} 个文件</span>
                  <span className="help" style={{ margin: 0 }}>点击“展开”查看并删除单个文件。</span>
                </div>
              ) : (
                <div className="studyfile-list" style={{ marginTop: '0.5rem' }}>
                  {studyFiles.map((f) => (
                    <div key={f._id} className="studyfile-item">
                      <div className="studyfile-main">
                        <div className="studyfile-name">{(f.originalName && !/\uFFFD|[ÃÂÐÑØÞ]/.test(String(f.originalName))) ? f.originalName : (f._id ? `文件-${f._id}` : '文件')}</div>
                        <div className="studyfile-meta">
                          <span className="badge badge-muted">{formatBytes(f.size)}</span>
                          <span className="badge badge-muted">{(f.textLength || 0)} 字</span>
                        </div>
                      </div>
                      <button className="btn btn-ghost" type="button" onClick={() => handleDeleteStudyFile(f._id)}>
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>出题与作答</h2>
              <span className="badge badge-muted">与知识点聊天互不影响</span>
            </div>

            <div className="chat-container" style={{ marginTop: 0 }}>
              <div className="messages-area">
                {quizMessages.map((msg) => (
                  <div key={msg.id} className={`message ${msg.sender}${msg.isError ? ' isError' : ''}`}>
                    <div className="message-bubble">
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{msg.text}</pre>
                    </div>
                  </div>
                ))}
                {quizLoading && (
                  <div className="message ai">
                    <div className="message-bubble typing">出题/判分中...</div>
                  </div>
                )}
                <div ref={quizMessagesEndRef} />
              </div>

              <form className="input-area" onSubmit={handleQuizSend}>
                <input
                  type="text"
                  value={quizInput}
                  onChange={(e) => setQuizInput(e.target.value)}
                  placeholder={activeQuiz ? '输入你的作答（单选 A/B/C/D 或简答内容）...' : '先点击“随机出题”，再在这里作答...'}
                  disabled={quizLoading || uploading}
                />
                <button type="submit" disabled={quizLoading || uploading || !quizInput.trim()}>提交作答</button>
              </form>
            </div>
          </div>
        </>
      )}

      {view === 'chat' && (
        <div className="card">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>知识点聊天</h2>
            <span className="badge badge-muted">与出题互不影响</span>
          </div>

          <div className="chat-container" style={{ marginTop: 0 }}>
            <div className="messages-area">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`message ${msg.sender}${msg.isError ? ' isError' : ''}`}>
                  <div className="message-bubble">
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{msg.text}</pre>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="message ai">
                  <div className="message-bubble typing">AI正在思考...</div>
                </div>
              )}
              <div ref={chatMessagesEndRef} />
            </div>

            <form className="input-area" onSubmit={handleChatSend}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="输入你的知识点问题..."
                disabled={chatLoading}
              />
              <button type="submit" disabled={chatLoading || !chatInput.trim()}>发送</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentPage;
