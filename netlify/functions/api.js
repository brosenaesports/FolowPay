const { db, auth, sess, crypto, bad } = require('./lib');
const R = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async e => {
  if (e.httpMethod !== 'POST') return R(405, { error: 'POST only' });
  if (bad) return R(500, { error: bad });
  let b; try { b = JSON.parse(e.body || '{}'); } catch { return R(400, { error: 'Bad request' }); }
  try {
    if (typeof b.action === 'string' && b.action.startsWith('adm')) return await require('./admin')(b, R);
    if (b.action === 'guest') {
      const uid = 'g_' + crypto.randomBytes(12).toString('hex');
      await db.ref('users/' + uid).set({ points: 0, guest: true, created: Date.now(), seen: Date.now() });
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
    const us = NEED.includes(b.action) ? await ur.get() : null;
    let me = us ? us.val() : {};
    if (us && !me) {
      me = { points: 0, guest: u.guest, created: Date.now(), email: u.email || null, name: u.name || null, pic: u.pic || null };
      await ur.set(me);
    }
    if (us && me && (!me.seen || Date.now() - me.seen > 6 * 36e5)) {          // last-active stamp (at most every 6 hours), used by the admin Cleanup page
      me.seen = Date.now();
      await Promise.all([ur.child('seen').set(me.seen), db.ref('config/seenSince').transaction(x => x || Date.now())]);
    }
    if (b.action === 'me') return R(200, { user: me });
    const g = (await require('./game')(b, u, me, ur, R)) || (await require('./pay')(b, u, me, ur, R)) || (await require('./refer')(b, u, me, ur, R)) || (await require('./store')(b, u, me, ur, R)) || (await require('./premium')(b, u, me, ur, R));
    if (g) return g;
    return R(400, { error: 'Unknown action' });
  } catch (err) {
    if (err.message === 'auth') return R(401, { error: 'Please sign in again' });
    console.error(err);
    return R(500, { error: 'Server error: ' + String(err.message).slice(0, 140) });
  }
};
