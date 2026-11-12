// Admin "Cleanup" tools (called from admin.js after the admin is verified).
// Deletes OLD data in small batches. Running totals (revenue, sales, rewards given) are kept in separate counters, so they are NOT affected.
const { db } = require('./lib');

const DAY = 864e5;
const num = (v, d, min, max) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const opts = b => ({ days: num(b.days, 25, 1, 3650), guestDays: num(b.guestDays, 20, 1, 3650), force: !!b.force, keepBalance: b.keepBalance !== false });
const old = (ts, days) => (ts || 0) < Date.now() - days * DAY;
const val = async p => (await db.ref(p).get()).val() || {};
const entries = o => Object.entries(o || {});

// ---- what counts as "finished" ----
const boostDone = x => x.smm ? x.smm.status === 'completed' : (x.done || 0) >= x.qty;
const pmFinal = s => /^(completed|partial|canceled|cancelled|refunded|fail)/i.test(String(s || ''));
const pmRefillOpen = o => Object.values(o.refills || {}).some(f => !/^(completed|rejected|canceled|cancelled|error|failed)/i.test(String(f.status || '')));

// ---- scanners: each returns [{ paths:[...] }] where every path is removed together ----
const SCAN = {
  async tickets(o) {                                   // Premium booster tickets
    return Object.values(await val('pmTickets'))
      .filter(t => (o.force || t.status === 'solved') && old(Math.max(t.at || 0, t.updated || 0), o.days))
      .map(t => ({ paths: [`pmTickets/${t.id}`, `pmUserTickets/${t.uid}/${t.id}`] }));
  },
  async reports(o) {                                   // Boost order reports
    return Object.values(await val('reports'))
      .filter(r => (o.force || r.status === 'solved') && old(Math.max(r.at || 0, r.updated || 0), o.days))
      .map(r => ({ paths: [`reports/${r.id}`, `userReports/${r.uid}/${r.oid}/${r.id}`] }));
  },
  async orders(o) {                                    // Boost (points) orders, all types
    return entries(await val('orders'))
      .filter(([, x]) => (o.force || (boostDone(x) && !(x.refill && x.refill.status === 'review'))) && old(x.completedAt || x.created, o.days))
      .map(([id]) => ({ paths: [`orders/${id}`, `done/${id}`, `refills/${id}`] }));
  },
  async pmorders(o) {                                  // Premium booster (rupee) orders
    const out = [];
    for (const [uid, l] of entries(await val('pmOrders'))) for (const [id, x] of entries(l))
      if ((o.force || (pmFinal(x.status) && !pmRefillOpen(x))) && old(x.created, o.days)) out.push({ paths: [`pmOrders/${uid}/${id}`, `pmAll/${id}`, `pmLock/r${id}`] });
    return out;
  },
  async pay(o) { return perUser('userPay', 'created', o); },        // points purchases
  async pmpay(o) { return perUser('pmPay', 'created', o); },        // wallet top-ups
  async ledger(o) { return perUser('pmLedger', 'at', o); },         // wallet history
  async rewards(o) {                                   // reward redemptions (gift codes / UPI withdrawals)
    const out = [];
    for (const [uid, l] of entries(await val('redeems'))) for (const [id, x] of entries(l)) {
      const fin = x.type !== 'upi' || x.status === 'paid' || x.status === 'cancelled';
      if ((o.force || fin) && old(x.at, o.days)) out.push({ paths: [`redeems/${uid}/${id}`, `upiReq/${id}`] });
    }
    return out;
  }
};
async function perUser(node, field, o) {
  const out = [];
  for (const [uid, l] of entries(await val(node))) for (const [id, x] of entries(l)) if (old(x[field], o.days)) out.push({ paths: [`${node}/${uid}/${id}`] });
  return out;
}

