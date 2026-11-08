const { db, crypto, sign } = require('./lib');
const DEFAULT_PW = 'QL9ghPBe4UTe';                                       // used until you set ADMIN_PASSWORD or change it in Settings
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const mk = () => { const e = Date.now() + 12 * 36e5; return `a.${e}.${sign('adm.' + e)}`; };
const valid = t => { try { const [, e, sig] = String(t).split('.'); return +e > Date.now() && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign('adm.' + e))); } catch { return false; } };
const ist = ms => new Date(ms + 19800000).toISOString().slice(0, 10);
const W = { ultra: 3, premium: 2, normal: 1 };
const int = (v, lo, hi) => { const n = Math.floor(+v); return n >= lo && n <= hi ? n : null; };
const safe = s => String(s || '').replace(/[^\w-]/g, '');

module.exports = async (b, R) => {
  const a = b.action;
  if (a === 'admLogin') {
    const lk = (await db.ref('config/adminLock').get()).val() || {};
    if ((lk.until || 0) > Date.now()) return R(429, { error: 'Too many wrong attempts. Try again in 10 minutes.' });
    const h = (await db.ref('config/adminHash').get()).val(), pw = String(b.password || '').trim();   // ignore stray spaces from pasting
    let good = false;
    if (h) { const [salt, hx] = h.split(':'); good = crypto.timingSafeEqual(Buffer.from(hashPw(pw, salt)), Buffer.from(hx)); }
    else { const d = process.env.ADMIN_PASSWORD || DEFAULT_PW; good = pw.length === d.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(d)); }
    if (!good) {
      const n = (lk.n || 0) + 1;
      await db.ref('config/adminLock').set(n >= 5 ? { n: 0, until: Date.now() + 10 * 6e4 } : { n, until: 0 });
      return R(403, { error: 'Wrong password' });
    }
    await db.ref('config/adminLock').set({ n: 0, until: 0 });
    return R(200, { atoken: mk(), isDefault: !h });
  }
  if (!valid(b.atoken)) return R(403, { error: 'Admin session ended. Log in again.' });

  if (a === 'admSetPw') {
    const pw = String(b.password || '').trim();
    if (pw.length < 8) return R(400, { error: 'Use at least 8 characters' });
    const salt = crypto.randomBytes(8).toString('hex');
    await db.ref('config/adminHash').set(salt + ':' + hashPw(pw, salt));
    return R(200, { ok: true });
  }
  if (a === 'admTasks') {                                            // highest priority first, then biggest remaining amount
    const o = (await db.ref('orders').limitToLast(300).get()).val() || {};
    const tasks = Object.entries(o).map(([id, x]) => ({ id, ...x }))
      .sort((x, y) => W[y.tier] - W[x.tier] || (y.qty - (y.done || 0)) - (x.qty - (x.done || 0)));
    return R(200, { tasks });
  }
  if (a === 'admSetDone') {
    const r = db.ref('orders/' + safe(b.id)), o = (await r.get()).val();
    if (!o) return R(404, { error: 'Order not found' });
    const n = int(b.done, 0, o.qty);
    if (n === null) return R(400, { error: `Enter a number from 0 to ${o.qty}` });
    await r.child('done').set(n);
    return R(200, { ok: true });
  }
  if (a === 'admItems') {
    const [it, up] = await Promise.all([db.ref('store').get(), db.ref('upiReq').limitToLast(50).get()]);
    return R(200, { items: Object.entries(it.val() || {}).map(([id, x]) => ({ id, ...x })), upi: Object.values(up.val() || {}).sort((x, y) => y.at - x.at) });
  }
  if (a === 'admAddItem') {
    const rs = int(b.rs, 1, 100000), pts = int(b.pts, 1, 10000000), stock = b.type === 'upi' ? int(b.stock, 0, 100000) : 0;
    if (!['amazon', 'gplay', 'upi'].includes(b.type) || rs === null || pts === null || stock === null) return R(400, { error: 'Check the reward details' });
    await db.ref('store').push({ type: b.type, rs, pts, stock, created: Date.now() });
    return R(200, { ok: true });
  }
  if (a === 'admAddCodes') {
    const id = safe(b.id), it = (await db.ref('store/' + id).get()).val();
    if (!it || it.type === 'upi') return R(400, { error: 'Choose a gift card reward' });
    const codes = String(b.codes || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 200);
    if (!codes.length) return R(400, { error: 'Enter at least one code' });
    const up = {}; for (const c of codes) up[db.ref().push().key] = { code: c.slice(0, 200), at: Date.now() };
    await db.ref('codes/' + id).update(up);
    await db.ref(`store/${id}/stock`).transaction(x => (x || 0) + codes.length);
    return R(200, { added: codes.length });
  }
  if (a === 'admSetItem') {
    const id = safe(b.id), it = (await db.ref('store/' + id).get()).val();
    if (!it) return R(404, { error: 'Reward not found' });
    const rs = int(b.rs, 1, 100000), pts = int(b.pts, 1, 10000000);
    if (rs === null || pts === null) return R(400, { error: 'Check the amount and points' });
    const up = { rs, pts };
    if (it.type === 'upi') { const s = int(b.stock, 0, 100000); if (s === null) return R(400, { error: 'Check the stock' }); up.stock = s; }
    await db.ref('store/' + id).update(up);
    return R(200, { ok: true });
  }
  if (a === 'admDelItem') {
    const id = safe(b.id);
    await Promise.all([db.ref('store/' + id).remove(), db.ref('codes/' + id).remove()]);
    return R(200, { ok: true });
  }
  if (a === 'admUpiPaid') {
    const rid = safe(b.id), q = (await db.ref('upiReq/' + rid).get()).val();
    if (!q) return R(404, { error: 'Request not found' });
    await Promise.all([db.ref('upiReq/' + rid).update({ status: 'paid', paidAt: Date.now() }), db.ref(`redeems/${q.uid}/${rid}`).update({ status: 'paid' })]);
    return R(200, { ok: true });
  }
  if (a === 'admUsers') {
    const q = String(b.q || '').trim().toLowerCase(), v = (await db.ref('users').limitToLast(1000).get()).val() || {};
    const users = Object.entries(v).map(([uid, x]) => ({ uid, ...x }))
      .filter(x => !q || String(x.email || '').toLowerCase().includes(q) || String(x.name || '').toLowerCase().includes(q))
      .sort((x, y) => (y.created || 0) - (x.created || 0)).slice(0, 30)
      .map(x => ({ uid: x.uid, email: x.email, name: x.name, guest: x.guest, points: x.points, spent: x.spent, created: x.created }));
    return R(200, { users });
  }
  if (a === 'admRevenue') {
    const d = (await db.ref('revenue').get()).val() || {}, now = ist(Date.now());
    const y = now.slice(0, 4), m = now.slice(0, 7), wk = ist(Date.now() - 6 * 864e5), months = {};
    let week = 0, month = 0, year = 0, total = 0;
    for (const [k, v] of Object.entries(d)) { total += v; if (k.startsWith(y)) year += v; if (k.startsWith(m)) month += v; if (k >= wk) week += v; months[k.slice(0, 7)] = (months[k.slice(0, 7)] || 0) + v; }
    return R(200, { today: d[now] || 0, week, month, year, total, months: Object.entries(months).sort().reverse().slice(0, 12) });
  }
  return R(400, { error: 'Unknown admin action' });
};
