const { db, crypto } = require('./lib');
const BONUS = 10, NEED = 10;           // referrer gets 10 points once the friend has spent 10 points on boosts

module.exports = async (b, u, me, ur, R) => {
  const a = b.action;
  if (!['refInfo', 'useRef'].includes(a)) return null;
  if (a === 'refInfo') {
    if (me.guest) return R(200, { guest: true });                    // only Google accounts can refer
    let code = me.refCode;
    for (let i = 0; i < 5 && !code; i++) {
      const c = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
      const t = await db.ref('refCodes/' + c).transaction(x => x || u.uid);
      if (t.snapshot.val() === u.uid) { code = c; await ur.update({ refCode: c }); }
    }
    const list = Object.values((await db.ref('referrals/' + u.uid).get()).val() || {});
    const paid = list.filter(x => x.paid).length;
    return R(200, { code, joined: list.length, paid, earned: paid * BONUS, list: list.slice(-20).reverse(), canUse: !me.refBy && !(me.spent > 0) });
  }
  // useRef: attach a friend's code (only before the first boost)
  if (me.refBy || me.spent > 0) return R(400, { error: 'A referral code can only be added before your first boost' });
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rid = code && (await db.ref('refCodes/' + code).get()).val();
  if (!rid) return R(400, { error: 'This referral code is not valid' });
  if (rid === u.uid) return R(400, { error: 'You cannot use your own code' });
  const rr = (await db.ref('users/' + rid).get()).val();
  if (!rr || rr.guest || rr.refBy === u.uid) return R(400, { error: 'This referral code is not valid' });
  await ur.update({ refBy: rid });
  await db.ref(`referrals/${rid}/${u.uid}`).set({ at: Date.now(), paid: false, who: String(me.name || me.email || 'User').charAt(0).toUpperCase() + '***' });
  return R(200, { ok: true });
};

// called after every boost: pays the referrer once, when the friend (Google account) has spent 10+ points
module.exports.payout = async (uid, ur, me, spent) => {
  if (!me.refBy || me.guest || me.refPaid || spent < NEED) return;
  if (!(await ur.child('refPaid').transaction(x => x ? undefined : true)).committed) return;
  const rr = (await db.ref('users/' + me.refBy).get()).val();
  if (!rr || rr.guest) return;
  await db.ref(`users/${me.refBy}/points`).transaction(x => (x || 0) + BONUS);
  await db.ref(`referrals/${me.refBy}/${uid}`).update({ paid: true, paidAt: Date.now() });
};
