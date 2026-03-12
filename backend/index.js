        // backend/index.js
        const express = require('express');
        const cors = require('cors'); // 1. 引入cors
        const mongoose = require('mongoose');
        const fs = require('fs');
        const path = require('path');
        require('dotenv').config({ path: path.resolve(__dirname, '.env') });

        const app = express();
        
        // ...
        
        // --- 中间件 ---
        app.use(cors()); // 2. 在所有路由之前使用cors中间件
        app.use(express.json());

        // --- 路由 ---
        app.use('/api/users', require('./routes/users'));
        app.use('/api/knowledge-points', require('./routes/knowledgePoints'));
        // audio routes (upload & transcription)
        app.use('/api/audio', require('./routes/audio'));
        // AI routes
        app.use('/api/ai', require('./routes/ai'));
        // study files (upload & list)
        app.use('/api/files', require('./routes/files'));
        // Graph routes (knowledge map)
        app.use('/api/graph', require('./routes/graph'));
const port = process.env.PORT || 3000;
// 全局错误日志函数，方便将堆栈写入文件
function logErrorToFile(err) {
        try {
                const entry = `[${new Date().toISOString()}] ${err && err.stack ? err.stack : String(err)}\n`;
                fs.appendFileSync('./server.log', entry);
        } catch (e) {
                console.error('Failed to write to server.log', e);
        }
}

process.on('uncaughtException', (err) => {
        console.error('uncaughtException', err);
        logErrorToFile(err);
});

process.on('unhandledRejection', (reason) => {
        console.error('unhandledRejection', reason);
        logErrorToFile(reason);
});

// 启动顺序：尝试连接 MongoDB，无论成功与否都启动 HTTP 服务
async function start() {
        try {
                await mongoose.connect(process.env.MONGO_URI, {
                        serverSelectionTimeoutMS: 5000, // Reduce timeout to start faster
                });
                console.log('MongoDB connected');
        } catch (err) {
                console.error('Failed to connect to MongoDB (Server will start in Offline Mode)', err);
                logErrorToFile(err);
                // Do NOT exit. Allow server to run for fallback functionality.
        }

        try {
                app.listen(port, () => {
                        console.log(`Server is running on port ${port}`);
                });
        } catch (e) {
                console.error('Failed to start HTTP server', e);
                process.exit(1);
        }
}

start();
        // ...