const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function checkConnection() {
    const uri = process.env.MONGO_URI;
    console.log("Attempting to connect to MongoDB...");
    // Mask the password in the log
    console.log("URI:", uri.replace(/:([^:@]+)@/, ':****@'));

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log("MongoDB Connected Successfully!");
        
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log("Collections:", collections.map(c => c.name));

        const kpCount = await mongoose.connection.db.collection('knowledgepoints').countDocuments();
        console.log("KnowledgePoints count:", kpCount);

    } catch (err) {
        console.error("MongoDB Connection Failed:", err.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkConnection();
