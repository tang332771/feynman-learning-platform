require('dotenv').config();
const mongoose = require('mongoose');
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const purify = DOMPurify(window);
const KnowledgePoint = require('../models/KnowledgePoint');

function maskId(id){
  if(!id) return id;
  const s = String(id);
  return s.slice(0,6) + '...' + s.slice(-4);
}

async function main(){
  try{
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const kps = await KnowledgePoint.find().sort({ createdAt: -1 }).limit(10);
    const safeKps = kps.map(kp => ({
      _id: maskId(kp._id.toString()),
      user: kp.user ? (kp.user.toString ? maskId(kp.user.toString()) : String(kp.user)) : null,
      title: purify.sanitize(kp.title || ''),
      content: purify.sanitize(kp.content || ''),
      status: kp.status,
      createdAt: kp.createdAt,
      updatedAt: kp.updatedAt
    }));
    console.log(JSON.stringify(safeKps, null, 2));
    await mongoose.disconnect();
  }catch(e){
    console.error('Error:', e);
    process.exit(1);
  }
}
main();
