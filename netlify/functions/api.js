const { db, auth, guestToken, crypto } = require('./lib');
const R = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const RE = { youtube: /^@[A-Za-z0-9._-]{3,30}$/, instagram: /^[A-Za-z0-9._]{1,30}$/ };
const key = h => h.toLowerCase().replace(/^@/, '').replace(/\./g, ',');
const DAY = 864e5;

exports.handler = async e => {
  if (e.httpMethod !== 'POST') return R(405, { error: 'POST only' });
  let b; try { b = JSON.parse(e.body || '{}'); } catch { return R(400, { error: 'Bad request' }); }
  try {
    if (b.action === 'guest') {
      const id = crypto.randomBytes(12).toString('hex');
      await db.ref('users/g_' + id).set({ points: 0, guest: true, created: Date.now() });
      return R(200, { token: guestToken(id) });
    }
    const u = await auth(b.token);
    const ur = db.ref('users/' + u.uid);
    let me = (await ur.get()).val();
    if (!me) {
      me = { points: 0, guest: u.guest, created: Date.now(), email: u.email || null, name: u.name || null, pic: u.pic || null };
      await ur.set(me);
    }
    if (b.action === 'me') {
      const profiles = (await db.ref('userProfiles/' + u.uid).get()).val() || {};
      return R(200, { user: me, profiles });
    }
    const g = await require('./game')(b, u, me, ur, R); if (g) return g;
    const p = b.platform, h = String(b.handle || '').trim();
    if (!RE[p] || !RE[p].test(h)) return R(400, { error: p === 'youtube' ? 'Enter a handle like @AKGAMER-s8s' : 'Enter a valid username' });
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
