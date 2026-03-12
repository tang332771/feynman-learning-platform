require('dotenv').config();
const { addKnowledgePointToStore } = require('./services/vectorStoreService');

async function test() {
    console.log('Testing Vector Store Service...');
    const dummyKp = {
        _id: 'test_id_' + Date.now(),
        user: 'test_user',
        title: '测试标题',
        content: 'This is a test knowledge point to verify the vector store service.'
    };

    try {
        await addKnowledgePointToStore(dummyKp);
        console.log('Test completed.');
    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
