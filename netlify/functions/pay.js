
const { db } = require('./lib');
const BASE = 'https://gateway.anujbots.in/';
const PACKS = [[1, 10], [20, 70], [30, 130], [50, 300], [100, 1000]];   // [rupees, points]
const call = async path => (await fetch(BASE + path)).json();

module.exports = async (b, u, me, ur, R) => {
  const a = b.action;
  if (!['buy', 'check', 'txs', 'cancel'].includes(a)) return null;
  const KEY = process.env.GRAM_API_KEY;
  if (!KEY) return R(500, { error: 'Payments are not set up yet (GRAM_API_KEY missing)' });
  const ref = db.ref('userPay/' + u.uid);
  if (a === 'txs') {
    const q = (await ref.limitToLast(20).get()).val() || {};
    return R(200, { txs: Object.values(q).sort((x, y) => y.created - x.created) });
  }
  if (a === 'buy') {
    if (me.guest) return R(403, { error: 'Upgrade to a Google account to buy points' });
    const pk = PACKS[b.pack];
    if (!pk) return R(400, { error: 'Choose a pack' });
    const now = Date.now(), q = (await ref.limitToLast(20).get()).val() || {};
    if (Object.values(q).filter(x => x.status === 'PENDING' && x.exp > now).length >= 3)
      return R(429, { error: 'You already have pending orders. Pay one or wait 5 minutes.' });
    const j = await call(`autoqr.php?api_key=${encodeURIComponent(KEY)}&amount=${pk[0]}`);
    if (j.status !== 'success') return R(502, { error: 'Payment gateway: ' + (j.message || 'try again') });
    const d = j.data;
    const rec = { id: d.order_id, rs: pk[0], pts: pk[1], amount: d.amount, status: 'PENDING', created: now,
      exp: now + (d.valid_seconds || 300) * 1000, qr: d.qr_url, url: d.payment_url, intent: d.intent || null };
    await ref.child(d.order_id).set(rec);
    return R(200, rec);
  }
  const id = String(b.orderId || '').replace(/[^A-Za-z0-9]/g, '');
  const rec = id && (await ref.child(id).get()).val();
  if (!rec) return R(404, { error: 'Order not found' });
  if (rec.status !== 'PENDING') return R(200, { status: rec.status });
  const j = await call(`autoverify.php?api_key=${encodeURIComponent(KEY)}&order_id=${id}`);
  const st = j.data && j.data.status;
  if (st === 'PAID') {
    const c = await ref.child(id + '/credited').transaction(x => x ? undefined : true);   // credit once only
    if (!c.committed) return R(200, { status: 'PAID' });
    await ref.child(id).update({ status: 'PAID', paid: Date.now() });
    await db.ref('revenue/' + new Date(Date.now() + 19800000).toISOString().slice(0, 10)).transaction(x => (x || 0) + rec.rs);   // revenue per day (IST)
    const t = await ur.child('points').transaction(x => (x || 0) + rec.pts);
    return R(200, { status: 'PAID', points: t.snapshot.val(), pts: rec.pts });
  }
  if (a === 'cancel') {                                              // paid in the meantime was credited above
    await ref.child(id).update({ status: st === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED' });
    return R(200, { status: 'CANCELLED' });
  }
  if (st === 'EXPIRED') await ref.child(id).update({ status: 'EXPIRED' });
  return R(200, { status: st || 'PENDING' });
};
