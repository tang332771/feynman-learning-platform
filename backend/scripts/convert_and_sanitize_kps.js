// scripts/convert_and_sanitize_kps.js
// 对于 content 中包含实体编码（如 &lt;script&gt;）的记录，先解码实体为真实标签，
// 再使用 DOMPurify 清洗，最后保存。这样能把原本显示为文本的标签转换为安全的 HTML 元素（如 img），
// 同时移除危险属性（如 onerror）和 <script> 标签。

require('dotenv').config();
const mongoose = require('mongoose');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const purify = DOMPurify(window);
const KnowledgePoint = require('../models/KnowledgePoint');

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function main(){
  try{
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB');

    const kps = await KnowledgePoint.find();
    console.log('Found', kps.length, 'knowledge points');

    let updated = 0;
    for(const kp of kps){
      const hadEntities = /&lt;|&gt;|&amp;/.test(kp.content || '');
      if (!hadEntities) continue;
      const decoded = decodeHtmlEntities(kp.content || '');
      const cleaned = purify.sanitize(decoded);
      if (cleaned !== kp.content) {
        kp.content = cleaned;
        await kp.save();
        updated++;
        console.log(`Converted+sanitized _id=${kp._id}`);
      }
    }

    console.log(`Done. Updated ${updated} / ${kps.length} records.`);
    await mongoose.disconnect();
    process.exit(0);
  }catch(e){
    console.error('Error:', e);
    process.exit(2);
  }
}

main();
