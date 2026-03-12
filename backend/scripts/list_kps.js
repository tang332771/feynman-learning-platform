const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const KnowledgePoint = require('../models/KnowledgePoint');

async function listKPs() {
    const uri = process.env.MONGO_URI;
    try {
        await mongoose.connect(uri);
        console.log("Connected to DB");
        
        const kps = await KnowledgePoint.find({}, 'title content');
        console.log("Found " + kps.length + " KPs:");
        kps.forEach(kp => {
            console.log(`- ID: ${kp._id}`);
            console.log(`  Title: ${kp.title}`);
            console.log(`  Content Preview: ${kp.content ? kp.content.substring(0, 50) : 'NULL'}...`);
            console.log('---');
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

listKPs();
