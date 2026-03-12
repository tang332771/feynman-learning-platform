// scripts/sanitize_kps.js
// 一次性脚本：连接 MongoDB，清洗 KnowledgePoint.title 和 content 字段并保存

require('dotenv').config();
const mongoose = require('mongoose');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const purify = DOMPurify(window);

const KnowledgePoint = require('../models/KnowledgePoint');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB');

    const kps = await KnowledgePoint.find();
    console.log('Found', kps.length, 'knowledge points');

    let updated = 0;
    for (const kp of kps) {
      const cleanTitle = purify.sanitize(kp.title || '');
      const cleanContent = purify.sanitize(kp.content || '');
      // Only save if changes were made
      if (cleanTitle !== kp.title || cleanContent !== kp.content) {
        kp.title = cleanTitle;
        kp.content = cleanContent;
        await kp.save();
        updated++;
        console.log(`Sanitized and saved _id=${kp._id}`);
      }
    }

    console.log(`Done. Updated ${updated} / ${kps.length} records.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(2);
  }
}

main();
