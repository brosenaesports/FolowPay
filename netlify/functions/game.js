const { db } = require('./lib');
const MIN = { subscribe: 15, follow: 15, like: 8 };            // seconds before Verify is believable
const REWARD = { subscribe: 2, follow: 2, like: 1 };
const COST = { subscribe: { normal: 3, premium: 4, ultra: 5 }, follow: { normal: 3, premium: 4, ultra: 5 }, like: { normal: 2, premium: 2, ultra: 2 } };
const W = { ultra: 3, premium: 2, normal: 1 };
const TYPES = { youtube: ['subscribe', 'like'], instagram: ['follow', 'like'] };
const HOST = { youtube: /(^|\.)(youtube\.com|youtu\.be)$/, instagram: /(^|\.)instagram\.com$/ };
const key = h => h.toLowerCase().replace(/^@/, '').replace(/\./g, ',');

module.exports = async (b, u, me, ur, R) => {
  const a = b.action, p = b.platform;
  if (!['tasks', 'startTask', 'verifyTask', 'boost', 'orders'].includes(a)) return null;
  const all = async () => Object.values((await db.ref('orders').limitToLast(200).get()).val() || {});
  const ids = async () => (await db.ref('orders').limitToLast(200).get()).val() || {};

  if (a === 'orders') {
    const o = await ids();
    return R(200, { orders: Object.values(o).filter(x => x.uid === u.uid && x.platform === p).reverse() });
  }
  if (a === 'tasks') {
    if (!TYPES[p]) return R(400, { error: 'Unknown platform' });
    const [ms, o] = await Promise.all([db.ref(`userProfiles/${u.uid}/${p}`).get(), ids()]);
    if (!ms.exists()) return R(400, { error: 'Link a profile first' });
    const c = Object.entries(o).filter(([, x]) => x.platform === p && x.uid !== u.uid && (x.done || 0) < x.qty)
      .sort((x, y) => W[y[1].tier] - W[x[1].tier] || x[1].created - y[1].created).slice(0, 30);
    const free = await Promise.all(c.map(async ([id]) => !(await db.ref(`done/${id}/${u.uid}`).get()).exists()));
    return R(200, { tasks: c.filter((_, i) => free[i]).map(([id, x]) => ({
      id, type: x.type, tier: x.tier, handle: x.handle, reward: REWARD[x.type],
      link: x.type === 'follow' ? `https://www.instagram.com/${encodeURIComponent(x.handle.replace(/^@/, ''))}/` : x.link })) });
  }
  if (a === 'startTask') {
    await db.ref('sessions/' + u.uid).set({ o: b.orderId, at: Date.now() });
    return R(200, { ok: true });
  }
  if (a === 'verifyTask') {
    if ((me.blockedUntil || 0) > Date.now()) return R(403, { error: `Earning is paused. Try again in ${Math.ceil((me.blockedUntil - Date.now()) / 6e4)} minutes.` });
    const s = (await db.ref('sessions/' + u.uid).get()).val();
    const o = (await db.ref('orders/' + b.orderId).get()).val();
    if (!s || !o || s.o !== b.orderId) return R(400, { error: 'Open the task first' });
    if (o.uid === u.uid) return R(400, { error: 'You cannot complete your own order' });
    if (Date.now() - s.at < MIN[o.type] * 1000) {                // too fast: likely a skip
      const st = (me.strikes || 0) + 1;
      await ur.update(st >= 5 ? { strikes: 0, blockedUntil: Date.now() + 36e5 } : { strikes: st });
      return R(400, { error: 'Unable to verify' });
    }
    const dr = db.ref(`done/${b.orderId}/${u.uid}`);
    if (!(await dr.transaction(x => x ? undefined : Date.now())).committed) return R(400, { error: 'Already completed' });
    const t = await db.ref(`orders/${b.orderId}/done`).transaction(d => (d || 0) < o.qty ? (d || 0) + 1 : undefined);
    if (!t.committed) { await dr.remove(); return R(400, { error: 'This task is full' }); }
    await ur.child('points').transaction(x => (x || 0) + REWARD[o.type]);
    await ur.update({ strikes: 0 });
    await db.ref('sessions/' + u.uid).remove();
    return R(200, { reward: REWARD[o.type] });
  }
  // boost
  const type = b.type, qty = Math.floor(+b.qty), h = String(b.handle || '');
  const tier = type === 'like' ? 'normal' : b.tier;
  if (!TYPES[p] || !TYPES[p].includes(type) || !W[tier] || !(qty >= 1 && qty <= 1000)) return R(400, { error: 'Check the order details' });
  const k = key(h);
  if (!(await db.ref(`userProfiles/${u.uid}/${p}/${k}`).get()).exists()) return R(400, { error: 'Choose one of your linked profiles' });
  let link = null;
  if (type !== 'follow') {
    try { const L = new URL(String(b.link || '').trim()); if (L.protocol !== 'https:' || !HOST[p].test(L.hostname)) throw 0; link = L.href; }
    catch { return R(400, { error: `Enter a valid ${p} link` }); }
  }
  const cost = qty * COST[type][tier];
  const pay = await ur.child('points').transaction(x => x === null ? 0 : (x >= cost ? x - cost : undefined));
  if (!pay.committed) return R(400, { error: `You need ${cost} points for this order` });
  await db.ref('orders').push({ uid: u.uid, platform: p, handle: h, type, tier, qty, done: 0, link, cost, created: Date.now() });
  return R(200, { ok: true, cost });
};
