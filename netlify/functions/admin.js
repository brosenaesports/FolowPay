const { db, crypto, sign, auth } = require('./lib');
const emails = async () => {                                         // admin Gmail addresses: Firebase (config/adminEmails) + optional Netlify variable
  const fromDb = Object.values((await db.ref('config/adminEmails').get()).val() || {});
  return [...String(process.env.ADMIN_EMAILS || '').split(/[,\s;]+/), ...fromDb].map(x => String(x).trim().toLowerCase()).filter(Boolean);
};
const mk = () => { const e = Date.now() + 12 * 36e5; return `a.${e}.${sign('adm.' + e)}`; };
const valid = t => { try { const [, e, sig] = String(t).split('.'); return +e > Date.now() && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign('adm.' + e))); } catch { return false; } };
const ist = ms => new Date(ms + 19800000).toISOString().slice(0, 10);
const W = { ultra: 3, premium: 2, normal: 1 };
const int = (v, lo, hi) => { const n = Math.floor(+v); return n >= lo && n <= hi ? n : null; };
const safe = s => String(s || '').replace(/[^\w-]/g, '');

module.exports = async (b, R) => {
  const a = b.action;
  if (a === 'admClaim') {                                            // one-time setup: the first Google account becomes admin, then this is closed
    let g; try { g = await auth(b.idToken); } catch { return R(403, { error: 'Google sign-in could not be verified' }); }
    if (!g.email) return R(403, { error: 'This Google account has no email address' });
    if ((await emails()).length) return R(403, { error: 'An admin already exists. Open admin.html and sign in; add more admins under the Admins tab.' });
    const t = await db.ref('config/adminEmails').transaction(c => c === null ? { main: String(g.email).toLowerCase() } : undefined);
    if (!t.committed) return R(403, { error: 'An admin already exists. Open admin.html and sign in.' });
    return R(200, { ok: true, email: String(g.email).toLowerCase() });
  }
  if (a === 'admGoogle') {                                           // the only way in: a Google account on the admin list
    let g; try { g = await auth(b.idToken); } catch { return R(403, { error: 'Google sign-in could not be verified' }); }
    const list = await emails();
    if (!list.length) return R(403, { error: 'No admin email is set yet. In Firebase Realtime Database add config / adminEmails / main with your Gmail address as the value.' });
    if (!g.email || !list.includes(String(g.email).toLowerCase())) return R(403, { error: (g.email || 'This account') + ' is not an admin account' });
    return R(200, { atoken: mk() });
  }
  if (!valid(b.atoken)) return R(403, { error: 'Admin session ended. Log in again.' });

  if (a === 'admAdmins') {
    const v = (await db.ref('config/adminEmails').get()).val() || {};
    return R(200, { admins: Object.entries(v).map(([key, email]) => ({ key, email })), fixed: String(process.env.ADMIN_EMAILS || '').split(/[,\s;]+/).map(x => x.trim()).filter(Boolean) });
  }
  if (a === 'admAddAdmin') {
    const e = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return R(400, { error: 'Enter a valid email address' });
    if ((await emails()).includes(e)) return R(400, { error: 'This email is already an admin' });
    await db.ref('config/adminEmails').push(e);
    return R(200, { ok: true });
  }
  if (a === 'admDelAdmin') {
    if ((await emails()).length <= 1) return R(400, { error: 'You cannot remove the last admin' });
    await db.ref('config/adminEmails/' + safe(b.key)).remove();
    return R(200, { ok: true });
  }
  if (a === 'admTasks') {                                            // the page filters/sorts these (priority, amount, type)
    const o = (await db.ref('orders').limitToLast(200).get()).val() || {};
    return R(200, { tasks: Object.entries(o).map(([id, x]) => ({ id, ...x })) });
  }
  if (a === 'admToSmm') {                                            // move an order to the SMM tab; normal users stop seeing it as a task
    const r = db.ref('orders/' + safe(b.id)), o = (await r.get()).val(), no = String(b.no || '').trim().slice(0, 40);
    if (!o) return R(404, { error: 'Order not found' });
    if (!no) return R(400, { error: 'Enter the SMM order number' });
    if (o.smm) return R(400, { error: 'This order is already in the SMM tab' });
    if ((o.done || 0) >= o.qty) return R(400, { error: 'This order is already completed' });
    await r.child('smm').set({ no, status: 'pending', at: Date.now() });
    return R(200, { ok: true });
  }
  if (a === 'admSmm') {                                              // not-completed SMM orders; searching by id / SMM number shows all
    const o = (await db.ref('orders').limitToLast(400).get()).val() || {}, q = String(b.q || '').trim().toLowerCase();
    let l = Object.entries(o).filter(([, x]) => x.smm).map(([id, x]) => ({ id, ...x }));
    l = q ? l.filter(x => x.id.toLowerCase().includes(q) || String(x.smm.no || '').toLowerCase().includes(q)) : l.filter(x => x.smm.status !== 'completed');
    if (b.type) l = l.filter(x => x.type === b.type);
    return R(200, { orders: l.sort((x, y) => (y.cost || 0) - (x.cost || 0)).slice(0, 100) });
  }
  if (a === 'admSmmEdit') {
    const r = db.ref('orders/' + safe(b.id)), o = (await r.get()).val();
    if (!o || !o.smm) return R(404, { error: 'This order is not in the SMM tab' });
    if (!['pending', 'in_progress', 'completed'].includes(b.status)) return R(400, { error: 'Choose a status' });
    const up = { 'smm/status': b.status, 'smm/no': String(b.no || '').trim().slice(0, 40) };
    if (b.status === 'completed') { up.done = o.qty; if (!o.completedAt) up.completedAt = Date.now(); }   // completed = 100% delivered
    await r.update(up);
    return R(200, { ok: true });
  }
  if (a === 'admRefills') {
    const v = (await db.ref('refills').limitToLast(100).get()).val() || {};
    return R(200, { refills: Object.values(v).sort((x, y) => (x.status === 'review' ? 0 : 1) - (y.status === 'review' ? 0 : 1) || y.at - x.at) });
  }
  if (a === 'admRefillSet') {
    const id = safe(b.id), r = (await db.ref('refills/' + id).get()).val();
    if (!r) return R(404, { error: 'Refill request not found' });
    if (!['done', 'rejected'].includes(b.status)) return R(400, { error: 'Choose done or rejected' });
    await Promise.all([db.ref('refills/' + id).update({ status: b.status, note: String(b.note || '').slice(0, 200), resolvedAt: Date.now() }), db.ref(`orders/${id}/refill/status`).set(b.status)]);
    return R(200, { ok: true });
  }
  if (a === 'admSetDone') {
    const r = db.ref('orders/' + safe(b.id)), o = (await r.get()).val();
    if (!o) return R(404, { error: 'Order not found' });
    const n = int(b.done, 0, o.qty);
    if (n === null) return R(400, { error: `Enter a number from 0 to ${o.qty}` });
    await r.child('done').set(n);
    if (n >= o.qty && !o.completedAt) await r.child('completedAt').set(Date.now());   // 100% delivered -> completed
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