// ---- guests: inactive for N days, with everything they own ----
async function scanGuests(o) {
  const [users, since] = await Promise.all([val('users'), db.ref('config/seenSince').get().then(x => x.val() || Date.now())]);
  const cand = entries(users).filter(([uid, u]) => u.guest === true && uid.startsWith('g_') && old(u.seen || Math.max(u.created || 0, since), o.guestDays));
  const res = { items: [], withBalance: 0, withOpen: 0, sample: [] };
  if (!cand.length) return res;
  const [wallets, orders, pmOrders, redeems, profiles] = await Promise.all(['pmWallets', 'orders', 'pmOrders', 'redeems', 'profiles'].map(val));
  const mine = {};                                                         // uid -> boost orders
  for (const [id, x] of entries(orders)) (mine[x.uid] = mine[x.uid] || []).push([id, x]);
  for (const [uid, u] of cand) {
    const bal = ((wallets[uid] || {}).bal || 0) + (u.points || 0);
    const bo = mine[uid] || [], po = entries(pmOrders[uid]), rd = entries(redeems[uid]);
    const open = bo.some(([, x]) => !boostDone(x)) || po.some(([, x]) => !pmFinal(x.status)) || rd.some(([, x]) => x.type === 'upi' && x.status === 'pending');
    if (o.keepBalance && bal > 0) { res.withBalance++; continue; }
    if (!o.force && open) { res.withOpen++; continue; }
    const paths = [`users/${uid}`, `userProfiles/${uid}`, `sessions/${uid}`, `userPay/${uid}`, `pmWallets/${uid}`, `pmLedger/${uid}`, `pmPay/${uid}`, `pmLock/${uid}`, `pmOrders/${uid}`, `pmUserTickets/${uid}`, `userReports/${uid}`, `redeems/${uid}`, `referrals/${uid}`];
    for (const [id] of po) paths.push(`pmAll/${id}`);
    for (const [id] of rd) paths.push(`upiReq/${id}`);
    for (const [id] of bo) paths.push(`orders/${id}`, `done/${id}`, `refills/${id}`);
    for (const [p, l] of entries(profiles)) for (const [k, c] of entries(l)) if (c && c.uid === uid) paths.push(`profiles/${p}/${k}`);   // free the linked profile names
    res.items.push({ paths, uid });
    if (res.sample.length < 5) res.sample.push({ id: uid.slice(0, 10) + '…', created: u.created || 0, seen: u.seen || 0, points: u.points || 0 });
  }
  return res;
}
// tickets / reports / orders of guests are removed through their owner's paths above; leftovers are matched by uid here
async function guestExtras(uids) {
  const paths = [];
  const [pt, rp] = await Promise.all([val('pmTickets'), val('reports')]);
  for (const t of Object.values(pt)) if (uids.has(t.uid)) paths.push(`pmTickets/${t.id}`);
  for (const r of Object.values(rp)) if (uids.has(r.uid)) paths.push(`reports/${r.id}`);
  return paths;
}

const KINDS = ['tickets', 'reports', 'orders', 'pmorders', 'pay', 'pmpay', 'ledger', 'rewards', 'guests'];
async function remove(paths) { const up = {}; for (const p of paths) up[p] = null; if (paths.length) await db.ref().update(up); }

module.exports = async (b, R) => {
  const a = b.action, o = opts(b);
  if (a === 'admCleanPreview') {
    const out = {};
    await Promise.all(KINDS.filter(k => k !== 'guests').map(async k => { out[k] = (await SCAN[k](o)).length; }));
    const g = await scanGuests(o);
    out.guests = { count: g.items.length, withBalance: g.withBalance, withOpen: g.withOpen, sample: g.sample };
    return R(200, { counts: out, opts: o });
  }
  if (a === 'admCleanRun') {
    const kind = String(b.kind || '');
    if (!KINDS.includes(kind)) return R(400, { error: 'Unknown cleanup type' });
    if (kind === 'guests') {
      const g = await scanGuests(o), batch = g.items.slice(0, 20);                  // guests carry many records, so fewer per request
      const uids = new Set(batch.map(x => x.uid)), paths = batch.flatMap(x => x.paths);
      if (uids.size) paths.push(...await guestExtras(uids));
      await remove(paths);
      return R(200, { deleted: batch.length, more: g.items.length > batch.length });
    }
    const items = await SCAN[kind](o), batch = items.slice(0, 300);
    await remove(batch.flatMap(x => x.paths));
    return R(200, { deleted: batch.length, more: items.length > batch.length });
  }
  return R(400, { error: 'Unknown admin action' });
};
