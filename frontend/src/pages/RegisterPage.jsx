import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './LoginPage.css'; // Reuse Login Page Styles

function RegisterPage() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();
  const canvasRef = useRef(null);
  const { theme, toggleTheme } = useTheme();
  const themeRef = useRef(theme);

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
        if (this.z <= 0) {
          this.z = canvas.width;
          this.pz = this.z;
          this.x = (Math.random() - 0.5) * canvas.width * 2;
          this.y = (Math.random() - 0.5) * canvas.height * 2;
        }
        this.pz = this.z;
      }
      draw() {
        const x = (this.x / this.z) * canvas.width + canvas.width / 2;
        const y = (this.y / this.z) * canvas.height + canvas.height / 2;
        
        // Trail effect
        const px = (this.x / (this.z + 20)) * canvas.width + canvas.width / 2;
        const py = (this.y / (this.z + 20)) * canvas.height + canvas.height / 2;

        if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
          const size = (1 - this.z / canvas.width) * 3;
          const alpha = (1 - this.z / canvas.width);
          
          ctx.beginPath();
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.lineWidth = size;
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
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

        // Trigger Flash at 1.5s (Faster for register page)
        if (warpTime > 1.5 && !showFlash) {
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
  }, [introFinished, showFlash]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await apiClient.post('/users/register', formData);
      console.log('注册成功:', response.data);
      // Auto login after register
      login(response.data.token, response.data.user);
      navigate('/');
    } catch (err) {
      console.error('注册失败:', err?.response?.data || err);
      setError(err?.response?.data?.msg || '注册失败，请稍后再试');
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
          <h1>注册</h1>
          <p className="subtitle">创建账号后即可管理你的知识点。</p>

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="stack" style={{ marginTop: '0.9rem' }}>
            <div className="field">
              <label htmlFor="username">用户名</label>
              <input
                id="username"
                name="username"
                className="input"
                type="text"
                value={formData.username}
                onChange={handleChange}
                placeholder="请输入用户名"
                autoComplete="username"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="email">邮箱</label>
              <input
                id="email"
                name="email"
                className="input"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                name="password"
                className="input"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="请输入密码"
                autoComplete="new-password"
                required
              />
              <div className="help">建议使用包含字母与数字的组合。</div>
            </div>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>注册</button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '1rem' }} className="help">
              已有账号？<Link to="/login">去登录</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
