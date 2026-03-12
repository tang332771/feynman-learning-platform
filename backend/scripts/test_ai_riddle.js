const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');

// Mock helpers
const isTransientAxiosError = (error) => {
    const code = error.code;
    const status = error.response?.status;
    const message = String(error?.message || '').toLowerCase();
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EAI_AGAIN') return true;
    if (status && status >= 500) return true;
    if (message.includes('timeout') || message.includes('network')) return true;
    return false;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getQianfanAccessToken() {
    const AK = process.env.BAIDU_APP_ID || process.env.BAIDU_API_KEY; // Note: In controller it uses BAIDU_API_KEY as AK for token? Let's check controller logic.
    // Actually controller uses BAIDU_API_KEY and BAIDU_SECRET_KEY for token.
    // Let's check the controller's getQianfanAccessToken implementation.
    // For now, I'll just copy the logic if I can find it.
    // But wait, the controller uses process.env.BAIDU_API_KEY for both V3 key and V1 AK?
    // Let's re-read the controller's getQianfanAccessToken.
    
    const API_KEY = process.env.BAIDU_API_KEY;
    const SECRET_KEY = process.env.BAIDU_SECRET_KEY;
    
    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`;
    try {
        const response = await axios.post(url);
        return response.data.access_token;
    } catch (error) {
        console.error('AccessToken Error:', error);
        throw error;
    }
}

async function callBaiduAI(messages) {
    const apiKey = (process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY || '').trim();
    console.log('callBaiduAI called with apiKey prefix:', apiKey.substring(0, 10));

    if (apiKey.startsWith('bce-v3')) {
        const url = "https://qianfan.baidubce.com/v2/chat/completions";
        const sendOnce = async () => {
            console.log('Sending request to V2 API...');
            const response = await axios.post(url, {
                model: "ernie-speed-8k",
                messages: messages
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 60000
            });
            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content;
            }
            console.error('Unexpected V2 API response structure:', JSON.stringify(response.data));
            return undefined;
        };
        return await sendOnce();
    } else {
        const accessToken = await getQianfanAccessToken();
        const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed?access_token=${accessToken}`;
        const sendOnce = async () => {
            const response = await axios.post(url, { messages: messages }, { timeout: 60000 });
            return response.data.result;
        };
        return await sendOnce();
    }
}

async function testRiddle() {
    const kp = {
        title: "费曼技巧",
        content: "费曼技巧是一种学习方法，核心在于通过用简单的语言向别人解释概念来检验自己的理解。它包含四个步骤：选择概念、向他人复述、查漏补缺、简化语言。"
    };

    const prompt = `
        你是一个知识渊博的谜题设计者。请根据以下知识点生成一个有趣的谜题。

        【知识点标题】: ${kp.title}
        【知识点内容】: ${kp.content}...

        请生成：
        1. 一个“谜面”（riddle）：描述这个概念，但绝对不能直接包含标题中的词汇。谜面应该有趣且具有挑战性。
        2. 三个“干扰项”（distractors）：与该知识点相关但错误的标题。
        3. 一个“解析”（explanation）：简要解释为什么谜底是这个标题。

        请以纯JSON格式返回，格式如下：
        {
            "riddle": "...",
            "options": ["正确标题", "干扰项1", "干扰项2", "干扰项3"],
            "answer": "正确标题",
            "explanation": "..."
        }
        注意：options数组中必须包含正确标题，且顺序打乱（不要总是把正确答案放在第一个）。
    `;

    try {
        console.log("Sending prompt to AI...");
        const resultText = await callBaiduAI([{ role: 'user', content: prompt }]);
        console.log("AI Response:", resultText);
        
        let jsonResult;
        try {
            let jsonStr = resultText;
            const firstOpen = resultText.indexOf('{');
            const lastClose = resultText.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) {
                jsonStr = resultText.substring(firstOpen, lastClose + 1);
            }
            jsonResult = JSON.parse(jsonStr);
            console.log("Parsed JSON:", jsonResult);
        } catch (e) {
            console.error('Failed to parse riddle result:', e);
        }

    } catch (error) {
        console.error("Test failed:", error);
    }
}

testRiddle();
