// Removes finished NORMAL-priority boost orders 3 days after they were completed.
// Revenue is NOT stored inside orders: money received (revenue / revenuePts), SMM spend (smmSpend), rewards given (rewardSpend)
// and premium sales/cost live in their own per-day counters, so deleting orders never changes the revenue numbers.
// Premium / Ultra premium orders are kept (they carry a 30-day refill) and are cleaned from the admin Cleanup tab.
// Runs once a day (scheduled in netlify.toml) and also, at most every 6 hours, when someone opens their orders.
const { db } = require('./lib');
const KEEP = 3 * 864e5;

async function run() {
  const [os, rp] = await Promise.all([db.ref('orders').get(), db.ref('reports').get()]);
  const orders = os.val() || {}, reports = Object.values(rp.val() || {});
  const unsolved = new Set(reports.filter(r => r.status !== 'solved').map(r => r.oid));      // keep orders that still have an open report
  const now = Date.now(), up = {};
  let n = 0;
  for (const [id, x] of Object.entries(orders)) {
    if ((x.tier || 'normal') !== 'normal') continue;
    const done = x.smm ? x.smm.status === 'completed' : (x.done || 0) >= x.qty;
    if (!done || unsolved.has(id)) continue;
    if (now - (x.completedAt || x.created || now) < KEEP) continue;
    up['orders/' + id] = null; up['done/' + id] = null; up['refills/' + id] = null;
    for (const r of reports) if (r.oid === id) { up['reports/' + r.id] = null; up[`userReports/${r.uid}/${id}/${r.id}`] = null; }
    n++;
  }
  const keys = Object.keys(up);
  for (let i = 0; i < keys.length; i += 400) {
    const part = {}; for (const k of keys.slice(i, i + 400)) part[k] = null;
    await db.ref().update(part);
  }
  return n;
}
async function lazy() {
  const t = await db.ref('config/lastPurge').transaction(x => x && Date.now() - x < 6 * 36e5 ? undefined : Date.now());
  return t.committed ? run() : 0;
}
exports.run = run;
exports.lazy = lazy;
exports.handler = async () => {                                     // scheduled call
  try { const n = await run(); await db.ref('config/lastPurge').set(Date.now()); return { statusCode: 200, body: 'removed ' + n }; }
  catch (e) { console.error(e); return { statusCode: 500, body: 'error' }; }
};
