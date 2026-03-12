import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('token');
    } catch {
      // ignore storage access errors (e.g., in some restricted environments)
      return null;
    }
  });
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (token) {
      try {
        localStorage.setItem('token', token);
      } catch {}
    } else {
      try {
        localStorage.removeItem('token');
      } catch {}
    }
  }, [token]);

  useEffect(() => {
    if (user) {
      try {
        localStorage.setItem('user', JSON.stringify(user));
      } catch {}
    } else {
      try {
        localStorage.removeItem('user');
      } catch {}
    }
  }, [user]);

  const login = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const value = { token, user, login, logout };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext);
}
