const { db } = require('./lib');
const NAMES = { amazon: 'Amazon Gift Card', gplay: 'Google Play Gift Card', upi: 'UPI Cash' };

module.exports = async (b, u, me, ur, R) => {
  const a = b.action;
  if (!['storeList', 'redeem', 'myRedeems'].includes(a)) return null;
  if (a === 'storeList') {
    const v = (await db.ref('store').get()).val() || {};
    return R(200, { items: Object.entries(v).map(([id, x]) => ({ id, type: x.type, name: NAMES[x.type], rs: x.rs, pts: x.pts, stock: x.stock || 0 }))
      .sort((x, y) => x.rs - y.rs) });
  }
  if (a === 'myRedeems') {
    const v = (await db.ref('redeems/' + u.uid).limitToLast(20).get()).val() || {};
    return R(200, { list: Object.values(v).sort((x, y) => y.at - x.at) });
  }
  if (me.guest) return R(403, { error: 'Upgrade to a Google account to redeem rewards' });
  const id = String(b.id || '').replace(/[^\w-]/g, '');
  const it = id && (await db.ref('store/' + id).get()).val();
  if (!it || !(it.stock > 0)) return R(400, { error: 'This reward is out of stock' });
  let upi = null;
  if (it.type === 'upi') {
    upi = String(b.upi || '').trim();
    if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(upi)) return R(400, { error: 'Enter a valid UPI ID, like name@bank' });
  }
  const pay = await ur.child('points').transaction(x => x === null ? 0 : (x >= it.pts ? x - it.pts : undefined));
  if (!pay.committed) return R(400, { error: `You need ${it.pts} points for this reward` });
  const refund = () => ur.child('points').transaction(x => (x || 0) + it.pts);
  const rec = { id, type: it.type, name: NAMES[it.type], rs: it.rs, pts: it.pts, at: Date.now() };
  if (it.type === 'upi') {
    const s = await db.ref(`store/${id}/stock`).transaction(x => x === null ? 0 : (x > 0 ? x - 1 : undefined));
    if (!s.committed) { await refund(); return R(400, { error: 'This reward is out of stock' }); }
    rec.upi = upi; rec.status = 'pending';
  } else {
    let got = null;                                                  // take one code atomically
    await db.ref('codes/' + id).transaction(c => {
      got = null;
      if (c === null) return null;
      const k = Object.keys(c)[0];
      if (!k) return null;
      got = c[k].code; delete c[k];
      return Object.keys(c).length ? c : null;
    });
    if (!got) { await refund(); return R(400, { error: 'This reward is out of stock' }); }
    await db.ref(`store/${id}/stock`).transaction(x => x > 0 ? x - 1 : 0);
    rec.code = got; rec.status = 'done';
  }
  const rr = db.ref('redeems/' + u.uid).push();
  await rr.set(rec);
  await db.ref(`rewardSpend/${new Date(rec.at + 19800000).toISOString().slice(0, 10)}/${it.type}`).transaction(x => Math.round(((x || 0) + it.rs) * 100) / 100);   // money given as rewards (admin only)
  if (it.type === 'upi') await db.ref('upiReq/' + rr.key).set({ rid: rr.key, uid: u.uid, email: me.email || null, upi, rs: it.rs, pts: it.pts, status: 'pending', at: rec.at });
  return R(200, { ok: true, rec });
};
