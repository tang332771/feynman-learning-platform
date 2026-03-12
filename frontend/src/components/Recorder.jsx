import React, { useState, useRef, useEffect } from 'react';
import { convertBlobToWav16kMono } from '../utils/audioConvert';

export default function Recorder({ onTranscriptionComplete }) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstart = () => setStatus('recording');
      mr.onstop = async () => {
        setStatus('processing');
        const rawBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
          const wavBlob = await convertBlobToWav16kMono(rawBlob);
          await uploadWav(wavBlob);
        } catch (err) {
          console.error('转换或上传失败', err);
          setStatus('error');
        } finally {
          setRecording(false);
          setStatus('idle');
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      console.error('无法获取麦克风', err);
      setStatus('error');
    }
  };

  const stop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const uploadWav = async (wavBlob) => {
    const fd = new FormData();
    const file = new File([wavBlob], 'record.wav', { type: 'audio/wav' });
    fd.append('file', file);
    setStatus('uploading');
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('authToken');
      const headers = token ? { 'x-auth-token': token } : {};
      const res = await fetch('/api/audio/transcribe?debug=1', { method: 'POST', headers, body: fd });
      const data = await res.json();
      const text = data?.result ?? (typeof data === 'string' ? data : JSON.stringify(data));
      if (onTranscriptionComplete) onTranscriptionComplete(text);
      setStatus('done');
    } catch (err) {
      console.error('上传失败', err);
      setStatus('error');
    }
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div>
        <button type="button" onClick={start} disabled={recording} style={{ marginRight: 8 }}>
          开始录音
        </button>
        <button type="button" onClick={stop} disabled={!recording}>
          停止
        </button>
        <span style={{ marginLeft: 12 }}>{status}</span>
      </div>
    </div>
  );
}
