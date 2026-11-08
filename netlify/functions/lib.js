const admin = require('firebase-admin');
const crypto = require('crypto');
const need = ['FB_PROJECT_ID', 'FB_CLIENT_EMAIL', 'FB_PRIVATE_KEY', 'FB_DATABASE_URL', 'SESSION_SECRET'];
const missing = need.filter(k => !process.env[k]);
// Accepts the key with real newlines, literal \n, quotes or stray spaces, and rebuilds a clean PEM
const pem = raw => {
  const b = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/["'\s]/g, '');
  return '-----BEGIN PRIVATE KEY-----\n' + (b.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
};
let bad = missing.length ? 'Server setup incomplete. Missing variables: ' + missing.join(', ') : null;
if (!bad && !admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FB_PROJECT_ID,
        clientEmail: process.env.FB_CLIENT_EMAIL,
        privateKey: pem(process.env.FB_PRIVATE_KEY)
      }),
      databaseURL: process.env.FB_DATABASE_URL
    });
  } catch (e) { bad = 'Firebase key problem: ' + e.message.slice(0, 120) + ' (key length ' + process.env.FB_PRIVATE_KEY.length + ', expected about 1736)'; }
}
const db = bad ? null : admin.database();
const sign = s => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(s).digest('hex');
const sess = uid => { const p = uid + '.' + (Date.now() + 30 * 864e5); return 's.' + p + '.' + sign(p); };
async function auth(t) {
  if (!t) throw new Error('auth');
  try {
    if (t.startsWith('s.')) {
      const i = t.lastIndexOf('.'), p = t.slice(2, i), [uid, exp] = p.split('.');
      if (!crypto.timingSafeEqual(Buffer.from(t.slice(i + 1)), Buffer.from(sign(p))) || +exp < Date.now()) throw 0;
      return { uid, guest: uid.startsWith('g_') };
    }
    const d = await admin.auth().verifyIdToken(t);
    return { uid: d.uid, guest: false, email: d.email, name: d.name, pic: d.picture };
  } catch { throw new Error('auth'); }
}
module.exports = { db, auth, sess, crypto, bad };
