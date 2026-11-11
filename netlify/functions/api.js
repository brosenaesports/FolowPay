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
    if (typeof b.action === 'string' && b.action.startsWith('adm')) return await require('./admin')(b, R);
    if (b.action === 'guest') {
      const uid = 'g_' + crypto.randomBytes(12).toString('hex');
      await db.ref('users/' + uid).set({ points: 0, guest: true, created: Date.now() });
      return R(200, { token: sess(uid) });
    }
    const u = await auth(b.token);
    if (b.action === 'login') {                                       // Google sign-in (linked guests keep their old account)
      const al = (await db.ref('links/' + u.uid).get()).val(), uid = al || u.uid;
      if (!al && !(await db.ref('users/' + uid).get()).exists())
        await db.ref('users/' + uid).set({ points: 0, guest: false, created: Date.now(), email: u.email || null, name: u.name || null, pic: u.pic || null });
      return R(200, { token: sess(uid) });
    }
    if (b.action === 'linkGoogle') {                                  // guest -> Google, nothing is moved
      if (!u.guest) return R(400, { error: 'Your account is already linked to Google' });
      let g; try { g = await auth(b.idToken); } catch { return R(400, { error: 'Google sign-in could not be verified' }); }
      const [x, y] = await Promise.all([db.ref('users/' + g.uid).get(), db.ref('links/' + g.uid).get()]);
      if (x.exists() || y.exists()) return R(409, { error: 'This Google account already has its own data. Sign in with it directly instead.' });
      await db.ref('links/' + g.uid).set(u.uid);
      await db.ref('users/' + u.uid).update({ guest: false, email: g.email || null, name: g.name || null, pic: g.pic || null });
      return R(200, { ok: true });
    }
    const ur = db.ref('users/' + u.uid);
    const NEED = ['me', 'verifyTask', 'boost', 'refInfo', 'useRef', 'buy', 'redeem', 'refill', 'report', 'pmOrder', 'pmTicket'];      // other actions skip this read (faster)
    const [us, ps] = NEED.includes(b.action) ? await Promise.all([ur.get(), b.action === 'me' ? db.ref('userProfiles/' + u.uid).get() : null]) : [null, null];
    let me = us ? us.val() : {};
    if (us && !me) {
      me = { points: 0, guest: u.guest, created: Date.now(), email: u.email || null, name: u.name || null, pic: u.pic || null };
      await ur.set(me);
    }
    if (b.action === 'me') return R(200, { user: me, profiles: ps.val() || {} });
    const g = (await require('./game')(b, u, me, ur, R)) || (await require('./pay')(b, u, me, ur, R)) || (await require('./refer')(b, u, me, ur, R)) || (await require('./store')(b, u, me, ur, R)) || (await require('./premium')(b, u, me, ur, R));
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
      let v = { state: 'ok' };
      if (!have[k]) {                                                 // check the account really exists
        v = await require('./verify').profile(p, h);
        if (v.state === 'missing') return R(400, { error: `No ${p === 'youtube' ? 'YouTube channel' : 'Instagram account'} found with this name` });
        if (v.state !== 'ok') return R(400, { error: 'Could not verify this account right now. Check the name and try again in a moment.' + (v.why ? ' [' + v.why + ']' : '') });
      }
      const t = await db.ref(`profiles/${p}/${k}`).transaction(c => c || { uid: u.uid, at: Date.now() });
      if (t.snapshot.val().uid !== u.uid) return R(409, { error: 'This profile is linked to another account. Remove it there first.' });
      if (!have[k]) await mine.child(k).set({ handle: h, at: Date.now(), pic: v.pic || null, ok: v.state === 'ok' });
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
    if (err.message === 'auth') return R(401, { error: 'Please sign in again' });
    console.error(err);
    return R(500, { error: 'Server error: ' + String(err.message).slice(0, 140) });
  }
};
