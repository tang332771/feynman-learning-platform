import { useState, useEffect } from 'react';
import apiClient from '../api/axios';
import './GamePage.css';

function GamePage() {
  const [gameData, setGameData] = useState(null);
  const [nextGameData, setNextGameData] = useState(null); // Buffer for the next question
  const [loading, setLoading] = useState(true);
  const [selectedOption, setSelectedOption] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [error, setError] = useState(null);

  // Helper to fetch a single riddle without affecting UI state immediately
  const fetchSingleRiddle = async () => {
    try {
      const response = await apiClient.post('/ai/generate-riddle');
      return response.data;
    } catch (err) {
      console.error("Failed to fetch riddle", err);
      return null;
    }
  };

  // Initial load
  useEffect(() => {
    const initGame = async () => {
      setLoading(true);
      setError(null);
      
      // 1. Fetch the first question
      const firstData = await fetchSingleRiddle();
      if (firstData) {
        setGameData(firstData);
        setLoading(false);
        
        // 2. Start prefetching the next one in background
        const nextData = await fetchSingleRiddle();
        if (nextData) setNextGameData(nextData);
      } else {
        setError("AI 出题失败，请稍后再试。");
        setLoading(false);
      }
    };

    initGame();
  }, []);

  const handleOptionClick = (option) => {
    if (showResult) return;
    setSelectedOption(option);
    setShowResult(true);
    if (option === gameData.answer) {
      setScore(s => s + 1);
    }
  };

  const handleNext = async () => {
    setRound(r => r + 1);
    setShowResult(false);
    setSelectedOption(null);
    
    if (nextGameData) {
      // Fast path: Use preloaded data
      setGameData(nextGameData);
      setNextGameData(null); // Clear buffer
      
      // Trigger background fetch for the *next* next one
      fetchSingleRiddle().then(data => {
        if (data) setNextGameData(data);
      });
    } else {
      // Slow path: User played faster than AI, show loading
      setLoading(true);
      const data = await fetchSingleRiddle();
      if (data) {
        setGameData(data);
        setLoading(false);
        // Start prefetching again
        fetchSingleRiddle().then(next => {
          if (next) setNextGameData(next);
        });
      } else {
        setError("获取题目失败，请重试");
        setLoading(false);
      }
    }
  };

  const retryInit = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="page game-page">
        <div className="loading-container">
          <div className="ai-avatar-pulse">🤖</div>
          <h2>AI 正在阅读知识库...</h2>
          <p>正在为你生成专属谜题</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page game-page">
        <div className="error-container">
          <h2>😵 出错了</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={retryInit}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page game-page">
      <div className="game-header">
        <div className="score-board">
          <span>第 {round} 关</span>
          <span className="score">得分: {score}</span>
        </div>
        <h1 className="page-title">AI 知识侦探</h1>
        <p className="page-subtitle">猜猜 AI 描述的是哪个知识点？</p>
      </div>

      <div className="riddle-card">
        <div className="riddle-content">
          <span className="quote-mark">“</span>
          {gameData?.riddle}
          <span className="quote-mark">”</span>
        </div>
      </div>

      <div className="options-grid">
        {gameData?.options.map((option, index) => {
          let className = "game-option-btn";
          if (showResult) {
            if (option === gameData.answer) className += " correct";
            else if (option === selectedOption) className += " wrong";
            else className += " disabled";
          }
          
          return (
            <button 
              key={index} 
              className={className}
              onClick={() => handleOptionClick(option)}
              disabled={showResult}
            >
              {option}
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className="result-panel">
          <div className={`result-header ${selectedOption === gameData.answer ? 'success' : 'failure'}`}>
            {selectedOption === gameData.answer ? '🎉 回答正确！' : '😅 答错了...'}
          </div>
          <div className="result-explanation">
            <strong>AI 解析：</strong>
            <p>{gameData.explanation}</p>
            <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
              (题目来源知识点: <strong>{gameData.answer}</strong>)
            </div>
          </div>
          <button className="btn btn-primary next-btn" onClick={handleNext}>
            下一题 ➡️
          </button>
        </div>
      )}
    </div>
  );
}

export default GamePage;
