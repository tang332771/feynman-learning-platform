// src/api/axios.js
import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://localhost:3000/api', // 后端API的基础路径
});

// 添加一个请求拦截器
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token'); // 从localStorage获取token
        if (token) {
            config.headers = config.headers || {};
            config.headers['x-auth-token'] = token; // 将token添加到请求头
        }
        return config;
    },
    (error) => Promise.reject(error)
);

export default apiClient;
