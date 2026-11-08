const { db } = require('./lib');
const V = require('./verify');
const Ref = require('./refer');
const MIN = { subscribe: 15, follow: 15, like: 8 };                 // seconds before Verify is believable
const REWARD = { subscribe: 2, follow: 2, like: 1 };
const PM = 3, PC = 4;                                               // watch time: earner / booster points per minute
const COST = { subscribe: { normal: 3, premium: 4, ultra: 5 }, follow: { normal: 3, premium: 4, ultra: 5 }, like: { normal: 2, premium: 3, ultra: 4 }, watch: { normal: PC } };
const W = { ultra: 3, premium: 2, normal: 1 };
const TYPES = { youtube: ['subscribe', 'like', 'watch'], instagram: ['follow', 'like'] };
const key = h => h.toLowerCase().replace(/^@/, '').replace(/\./g, ',');
const rew = o => o.type === 'watch' ? PM * o.mins : REWARD[o.type];

let oc = { t: 0, v: null };
module.exports = async (b, u, me, ur, R) => {
  const a = b.action, p = b.platform;
  if (!['tasks', 'startTask', 'verifyTask', 'boost', 'orders'].includes(a)) return null;
  const ids = async fresh => {                                      // warm servers reuse the order list for 3 seconds
    if (!fresh && oc.v && Date.now() - oc.t < 3000) return oc.v;
    const v = (await db.ref('orders').limitToLast(200).get()).val() || {};
    oc = { t: Date.now(), v }; return v;
  };

  if (a === 'orders') {
    const o = await ids(true);
    return R(200, { orders: Object.values(o).filter(x => x.uid === u.uid && x.platform === p).reverse() });
  }
  if (a === 'tasks') {
    if (!TYPES[p]) return R(400, { error: 'Unknown platform' });
    const [ms, o] = await Promise.all([db.ref(`userProfiles/${u.uid}/${p}`).get(), ids()]);
    if (!ms.exists()) return R(400, { error: 'Link a profile first on the Profiles page' });
    const skip = Array.isArray(b.skip) ? b.skip : [];
    const c = Object.entries(o).filter(([id, x]) => x.platform === p && (!b.type || x.type === b.type) && x.uid !== u.uid && (x.done || 0) < x.qty && !skip.includes(id))
      .sort((x, y) => W[y[1].tier] - W[x[1].tier] || x[1].created - y[1].created).slice(0, 8);
    const free = await Promise.all(c.map(async ([id]) => !(await db.ref(`done/${id}/${u.uid}`).get()).exists()));
    const list = c.filter((_, i) => free[i]), t = list[0];
    return R(200, { left: list.length, task: t && { id: t[0], type: t[1].type, tier: t[1].tier, handle: t[1].handle, reward: rew(t[1]), mins: t[1].mins || null,
      link: t[1].type === 'follow' ? `https://www.instagram.com/${encodeURIComponent(t[1].handle.replace(/^@/, ''))}/` : t[1].link } });
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
    const need = o.type === 'watch' ? o.mins * 60 - 2 : MIN[o.type];   // watch time must really be spent
    if (Date.now() - s.at < need * 1000) {
      const st = (me.strikes || 0) + 1;
      await ur.update(st >= 5 ? { strikes: 0, blockedUntil: Date.now() + 36e5 } : { strikes: st });
      return R(400, { error: o.type === 'watch' ? 'Keep watching until the timer ends' : 'Unable to verify' });
    }
    const dr = db.ref(`done/${b.orderId}/${u.uid}`);
    if (!(await dr.transaction(x => x ? undefined : Date.now())).committed) return R(400, { error: 'Already completed' });
    const t = await db.ref(`orders/${b.orderId}/done`).transaction(d => (d || 0) < o.qty ? (d || 0) + 1 : undefined);
    if (!t.committed) { await dr.remove(); return R(400, { error: 'This task is full' }); }
    await ur.child('points').transaction(x => (x || 0) + rew(o));
    await ur.update({ strikes: 0 });
    await db.ref('sessions/' + u.uid).remove();
    return R(200, { reward: rew(o) });
  }
  // ---- boost ----
  const type = b.type, h = String(b.handle || '');
  if (!TYPES[p] || !TYPES[p].includes(type)) return R(400, { error: 'Check the order details' });
  const tier = type === 'watch' ? 'normal' : b.tier;
  if (!W[tier]) return R(400, { error: 'Choose a priority' });
  if (!(await db.ref(`userProfiles/${u.uid}/${p}/${key(h)}`).get()).exists()) return R(400, { error: 'Choose one of your linked profiles' });
  let link = null, qty, mins = null, cost;
  if (type !== 'follow') {                                           // followers need no link
    const v = p === 'youtube' ? await V.ytVideo(b.link, h, type === 'watch') : await V.igPost(b.link, h);
    if (v.error) return R(400, { error: v.error });
    link = p === 'youtube' ? 'https://www.youtube.com/watch?v=' + v.id : String(b.link).trim();
    if (type === 'watch') {
      const total = Math.floor(+b.total), len = v.secs ? v.secs / 60 : +b.len;
      if (!(total >= 1 && total <= 3000) || !(len >= 1)) return R(400, { error: 'Enter the total watch minutes and the video length' });
      mins = Math.min(15, Math.floor(len)); qty = Math.ceil(total / mins);   // each task is at most 15 minutes
      if (qty > 200) return R(400, { error: 'Too many parts. Lower the watch time.' });
      cost = qty * mins * PC;
    }
  }
  if (type !== 'watch') {
    qty = Math.floor(+b.qty);
    if (!(qty >= 1 && qty <= 1000)) return R(400, { error: 'Enter a quantity from 1 to 1000' });
    cost = qty * COST[type][tier];
  }
  const pay = await ur.child('points').transaction(x => x === null ? 0 : (x >= cost ? x - cost : undefined));
  if (!pay.committed) return R(400, { error: `You need ${cost} points for this order` });
  await db.ref('orders').push({ uid: u.uid, platform: p, handle: h, type, tier, qty, done: 0, link, mins, cost, created: Date.now() });
  const sp = (await ur.child('spent').transaction(x => (x || 0) + cost)).snapshot.val();
  await Ref.payout(u.uid, ur, me, sp);
  return R(200, { ok: true, cost, qty, mins });
};
