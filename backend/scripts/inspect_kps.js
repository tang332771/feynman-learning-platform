const mongoose = require('mongoose');
const path = require('path');
const KnowledgePoint = require('../models/KnowledgePoint');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function inspectData() {
    try {
        const uri = process.env.MONGO_URI || 'mongodb+srv://use123:tyh332771563@cluster0.j2h6ja9.mongodb.net/feynman-db?retryWrites=true&w=majority&appName=Cluster0';
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const kps = await KnowledgePoint.find({}, 'title');
        console.log('--- All Knowledge Points ---');
        kps.forEach(kp => {
            console.log(`[${kp._id}] ${kp.title}`);
        });
        console.log('----------------------------');
        console.log(`Total: ${kps.length}`);

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

inspectData();
