const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FB_PROJECT_ID,
    clientEmail: process.env.FB_CLIENT_EMAIL,
    privateKey: (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  }),
  databaseURL: process.env.FB_DATABASE_URL
});
const db = admin.database();
const sign = s => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(s).digest('hex');
const guestToken = id => `g.${id}.${sign(id)}`;
async function auth(t) {
  if (!t) throw new Error('auth');
  try {
    if (t.startsWith('g.')) {
      const [, id, sig] = t.split('.');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) throw 0;
      return { uid: 'g_' + id, guest: true };
    }
    const d = await admin.auth().verifyIdToken(t);
    return { uid: d.uid, guest: false, email: d.email, name: d.name, pic: d.picture };
  } catch { throw new Error('auth'); }
}
module.exports = { db, auth, guestToken, crypto };
