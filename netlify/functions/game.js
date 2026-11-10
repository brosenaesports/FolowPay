const { db } = require('./lib');
const V = require('./verify');
const Ref = require('./refer');
const MIN = { subscribe: 15, follow: 15, like: 8, views: 10, comment: 20 };           // seconds before Verify is believable
const REWARD = { subscribe: 2, follow: 2, like: 1, views: 1, comment: 1 };
const PM = 6, PC = 8;                                                                  // watch time: earner 6 / booster 8 points per minute
const P3 = { normal: 3, premium: 4, ultra: 5 };
const COST = { subscribe: P3, follow: P3, like: { normal: 2, premium: 3, ultra: 4 }, views: { normal: 1 }, comment: { normal: 1 }, visits: { normal: 1 }, watch: { normal: PC } };
const W = { ultra: 3, premium: 2, normal: 1 };
const TYPES = { youtube: ['subscribe', 'like', 'views', 'comment', 'watch'], instagram: ['follow', 'like', 'views', 'comment', 'visits'] };
const PRIO = ['subscribe', 'follow', 'like'];                                          // only these have priority levels + 30-day refill
const PACKS = [15, 30, 45, 60, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];   // watch time packages (minutes)
const MAXQ = { views: 10000, visits: 100000 };
const REFILL_DAYS = 30;
const key = h => h.toLowerCase().replace(/^@/, '').replace(/\./g, ',');
const rew = o => o.type === 'watch' ? PM * o.mins : REWARD[o.type];
const safe = s => String(s || '').replace(/[^\w-]/g, '');
let oc = { t: 0, v: null };

