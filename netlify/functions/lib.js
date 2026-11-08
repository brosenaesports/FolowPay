const admin = require('firebase-admin');
const crypto = require('crypto');
const need = ['FB_PROJECT_ID', 'FB_CLIENT_EMAIL', 'FB_PRIVATE_KEY', 'FB_DATABASE_URL', 'SESSION_SECRET'];
const missing = need.filter(k => !process.env[k]);
let bad = missing.length ? 'Server setup incomplete. Missing variables: ' + missing.join(', ') : null;
if (!bad && !admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FB_PROJECT_ID,
        clientEmail: process.env.FB_CLIENT_EMAIL,
        privateKey: process.env.FB_PRIVATE_KEY.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FB_DATABASE_URL
    });
  } catch (e) { bad = 'Firebase key problem: ' + e.message.slice(0, 120); }
}
const db = bad ? null : admin.database();
const sign = s => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(s).digest('hex');
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
module.exports = { db, auth, guestToken, crypto, bad };
