import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/axios';
import './FeynmanRecordPage.css';

function FeynmanRecordPage() {
  const { id } = useParams();
  const [kpTitle, setKpTitle] = useState('');
  const [status, setStatus] = useState('idle'); // idle | requesting | recording | stopped | uploading
  const [mediaUrl, setMediaUrl] = useState(null);
  const [transcribedText, setTranscribedText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [aiFeedback, setAiFeedback] = useState(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    const fetchKp = async () => {
      try {
        const res = await apiClient.get(`/knowledge-points/${id}`);
        setKpTitle(res.data.title || '');
      } catch (err) {
        console.error('获取知识点失败', err);
      }
    };
    fetchKp();
    return () => {
      // cleanup
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [id]);

  const startRecording = async () => {
    setTranscribedText('');
    setMediaUrl(null);
    try {
      setStatus('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.onstart = () => {
        setStatus('recording');
      };
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        setStatus('stopped');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setMediaUrl(url);
        // automatically upload
        await uploadAudioBlob(blob);
      };

      mr.start();
    } catch (err) {
      console.error('startRecording error', err);
      setStatus('idle');
      alert('无法访问麦克风：请检查权限或在 HTTPS/localhost 下运行');
    }
  };

  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    } catch (err) {
      console.error('stopRecording error', err);
    }
  };

  const getAiEvaluation = async (transcribed) => {
    setIsEvaluating(true);
    setAiFeedback(null);
    try {
      // 获取原始知识点内容
      const kpResponse = await apiClient.get(`/knowledge-points/${id}`);
      const originalContent = kpResponse.data.content;

      const feedbackResponse = await apiClient.post('/audio/evaluate', {
        originalContent: originalContent,
        transcribedText: transcribed
      });

      const feedback = feedbackResponse.data;
      setAiFeedback(feedback);

      // 自动更新知识点状态逻辑
      if (feedback && typeof feedback.score === 'number') {
        let newStatus = 'in_progress';
        if (feedback.score >= 80) {
          newStatus = 'mastered';
        }
        
        // 只有当状态确实需要升级时才更新（可选优化，这里简单起见直接更新）
        try {
          await apiClient.put(`/knowledge-points/${id}`, {
            status: newStatus
          });
          console.log(`知识点状态已自动更新为: ${newStatus}`);
        } catch (updateErr) {
          console.error('自动更新知识点状态失败', updateErr);
        }
      }

    } catch (error) {
      console.error('获取AI评价失败', error);
    } finally {
      setIsEvaluating(false);
    }
  };

  const uploadAudioBlob = async (blob) => {
    setIsUploading(true);
    setTranscribedText('');
    setStatus('uploading');
    try {
      // create a file (use webm extension but backend should accept common audio types)
      const file = new File([blob], `feynman-${id}.webm`, { type: blob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('knowledgePointId', id);

      const res = await apiClient.post('/audio/transcribe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const resultText = res.data?.result;
      setTranscribedText(resultText || '（无转录结果）');

      if (resultText) {
        getAiEvaluation(resultText);
      }

    } catch (err) {
      console.error('上传或转录失败', err);
      setTranscribedText('转录失败，请重试。');
    } finally {
      setIsUploading(false);
      setStatus('idle');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">复述知识点：{kpTitle}</h1>
          <p className="page-subtitle">录音后会自动转录，并给出 AI 教练反馈与得分。</p>
        </div>
      </div>

      <div className="card">
        {(() => {
          const getButtonConfig = () => {
            switch (status) {
              case 'recording':
                return { 
                  className: 'recording', 
                  text: '停止录音', 
                  icon: '⏹',
                  onClick: stopRecording, 
                  disabled: false 
                };
              case 'requesting':
              case 'uploading':
                return { 
                  className: 'processing', 
                  text: status === 'requesting' ? '准备中...' : '处理中...', 
                  icon: '⏳',
                  onClick: null, 
                  disabled: true 
                };
              case 'idle':
              case 'stopped':
              default:
                return { 
                  className: 'idle', 
                  text: '开始录音', 
                  icon: '🎙',
                  onClick: startRecording, 
                  disabled: false 
                };
            }
          };
          const btnConfig = getButtonConfig();

          return (
            <div className="record-button-container">
              <button 
                className={`record-btn ${btnConfig.className}`}
                onClick={btnConfig.onClick}
                disabled={btnConfig.disabled}
              >
                <span className="record-icon">{btnConfig.icon}</span>
                <span>{btnConfig.text}</span>
              </button>
              <div className="record-status-text">
                {status === 'idle' && '点击按钮开始复述'}
                {status === 'recording' && '正在录音...'}
                {status === 'uploading' && '正在上传并分析...'}
                {status === 'requesting' && '正在请求麦克风权限...'}
                {status === 'stopped' && '录音完成，准备上传...'}
              </div>
            </div>
          );
        })()}

        {mediaUrl && (
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <div className="help">录音回放</div>
            <audio src={mediaUrl} controls style={{ width: '100%', maxWidth: '400px', marginTop: '0.5rem' }} />
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-header">
          <h2 style={{ margin: 0 }}>AI 转录结果</h2>
          {isUploading && <span className="badge badge-accent">转录中...</span>}
        </div>
        {isUploading && <p className="help">正在上传并转录，请稍候...</p>}
        <div className="card soft" style={{ minHeight: '140px' }}>
          {transcribedText || <span className="help">暂无转录内容</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-header">
          <h2 style={{ margin: 0 }}>AI 教练反馈</h2>
          {isEvaluating && <span className="badge badge-purple">批阅中...</span>}
        </div>

        {isEvaluating && <p className="help">AI 教练正在批阅您的答卷...</p>}

        {aiFeedback && (
          <div className="stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="help">综合得分</div>
                <div style={{ fontSize: '2.6rem', fontWeight: 900, color: aiFeedback.score > 80 ? 'var(--success)' : 'var(--warning)' }}>
                  {aiFeedback.score}
                </div>
              </div>
              <span className={`badge ${aiFeedback.score > 80 ? 'badge-success' : 'badge-warning'}`}>
                {aiFeedback.score > 80 ? '掌握良好' : '继续加油'}
              </span>
            </div>

            <div>
              <h3>AI 润色后的文本</h3>
              <div className="alert" style={{ whiteSpace: 'pre-wrap' }}>{aiFeedback.polishedText}</div>
            </div>

            <div>
              <h3>综合评价</h3>
              <p style={{ marginBottom: 0 }}>{aiFeedback.evaluation}</p>
            </div>

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <h3>优点</h3>
                <ul style={{ marginTop: 0 }}>
                  {aiFeedback.strengths && aiFeedback.strengths.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <h3>待改进</h3>
                <ul style={{ marginTop: 0 }}>
                  {aiFeedback.weaknesses && aiFeedback.weaknesses.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {!aiFeedback && !isEvaluating && (
          <div className="help">完成一次录音并转录后，这里会显示反馈。</div>
        )}
      </div>
    </div>
  );
}

export default FeynmanRecordPage;
