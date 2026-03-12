const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

async function runTest() {
    try {
        console.log('Starting RAG Verification Test...');

        // 1. Register/Login
        const user = { 
            username: 'ragtestuser_' + Date.now(), 
            email: 'ragtest_' + Date.now() + '@example.com',
            password: 'password123' 
        };
        let token;
        
        console.log('Registering user...');
        try {
            const res = await axios.post(API_URL + '/users/register', user);
            token = res.data.token;
            console.log('User registered and logged in.');
        } catch (e) {
            console.error('Registration failed:', e.message);
            if (e.response) {
                console.error('Response data:', e.response.data);
            }
            return;
        }

        const config = { headers: { 'x-auth-token': token } };

        // 2. Create KP 1
        console.log('Creating KP 1 (React Hooks)...');
        try {
            const kp1Res = await axios.post(API_URL + '/knowledge-points', {
                title: 'React Hooks Intro',
                content: 'Hooks are a new addition in React 16.8. They let you use state and other React features without writing a class. Common hooks include useState and useEffect.'
            }, config);
            console.log('KP 1 Created:', kp1Res.data._id);
            
            // Wait for async vectorization
            console.log('Waiting for vectorization (5s)...');
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
             console.error('KP 1 Creation failed:', e.message);
             if (e.response) console.error(e.response.data);
        }

        // 4. Query RAG
        console.log('Querying RAG: "What are hooks?"...');
        try {
            const ragRes = await axios.post(API_URL + '/ai/rag-qa', {
                question: 'What are hooks?'
            }, config);
            console.log('RAG Answer:', ragRes.data.answer);
            console.log('Sources:', ragRes.data.sources);
        } catch (e) {
            console.error('RAG Query failed:', e.message);
            if (e.response) {
                console.error('Response status:', e.response.status);
                console.error('Response data:', e.response.data);
            }
        }

        console.log('Test sequence completed.');

    } catch (error) {
        console.error('Test failed:', error.response ? error.response.data : error.message);
    }
}

runTest();
