const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const KnowledgePoint = require('../models/KnowledgePoint');

async function cleanupDuplicates() {
    const uri = process.env.MONGO_URI;
    try {
        await mongoose.connect(uri);
        console.log("Connected to DB");
        
        const kps = await KnowledgePoint.find({}, 'title');
        const titleMap = new Map();
        const duplicates = [];

        kps.forEach(kp => {
            if (titleMap.has(kp.title)) {
                duplicates.push(kp._id);
            } else {
                titleMap.set(kp.title, kp._id);
            }
        });

        console.log(`Found ${duplicates.length} duplicates.`);
        if (duplicates.length > 0) {
            const res = await KnowledgePoint.deleteMany({ _id: { $in: duplicates } });
            console.log(`Deleted ${res.deletedCount} duplicate documents.`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

cleanupDuplicates();
