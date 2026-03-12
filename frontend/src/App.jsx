// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProtectedRoute from './components/ProtectedRoute';
import KnowledgePointFormPage from './pages/KnowledgePointFormPage';
import KnowledgePointDetailPage from './pages/KnowledgePointDetailPage';
import FeynmanRecordPage from './pages/FeynmanRecordPage';
import QuizPage from './pages/QuizPage';
import AgentPage from './pages/AgentPage';
import GraphPage from './pages/GraphPage';
import ThreeJSPage from './pages/ThreeJSPage';
import KnowledgeUniversePage from './pages/KnowledgeUniversePage';
import GamePage from './pages/GamePage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        {/* 公共路由 */}
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        {/* 受保护的路由 */}
        <Route element={<ProtectedRoute />}>
          <Route index element={<DashboardPage />} />
          <Route path="agent">
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="quiz" element={<AgentPage view="quiz" />} />
            <Route path="chat" element={<AgentPage view="chat" />} />
          </Route>
          <Route path="graph" element={<GraphPage />} />
          <Route path="3d-world" element={<ThreeJSPage />} />
          <Route path="knowledge-universe" element={<KnowledgeUniversePage />} />
          <Route path="game" element={<GamePage />} />
          <Route path="kp/new" element={<KnowledgePointFormPage />} />
          <Route path="kp/:id" element={<KnowledgePointDetailPage />} />
          <Route path="kp/edit/:id" element={<KnowledgePointFormPage />} />
          <Route path="feynman/:id" element={<FeynmanRecordPage />} />
          <Route path="quiz/:id" element={<QuizPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
export default App;
