const { db, auth, sess, crypto, bad } = require('./lib');
const R = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const RE = { youtube: /^@[A-Za-z0-9._-]{3,30}$/, instagram: /^[A-Za-z0-9._]{1,30}$/ };
const key = h => h.toLowerCase().replace(/^@/, '').replace(/\./g, ',');
const DAY = 864e5;

exports.handler = async e => {
  if (e.httpMethod !== 'POST') return R(405, { error: 'POST only' });
  if (bad) return R(500, { error: bad });
  let b; try { b = JSON.parse(e.body || '{}'); } catch { return R(400, { error: 'Bad request' }); }
  try {
    if (b.action === 'guest') {
      const uid = 'g_' + crypto.randomBytes(12).toString('hex');
      await db.ref('users/' + uid).set({ points: 0, guest: true, created: Date.now() });
      return R(200, { token: sess(uid) });
    }
    const u = await auth(b.token);
    const ur = db.ref('users/' + u.uid);
    const [us, ps] = await Promise.all([ur.get(), b.action === 'me' ? db.ref('userProfiles/' + u.uid).get() : null]);
    let me = us.val();
    if (!me) {
      me = { points: 0, guest: u.guest, created: Date.now(), email: u.email || null, name: u.name || null, pic: u.pic || null };
      await ur.set(me);
    }
    if (b.action === 'login') return R(200, { token: sess(u.uid) });
    if (b.action === 'me') return R(200, { user: me, profiles: ps.val() || {} });
    const g = (await require('./game')(b, u, me, ur, R)) || (await require('./pay')(b, u, me, ur, R));
    if (g) return g;
    const p = b.platform; let h = String(b.handle || '').trim();
    if (!RE[p]) return R(400, { error: 'Unknown platform' });
    if (p === 'youtube' && h && h[0] !== '@') h = '@' + h;
    if (p === 'instagram') h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '');
    if (!RE[p].test(h)) return R(400, { error: p === 'youtube' ? 'Enter a handle like @AKGAMER-s8s' : 'Enter a valid Instagram username' });
    const k = key(h), mine = db.ref(`userProfiles/${u.uid}/${p}`);
    if (b.action === 'bind') {
      const have = (await mine.get()).val() || {};
      if (!have[k] && Object.keys(have).length >= 3) return R(400, { error: 'You can link up to 3 profiles per platform' });
      const t = await db.ref(`profiles/${p}/${k}`).transaction(c => c || { uid: u.uid, at: Date.now() });
      if (t.snapshot.val().uid !== u.uid) return R(409, { error: 'This profile is linked to another account. Remove it there first.' });
      if (!have[k]) await mine.child(k).set({ handle: h, at: Date.now() });
      return R(200, { ok: true });
    }
    if (b.action === 'remove') {
      const v = (await mine.child(k).get()).val();
      if (!v) return R(404, { error: 'Profile not found' });
      if (Date.now() - v.at < DAY) return R(400, { error: 'You can remove a profile 24 hours after linking it' });
      await mine.child(k).remove();
      await db.ref(`profiles/${p}/${k}`).remove();
      return R(200, { ok: true });
    }
    return R(400, { error: 'Unknown action' });
  } catch (err) {
    return err.message === 'auth' ? R(401, { error: 'Please sign in again' }) : R(500, { error: 'Server error' });
  }
};
