// test-db.js
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI;
console.log('MONGO_URI present:', !!uri);
console.log('URI preview:', uri ? uri.slice(0,60) + '...' : 'undefined');

mongoose.connect(uri, {
  serverSelectionTimeoutMS: 5000
})
.then(() => {
  console.log('MongoDB connected (test) ✅');
  return mongoose.disconnect();
})
.catch(err => {
  console.error('MongoDB connect error (test):', err);
  process.exit(1);
});