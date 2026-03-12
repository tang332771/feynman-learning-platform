import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './LoginPage.css';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const themeRef = useRef(theme);

  // --- New State for Remember Me ---
  const [rememberMe, setRememberMe] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [showAccountList, setShowAccountList] = useState(false);

  // Load saved accounts on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('feynman_saved_accounts') || '[]');
      setSavedAccounts(saved);
    } catch (e) {
      console.error("Failed to load saved accounts", e);
    }
  }, []);

  const saveAccount = (email, password) => {
    let accounts = [...savedAccounts];
    // Remove existing entry for this email if any
    accounts = accounts.filter(acc => acc.email !== email);
    
    // Add new entry to top
    accounts.unshift({
      email,
      password: rememberMe ? btoa(unescape(encodeURIComponent(password))) : null, // Simple encoding
      avatar: email[0].toUpperCase()
    });

    // Limit to 5 accounts
    if (accounts.length > 5) accounts.pop();

    setSavedAccounts(accounts);
    localStorage.setItem('feynman_saved_accounts', JSON.stringify(accounts));
  };

  const deleteAccount = (e, emailToDelete) => {
    e.stopPropagation();
    const newAccounts = savedAccounts.filter(acc => acc.email !== emailToDelete);
    setSavedAccounts(newAccounts);
    localStorage.setItem('feynman_saved_accounts', JSON.stringify(newAccounts));
  };

  const selectAccount = (acc) => {
    setEmail(acc.email);
    if (acc.password) {
      try {
        setPassword(decodeURIComponent(escape(atob(acc.password))));
        setRememberMe(true);
      } catch (e) {
        setPassword('');
      }
    } else {
      setPassword('');
      setRememberMe(false);
    }
    setShowAccountList(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.input-group')) {
        setShowAccountList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check if intro has already played in this session
  const hasPlayed = sessionStorage.getItem('intro_played') === 'true';
  const [introFinished, setIntroFinished] = useState(hasPlayed);
  const [showFlash, setShowFlash] = useState(false);
  const [showLogin, setShowLogin] = useState(hasPlayed);

  // Update theme ref when theme changes
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // --- Animation Effect (Warp -> Flash -> Network) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    
    // State for Warp Animation
    let warpStars = [];
    const warpSpeed = 2;
    let warpTime = 0;

    // State for Network Animation
    let particles = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- Warp Star Class ---
    class WarpStar {
      constructor() {
        this.x = (Math.random() - 0.5) * canvas.width * 2;
        this.y = (Math.random() - 0.5) * canvas.height * 2;
        this.z = Math.random() * canvas.width;
        this.pz = this.z; // Previous Z for trail
      }
      update(speedMultiplier) {
        this.z -= 15 * speedMultiplier; // Move towards camera
        if (this.z < 1) {
          this.z = canvas.width;
          this.x = (Math.random() - 0.5) * canvas.width * 2;
          this.y = (Math.random() - 0.5) * canvas.height * 2;
          this.pz = this.z;
        }
      }
      draw() {
        const x = (this.x / this.z) * canvas.width * 0.5 + canvas.width / 2;
        const y = (this.y / this.z) * canvas.height * 0.5 + canvas.height / 2;
        
        // Trail effect
        const px = (this.x / (this.z + 20)) * canvas.width * 0.5 + canvas.width / 2;
        const py = (this.y / (this.z + 20)) * canvas.height * 0.5 + canvas.height / 2;

        const size = (1 - this.z / canvas.width) * 4;
        const opacity = (1 - this.z / canvas.width);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = size;
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    // --- Network Particle Class ---
    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100, 149, 237, 0.5)';
        ctx.fill();
      }
    }

    // Init Warp Stars
    for(let i=0; i<400; i++) warpStars.push(new WarpStar());

    // Init Network Particles
    const initParticles = () => {
      particles = [];
      const particleCount = Math.min(100, (canvas.width * canvas.height) / 15000);
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };
    initParticles();

    // --- Main Animation Loop ---
    const animate = () => {
      const isDark = themeRef.current === 'dark';
      
      // Clear with fade effect for trails if needed, but here we clear fully
      // Use theme-aware background color
      ctx.fillStyle = isDark ? '#000000' : '#f0f9ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!introFinished) {
        // --- Phase 1: Warp Speed ---
        warpTime += 0.016;
        
        // Speed ramps up exponentially
        const speedMultiplier = 1 + Math.pow(warpTime, 3); 
        
        // Draw Warp Stars
        warpStars.forEach(star => {
          star.update(speedMultiplier);
          // Pass theme context to draw method if needed, or handle here
          // For warp stars, let's keep them white in dark mode, dark blue in light mode
          const x = (star.x / star.z) * canvas.width * 0.5 + canvas.width / 2;
          const y = (star.y / star.z) * canvas.height * 0.5 + canvas.height / 2;
          
          // Trail effect
          const px = (star.x / (star.z + 20)) * canvas.width * 0.5 + canvas.width / 2;
          const py = (star.y / (star.z + 20)) * canvas.height * 0.5 + canvas.height / 2;

          const size = (1 - star.z / canvas.width) * 4;
          const opacity = (1 - star.z / canvas.width);

          ctx.beginPath();
          ctx.strokeStyle = isDark ? `rgba(255, 255, 255, ${opacity})` : `rgba(30, 58, 138, ${opacity})`;
          ctx.lineWidth = size;
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        });

        // Trigger Flash at 2.5s
        if (warpTime > 2.5 && !showFlash) {
           setShowFlash(true);
           // Switch to network mode shortly after flash starts
           setTimeout(() => {
             setIntroFinished(true);
             setShowLogin(true);
             sessionStorage.setItem('intro_played', 'true');
           }, 200); // Wait for flash to cover screen
        }

      } else {
        // --- Phase 2: Calm Network ---
        // Draw connections
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 150) {
              ctx.beginPath();
              // Dark mode: Light Blue lines; Light mode: Dark Blue lines
              const alpha = 0.2 * (1 - distance / 150);
              ctx.strokeStyle = isDark 
                ? `rgba(100, 149, 237, ${alpha})` 
                : `rgba(37, 99, 235, ${alpha})`;
              ctx.lineWidth = 1;
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.stroke();
            }
          }
        }
        // Update and draw particles
        particles.forEach(p => {
          p.update();
          // Draw particle
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = isDark ? 'rgba(100, 149, 237, 0.5)' : 'rgba(37, 99, 235, 0.5)';
          ctx.fill();
        });
      }

      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [introFinished, showFlash]); // Dependencies to ensure state updates inside effect if needed

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await apiClient.post('/users/login', { email, password });
      
      // Save account info if login successful
      saveAccount(email, password);
      
      login(response.data.token, response.data.user);
      navigate('/');
    } catch (err) {
      console.error('登录失败:', err?.response?.data || err);
      setError(err?.response?.data?.msg || '登录失败，请检查邮箱或密码');
    }
  };

  return (
    <div className="login-page-container">
      <canvas ref={canvasRef} className="login-background-canvas" />
      
      {/* Theme Toggle Button */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', zIndex: 100 }}>
        <button 
          onClick={toggleTheme} 
          className="btn btn-ghost"
          style={{ 
            fontSize: '1.5rem', 
            padding: '0.5rem',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(5px)',
            borderRadius: '50%',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(255,255,255,0.2)',
            color: theme === 'light' ? '#0f172a' : '#ffffff'
          }}
          title={theme === 'light' ? '切换到黑夜模式' : '切换到白天模式'}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>

      {/* The Big Bang Flash Overlay */}
      <div className={`warp-flash ${showFlash ? 'active' : ''}`}></div>

      <div className={`login-card-wrapper ${showLogin ? 'visible' : ''}`}>
        <div className="card auth-card glass-card">
          <h1>登录</h1>
          <p className="subtitle">欢迎回来，继续你的费曼学习之旅。</p>

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="stack" style={{ marginTop: '0.9rem' }}>
            <div className="field input-group">
              <label htmlFor="email">邮箱</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  style={{ paddingRight: '30px' }}
                />
                {savedAccounts.length > 0 && (
                  <button
                    type="button"
                    className={`dropdown-toggle ${showAccountList ? 'open' : ''}`}
                    onClick={() => setShowAccountList(!showAccountList)}
                    title="选择已保存账号"
                  >
                    ▼
                  </button>
                )}
                
                {showAccountList && savedAccounts.length > 0 && (
                  <ul className="account-dropdown">
                    {savedAccounts.map((acc) => (
                      <li key={acc.email} className="account-item" onClick={() => selectAccount(acc)}>
                        <div className="account-info">
                          <div className="account-avatar">{acc.avatar}</div>
                          <span className="account-email">{acc.email}</span>
                        </div>
                        <button 
                          className="delete-account-btn"
                          onClick={(e) => deleteAccount(e, acc.email)}
                          title="删除此账号记录"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                required
              />
              <label className="remember-me-checkbox">
                <input 
                  type="checkbox" 
                  checked={rememberMe} 
                  onChange={(e) => setRememberMe(e.target.checked)} 
                />
                记住密码
              </label>
            </div>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>登录</button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '1rem' }} className="help">
              还没有账号？<Link to="/register">去注册</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
