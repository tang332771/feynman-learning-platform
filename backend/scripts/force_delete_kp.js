
const mongoose = require('mongoose');
const path = require('path');
const KnowledgePoint = require('../models/KnowledgePoint');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function forceDelete() {
    try {
        console.log('Connecting to MongoDB...');
        const uri = process.env.MONGO_URI || 'mongodb+srv://use123:tyh332771563@cluster0.j2h6ja9.mongodb.net/feynman-db?retryWrites=true&w=majority&appName=Cluster0';
        await mongoose.connect(uri);
        console.log('Connected.');

        // IDs to delete
        const idsToDelete = [
            '693a69ec3688ab817bca65ff', // React Hooks Intro
            '693a69f23688ab817bca6601'  // Vue Composition API
        ];

        // Also delete by regex for safety
        const regex = /React|Vue|路由|Route/i;
        const kps = await KnowledgePoint.find({ 
            $or: [
                { _id: { $in: idsToDelete } },
                { title: { $regex: regex } }
            ]
        });

        if (kps.length > 0) {
            console.log(`Found ${kps.length} KPs to delete:`);
            kps.forEach(k => console.log(`- [${k._id}] ${k.title}`));

            const res = await KnowledgePoint.deleteMany({ 
                _id: { $in: kps.map(k => k._id) } 
            });
            console.log(`Deleted ${res.deletedCount} documents.`);
        } else {
            console.log('No matching KPs found.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected.');
    }
}

forceDelete();
