// src/components/Layout.jsx
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

function Layout() {
  const { token, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    // 跳转到登录页
    navigate('/login');
  };

  return (
    <div className="app-layout" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav>
        <div className="container nav-inner">
          <div className="nav-left">
            <Link to="/" className="nav-brand">
              <span style={{ fontSize: '1.5rem' }}>⚛</span> 费曼学习平台
            </Link>
            {token && (
              <>
                <div className="nav-dropdown">
                  <Link to="/agent/chat" className="nav-link">AI助手</Link>
                  <div className="nav-dropdown-menu">
                    <Link to="/agent/quiz" className="nav-dropdown-item">出题</Link>
                    <Link to="/agent/chat" className="nav-dropdown-item">根据知识点聊天</Link>
                  </div>
                </div>
                <Link to="/graph" className="nav-link">知识图谱</Link>
                <Link to="/3d-world" className="nav-link">3D视界</Link>
                <Link to="/knowledge-universe" className="nav-link">知识宇宙</Link>
                <Link to="/game" className="nav-link">知识游戏</Link>
              </>
            )}
          </div>

          <div className="nav-right">
            <button 
              onClick={toggleTheme} 
              className="nav-link-button nav-link" 
              style={{ marginRight: '1rem', fontSize: '1.2rem' }}
              title={theme === 'light' ? '切换到黑夜模式' : '切换到白天模式'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            {token ? (
              <>
                {user && <span className="nav-link" style={{ cursor: 'default', fontWeight: 'bold' }}>{user.email}</span>}
                <button onClick={handleLogout} className="nav-link-button nav-link">退出登录</button>
              </>
            ) : (
              <>
                <Link to="/login" className="nav-link">登录</Link>
                <Link to="/register" className="btn btn-primary btn-sm" style={{ color: 'white', textDecoration: 'none' }}>注册</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="app-main" style={{ flex: 1 }}>
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>© {new Date().getFullYear()} 费曼学习平台. All rights reserved.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            大前端与AI实战课程项目
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