module.exports = async (b, u, me, ur, R) => {
  const a = b.action, p = b.platform;
  if (!['tasks', 'startTask', 'verifyTask', 'boost', 'orders', 'refill'].includes(a)) return null;
  const ids = async fresh => {                                      // warm servers reuse the order list for 3 seconds
    if (!fresh && oc.v && Date.now() - oc.t < 3000) return oc.v;
    const v = (await db.ref('orders').limitToLast(200).get()).val() || {};
    oc = { t: Date.now(), v }; return v;
  };

  if (a === 'orders') {
    const o = await ids(true), now = Date.now();
    const orders = Object.entries(o).filter(([, x]) => x.uid === u.uid && x.platform === p).map(([id, x]) => {
      const { smm, uid, ...pub } = x, completed = smm ? smm.status === 'completed' : (x.done || 0) >= x.qty;
      const until = (x.completedAt || x.created) + REFILL_DAYS * 864e5;
      return { id, ...pub, status: completed ? 'completed' : 'progress', refillUntil: until,
        canRefill: !x.refill && completed && PRIO.includes(x.type) && x.tier !== 'normal' && now < until };
    }).reverse();
    return R(200, { orders });
  }
  if (a === 'refill') {                                             // one refill per order, Premium / Ultra premium, within 30 days of completion
    const id = safe(b.orderId), r = db.ref('orders/' + id), o = (await r.get()).val();
    if (!o || o.uid !== u.uid) return R(404, { error: 'Order not found' });
    if (o.refill) return R(400, { error: 'A refill was already requested for this order' });
    if (!PRIO.includes(o.type) || o.tier === 'normal') return R(400, { error: 'Refill is included with Premium and Ultra premium orders' });
    if (!(o.smm ? o.smm.status === 'completed' : (o.done || 0) >= o.qty)) return R(400, { error: 'You can request a refill after the order is completed' });
    if (Date.now() > (o.completedAt || o.created) + REFILL_DAYS * 864e5) return R(400, { error: 'The 30-day refill period has ended' });
    const t = await r.child('refill').transaction(x => x ? undefined : { status: 'review', at: Date.now() });
    if (!t.committed) return R(400, { error: 'A refill was already requested for this order' });
    await db.ref('refills/' + id).set({ id, uid: u.uid, email: me.email || null, platform: o.platform, handle: o.handle, type: o.type, tier: o.tier,
      qty: o.qty, done: o.done || 0, created: o.created, completedAt: o.completedAt || null, at: Date.now(), status: 'review', note: '' });
    return R(200, { ok: true });
  }
  if (a === 'tasks') {
    if (!TYPES[p]) return R(400, { error: 'Unknown platform' });
    const [ms, o] = await Promise.all([db.ref(`userProfiles/${u.uid}/${p}`).get(), ids()]);
    if (!ms.exists()) return R(400, { error: 'Link a profile first on the Profiles page' });
    const skip = Array.isArray(b.skip) ? b.skip : [];
    const c = Object.entries(o).filter(([id, x]) => x.platform === p && !x.smm && x.type !== 'visits' && (!b.type || x.type === b.type) && x.uid !== u.uid && (x.done || 0) < x.qty && !skip.includes(id))
      .sort((x, y) => W[y[1].tier] - W[x[1].tier] || x[1].created - y[1].created).slice(0, 8);
    const free = await Promise.all(c.map(async ([id]) => !(await db.ref(`done/${id}/${u.uid}`).get()).exists()));
    const list = c.filter((_, i) => free[i]), t = list[0];
    return R(200, { left: list.length, task: t ? { id: t[0], type: t[1].type, tier: t[1].tier, handle: t[1].handle, reward: rew(t[1]), mins: t[1].mins || null,
      link: t[1].type === 'follow' ? `https://www.instagram.com/${encodeURIComponent(t[1].handle.replace(/^@/, ''))}/` : t[1].link } : null });
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
    if (o.smm || o.type === 'visits') return R(400, { error: 'This task is not available' });
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
    if (t.snapshot.val() >= o.qty) await db.ref(`orders/${b.orderId}/completedAt`).set(Date.now());   // 100% delivered -> completed
    await ur.child('points').transaction(x => (x || 0) + rew(o));
    await ur.update({ strikes: 0 });
    await db.ref('sessions/' + u.uid).remove();
    return R(200, { reward: rew(o) });
  }
  // ---- boost ----
  const type = b.type, h = String(b.handle || '');
  if (!TYPES[p] || !TYPES[p].includes(type)) return R(400, { error: 'Check the order details' });
  const tier = PRIO.includes(type) ? b.tier : 'normal';
  if (!W[tier]) return R(400, { error: 'Choose a priority' });
  if (!(await db.ref(`userProfiles/${u.uid}/${p}/${key(h)}`).get()).exists()) return R(400, { error: 'Choose one of your linked profiles' });
  let link = null, qty, mins = null, cost, smm = null, v = null;
  if (!['follow', 'visits'].includes(type)) {                        // followers and profile visits need no link
    v = p === 'youtube' ? await V.ytVideo(b.link, h, type === 'watch') : await V.igPost(b.link, h);
    if (v.error) return R(400, { error: v.error });
    link = p === 'youtube' ? 'https://www.youtube.com/watch?v=' + v.id : String(b.link).trim();
  }
  if (type === 'watch') {
    const total = Math.floor(+b.total), len = v.secs ? v.secs / 60 : +b.len;
    if (!PACKS.includes(total)) return R(400, { error: 'Choose one of the watch time packages' });
    if (!(len >= 1)) return R(400, { error: 'Enter the video length in minutes' });
    mins = Math.min(15, Math.floor(len)); qty = Math.ceil(total / mins);   // each task is at most 15 minutes
    if (qty > 1000) return R(400, { error: `This video is too short for ${total} minutes. Use a video of at least ${Math.ceil(total / 1000)} minutes.` });
    cost = qty * mins * PC;
  } else {
    qty = Math.floor(+b.qty);
    const lo = type === 'visits' ? 100 : 1, hi = MAXQ[type] || 1000;
    if (!(qty >= lo && qty <= hi)) return R(400, { error: `Enter a quantity from ${lo} to ${hi}` });
    cost = qty * COST[type][tier];
  }
  if (type === 'visits') smm = { status: 'pending', no: null, at: Date.now() };   // profile visits go straight to the SMM tab
  const pay = await ur.child('points').transaction(x => x === null ? 0 : (x >= cost ? x - cost : undefined));
  if (!pay.committed) return R(400, { error: `You need ${cost} points for this order` });
  await db.ref('orders').push({ uid: u.uid, platform: p, handle: h, type, tier, qty, done: 0, link, mins, cost, created: Date.now(), ...(smm ? { smm } : {}) });
  const sp = (await ur.child('spent').transaction(x => (x || 0) + cost)).snapshot.val();
  await Ref.payout(u.uid, ur, me, sp);
  return R(200, { ok: true, cost, qty, mins });
};
