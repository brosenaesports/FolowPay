// Premium Profile Booster: a separate rupee (₹) wallet + an SMM panel (API v2) reseller.
// The panel key is read ONLY from the Netlify environment variable SMM_API_KEY. It is never sent to the browser.
const { db } = require('./lib');

const SMM_URL = process.env.SMM_API_URL || 'https://indiansmm.xyz/api/v2';
const GATEWAY = 'https://gateway.anujbots.in/';
const MARGIN = 1.10;                                   // 10% is added to every price. It is never shown as a commission.
const MIN_TOPUP = 10, MAX_TOPUP = 5000;                // rupees
const DAY = 864e5;

const ist = ms => new Date(ms + 19800000).toISOString().slice(0, 10);
const r2 = n => Math.round(n * 100) / 100;
const rs = p => Math.round(p) / 100;                   // paise -> rupees
const safe = s => String(s || '').replace(/[^\w-]/g, '');
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

class Net extends Error {}                             // timeout / unreadable reply: the outcome is unknown
class Api extends Error {}                             // setup problem or a clear answer from the panel

// ---------- panel API (server side only) ----------
async function smm(params, ms = 8000) {
  const key = process.env.SMM_API_KEY;
  if (!key) throw new Api('Premium booster is not set up yet');
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  let txt;
  try {
    const r = await fetch(SMM_URL, {
      method: 'POST', signal: c.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (compatible; FollowPay)' },
      body: new URLSearchParams({ key, ...params })
    });
    txt = await r.text();
  } catch { throw new Net('Could not reach the booster service'); }
  finally { clearTimeout(t); }
  try { return JSON.parse(txt); } catch { throw new Net('Unexpected reply from the booster service'); }
}

// ---------- platforms ----------
const PLATS = [['youtube', 'YouTube'], ['instagram', 'Instagram'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp Channel'], ['x', 'X (Twitter)'],
  ['facebook', 'Facebook'], ['tiktok', 'TikTok'], ['spotify', 'Spotify'], ['linkedin', 'LinkedIn'], ['snapchat', 'Snapchat'], ['threads', 'Threads'], ['other', 'More']];
const RX = [['whatsapp', /whats\s?app/i], ['telegram', /telegram|\btg\b/i], ['youtube', /youtube|\byt\b/i], ['instagram', /instagram|\big\b|\binsta\b/i],
  ['facebook', /facebook|\bfb\b/i], ['x', /twitter|tweet|\bx\.com|\(x\)|(^|[^a-z0-9])x[\s\-]+(followers?|likes?|views?|reposts?|retweets?|posts?|comments?|polls?|impressions|spaces?)/i],
  ['tiktok', /tik\s?tok/i], ['spotify', /spotify/i], ['linkedin', /linkedin/i], ['snapchat', /snap\s?chat/i], ['threads', /\bthreads\b/i]];
const platOf = (cat, name) => { for (const [k, r] of RX) if (r.test(cat)) return k; for (const [k, r] of RX) if (r.test(name)) return k; return 'other'; };

// ---------- currency check + catalog (cached) ----------
let MEM = null;
async function config(force) {
  const c = (await db.ref('pmCfg').get()).val();
  if (!force && c && Date.now() - c.at < 6 * 36e5) return c;
  const j = await smm({ action: 'balance' });
  if (j.error) throw new Api('The booster service is unavailable right now');
  const cur = String(j.currency || '').toUpperCase(), env = +process.env.SMM_RATE_MULT;
  const mult = cur === 'INR' ? 1 : (env > 0 ? env : null);   // refuse to sell if the panel is not in rupees and no multiplier is set
  const n = { at: Date.now(), cur, mult, bal: +j.balance || 0 };
  await db.ref('pmCfg').set(n);
  return n;
}
async function catalog() {
  if (MEM && Date.now() - MEM.at < 10 * 6e4) return MEM;
  const cached = (await db.ref('pmCatalog').get()).val();
  if (cached && cached.services && Date.now() - cached.at < 30 * 6e4) return (MEM = { at: cached.at, services: Object.values(cached.services) });
  const cfg = await config();
  if (!cfg.mult) throw new Api('Prices are being set up. Please try again later.');
  const j = await smm({ action: 'services' }, 9000);
  if (!Array.isArray(j)) throw new Api('Services are unavailable right now');
  const services = [];
  for (const s of j) {
    const type = String(s.type || 'Default');
    if (!['Default', 'Custom Comments'].includes(type)) continue;          // other types need extra fields we do not collect
    const r = (+s.rate) * cfg.mult, mn = Math.floor(+s.min), mx = Math.floor(+s.max);
    if (!(r > 0) || !(mn > 0) || !(mx >= mn)) continue;
    const category = clean(s.category).slice(0, 80), name = clean(s.name).slice(0, 140);
    services.push({ i: +s.service, n: name, c: category, p: platOf(category, name), r: +r.toFixed(6), mn, mx, f: !!s.refill, t: type === 'Custom Comments' ? 'c' : 'd', d: clean(s.desc || s.description).slice(0, 240) });
  }
  const out = { at: Date.now(), services };
  await db.ref('pmCatalog').set(out);
  return (MEM = out);
}
const dispRate = r => Math.ceil(r * MARGIN * 100 - 1e-7) / 100;                 // price per 1000 shown to users (includes the 10%)
const priceP = (r, q) => Math.max(1, Math.ceil(r * q / 1000 * MARGIN * 100 - 1e-7));   // paise charged
const costP = (r, q) => r * q / 1000 * 100;                                    // paise it costs us

// ---------- wallet (paise, integer) ----------
const WB = uid => db.ref('pmWallets/' + uid + '/bal');
async function adj(uid, delta, type, note, ref) {
  const t = await WB(uid).transaction(x => { const n = (x || 0) + delta; return n < 0 ? undefined : n; });
  if (!t.committed) return null;
  const id = db.ref('pmLedger/' + uid).push().key;
  await db.ref(`pmLedger/${uid}/${id}`).set({ id, type, amt: delta, bal: t.snapshot.val(), note: String(note || '').slice(0, 120), ref: ref || null, at: Date.now() });
  return t.snapshot.val();
}
const day = (node, v) => v ? db.ref(node + '/' + ist(Date.now())).transaction(x => (x || 0) + v) : null;

// ---------- order status ----------
const FINAL = s => /^(completed|partial|canceled|cancelled|refunded|fail|failed)/i.test(String(s || ''));
const RFINAL = s => /^(completed|rejected|canceled|cancelled|error|failed)/i.test(String(s || ''));
async function refundOrder(uid, o, amtP, why) {                                  // idempotent: money can only come back once
  amtP = Math.min(Math.max(0, Math.floor(amtP)), o.priceP - (o.refundedP || 0));
  if (amtP <= 0) return 0;
  const t = await db.ref(`pmOrders/${uid}/${o.id}/refundedP`).transaction(x => (x || 0) + amtP <= o.priceP ? (x || 0) + amtP : undefined);   // never refund more than was paid
  if (!t.committed) return 0;
  await adj(uid, amtP, 'refund', why, o.id);
  await day('pmSales', -amtP); await day('pmCost', -(o.costP || 0) * amtP / o.priceP);
  o.refundedP = t.snapshot.val();
  return amtP;
}
async function sync(uid, list) {
  const todo = list.filter(x => x.panel && !FINAL(x.status) && Date.now() - (x.chk || 0) > 30000).slice(0, 100);
  if (todo.length) {
    try {
      const j = await smm({ action: 'status', orders: todo.map(x => x.panel).join(',') }, 7000);
      for (const o of todo) {
        const s = j && j[String(o.panel)], now = Date.now(), up = { chk: now };
        if (s && !s.error && s.status) {
          up.status = String(s.status); up.remains = Math.max(0, +s.remains || 0); if (s.start_count != null) up.start = +s.start_count || 0;
        }
        await db.ref(`pmOrders/${uid}/${o.id}`).update(up); Object.assign(o, up);
        const cancelled = /^(canceled|cancelled|refunded|fail|failed)/i.test(o.status), partial = /^partial/i.test(o.status);
        if (cancelled || partial) {
          const g = await db.ref(`pmOrders/${uid}/${o.id}/settled`).transaction(x => x ? undefined : true);   // only one request may settle an order
          if (g.committed) await refundOrder(uid, o, cancelled ? o.priceP : o.priceP * Math.min(1, (o.remains || 0) / o.qty), cancelled ? 'Order cancelled, money returned' : 'Partial order, unused amount returned');
        }
      }
    } catch { /* keep showing the last known status */ }
  }
  let n = 0;                                                                     // refresh refill requests that are still open
  for (const o of list) for (const f of Object.values(o.refills || {})) {
    if (n >= 3 || RFINAL(f.status) || Date.now() - (f.chk || 0) < 30000) continue;
    n++;
    try {
      const j = await smm({ action: 'refill_status', refill: f.id }, 4000);
      const up = { chk: Date.now() }; if (j && j.status) up.status = String(j.status);
      await db.ref(`pmOrders/${uid}/${o.id}/refills/${f.key}`).update(up); Object.assign(f, up);
    } catch { /* try again next time */ }
  }
}
const pubOrder = (o, tk) => ({
  id: o.id, panel: o.panel || null, name: o.name, p: o.p, link: o.link, qty: o.qty, price: rs(o.priceP), refunded: rs(o.refundedP || 0),
  status: o.review && !o.panel ? 'Confirming' : (o.status || 'Pending'), remains: o.remains != null ? o.remains : null, start: o.start != null ? o.start : null,
  canRefill: !!o.refill, refills: Object.values(o.refills || {}).sort((a, b) => b.at - a.at).map(f => ({ id: f.id, status: f.status, at: f.at })),
  created: o.created, tickets: tk || []
});

// ---------- user actions ----------
module.exports = async (b, u, me, ur, R) => {
  const a = b.action;
  if (!['pmWallet', 'pmTopup', 'pmTopupCheck', 'pmTopupCancel', 'pmPlatforms', 'pmServices', 'pmOrder', 'pmOrders', 'pmRefill', 'pmTicket', 'pmTickets'].includes(a)) return null;
  const uid = u.uid;
  try {
    if (a === 'pmWallet') {
      const [bal, lg, py] = await Promise.all([WB(uid).get(), db.ref('pmLedger/' + uid).limitToLast(30).get(), db.ref('pmPay/' + uid).limitToLast(20).get()]);
      const now = Date.now();
      return R(200, {
        bal: rs(bal.val() || 0), min: MIN_TOPUP, max: MAX_TOPUP,
        ledger: Object.values(lg.val() || {}).sort((x, y) => y.at - x.at).map(x => ({ id: x.id, type: x.type, amt: rs(x.amt), bal: rs(x.bal), note: x.note, at: x.at })),
        pays: Object.values(py.val() || {}).filter(x => x.status === 'PAID' || (x.status === 'PENDING' && now < x.exp + 60000)).sort((x, y) => y.created - x.created)
      });
    }

    // ----- add money -----
    if (a === 'pmTopup' || a === 'pmTopupCheck' || a === 'pmTopupCancel') {
      const KEY = process.env.GRAM_API_KEY;
      if (!KEY) return R(500, { error: 'Payments are not set up yet' });
      const ref = db.ref('pmPay/' + uid), call = async p => (await fetch(GATEWAY + p)).json();
      if (a === 'pmTopup') {
        const amt = Math.floor(+b.amount);
        if (!(amt >= MIN_TOPUP && amt <= MAX_TOPUP)) return R(400, { error: `Enter an amount between ₹${MIN_TOPUP} and ₹${MAX_TOPUP}` });
        const now = Date.now(), q = (await ref.limitToLast(20).get()).val() || {};
        if (Object.values(q).filter(x => x.status === 'PENDING' && x.exp > now).length >= 3) return R(429, { error: 'You already have pending payments. Pay one or wait 5 minutes.' });
        const j = await call(`autoqr.php?api_key=${encodeURIComponent(KEY)}&amount=${amt}`);
        if (j.status !== 'success') return R(502, { error: 'Payment gateway: ' + (j.message || 'try again') });
        const d = j.data, rec = { id: d.order_id, rs: amt, amount: d.amount, status: 'PENDING', created: now, exp: now + (d.valid_seconds || 300) * 1000, qr: d.qr_url, url: d.payment_url, intent: d.intent || null };
        await ref.child(d.order_id).set(rec);
        return R(200, rec);
      }
      const id = String(b.orderId || '').replace(/[^A-Za-z0-9]/g, ''), rec = id && (await ref.child(id).get()).val();
      if (!rec) return R(404, { error: 'Payment not found' });
      if (rec.status !== 'PENDING') return R(200, { status: rec.status });
      const j = await call(`autoverify.php?api_key=${encodeURIComponent(KEY)}&order_id=${id}`), st = j.data && j.data.status;
      if (st === 'PAID') {
        const c = await ref.child(id + '/credited').transaction(x => x ? undefined : true);   // credit once only
        if (!c.committed) return R(200, { status: 'PAID' });
        await ref.child(id).update({ status: 'PAID', paid: Date.now() });
        const bal = await adj(uid, rec.rs * 100, 'topup', 'UPI payment', id);
        await day('pmTopups', rec.rs * 100);
        return R(200, { status: 'PAID', bal: rs(bal || 0), added: rec.rs });
      }
      if (a === 'pmTopupCancel') { await ref.child(id).update({ status: st === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED' }); return R(200, { status: 'CANCELLED' }); }
      if (st === 'EXPIRED') await ref.child(id).update({ status: 'EXPIRED' });
      return R(200, { status: st || 'PENDING' });
    }

    // ----- catalog -----
    if (a === 'pmPlatforms') {
      const { services } = await catalog(), cnt = {};
      for (const s of services) cnt[s.p] = (cnt[s.p] || 0) + 1;
      return R(200, { platforms: PLATS.filter(([k]) => cnt[k]).map(([k, n]) => ({ k, n, c: cnt[k] })) });
    }
    if (a === 'pmServices') {
      const { services } = await catalog(), p = String(b.platform || '');
      return R(200, { services: services.filter(s => s.p === p).map(s => ({ id: s.i, n: s.n, c: s.c, rate: dispRate(s.r), u: +(s.r * MARGIN).toFixed(8), mn: s.mn, mx: s.mx, f: s.f, t: s.t, d: s.d })) });
    }

    // ----- place an order -----
    if (a === 'pmOrder') {
      const { services } = await catalog(), s = services.find(x => x.i === +b.service);
      if (!s) return R(400, { error: 'This service is not available. Please pick another.' });
      const link = String(b.link || '').trim();
      if (!/^[^\s<>"']{3,300}$/.test(link)) return R(400, { error: 'Enter a valid link or username (no spaces)' });
      let qty, lines = [];
      if (s.t === 'c') { lines = String(b.comments || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); qty = lines.length; }
      else qty = Math.floor(+b.quantity);
      if (!(qty >= s.mn && qty <= s.mx)) return R(400, { error: s.t === 'c' ? `Write between ${s.mn} and ${s.mx} comments, one per line` : `Quantity must be between ${s.mn} and ${s.mx}` });
      const pr = priceP(s.r, qty), co = costP(s.r, qty);
      const lk = await db.ref('pmLock/' + uid).transaction(x => (x && Date.now() - x < 3000) ? undefined : Date.now());
      if (!lk.committed) return R(429, { error: 'Please wait a moment before placing another order' });
      const bal = await adj(uid, -pr, 'order', s.n, null);
      if (bal === null) return R(402, { error: 'Not enough wallet balance. Add money to continue.', short: true });
      const oid = db.ref('pmOrders/' + uid).push().key;
      // Save the order BEFORE calling the panel, so a stopped request can never leave money taken without a record.
      const rec = { id: oid, uid, email: me.email || null, svc: s.i, name: s.n, p: s.p, link, qty, priceP: pr, costP: co, refill: s.f, status: 'Confirming', review: true, created: Date.now() };
      await db.ref(`pmOrders/${uid}/${oid}`).set(rec);
      await db.ref('pmAll/' + oid).set({ uid, at: rec.created });
      await day('pmSales', pr); await day('pmCost', co);
      const undo = async why => {                                              // the panel clearly refused: give the money back and forget the attempt
        await refundOrder(uid, rec, pr, why);
        await db.ref(`pmOrders/${uid}/${oid}`).remove(); await db.ref('pmAll/' + oid).remove();
      };
      try {
        const params = { action: 'add', service: s.i, link };
        if (s.t === 'c') params.comments = lines.join('\n'); else params.quantity = qty;
        const j = await smm(params, 8000);
        if (!j || j.error || !j.order) {
          await undo('Order could not be placed');
          const e = clean(j && j.error);
          if (/fund|balance|credit/i.test(e)) { await db.ref('pmAlert').set({ msg: 'Panel balance is low: orders are failing', at: Date.now() }); return R(503, { error: 'This service is temporarily unavailable. Please try again later.' }); }
          return R(400, { error: e || 'The order was not accepted. Check your link and try again.' });
        }
        rec.panel = String(j.order);
        await db.ref(`pmOrders/${uid}/${oid}`).update({ panel: rec.panel, status: 'Pending', review: false });
        rec.status = 'Pending';
      } catch (e) {
        if (!(e instanceof Net)) { await undo('Order could not be placed'); throw e; }
        // unknown outcome (timeout / unreadable reply): the order stays as "Confirming" and the money stays held until the admin checks the panel
      }
      return R(200, { id: oid, panel: rec.panel || null, status: rec.status, bal: rs((await WB(uid).get()).val() || 0) });
    }

    // ----- my orders / refill / tickets -----
    if (a === 'pmOrders') {
      const [os, tk] = await Promise.all([db.ref('pmOrders/' + uid).limitToLast(60).get(), db.ref('pmUserTickets/' + uid).get()]);
      const list = Object.values(os.val() || {}).sort((x, y) => y.created - x.created);
      for (const o of list) o.refills = Object.entries(o.refills || {}).reduce((m, [k, v]) => (m[k] = { ...v, key: k }, m), {});
      await sync(uid, list);
      const tks = Object.values(tk.val() || {});
      return R(200, { orders: list.map(o => pubOrder(o, tks.filter(t => t.oid === o.id).sort((x, y) => y.at - x.at))) });
    }
    if (a === 'pmRefill') {
      const oid = safe(b.orderId), o = (await db.ref(`pmOrders/${uid}/${oid}`).get()).val();
      if (!o) return R(404, { error: 'Order not found' });
      if (!o.refill) return R(400, { error: 'Refill is not available for this service. Please raise a ticket instead.' });
      if (!/^completed$/i.test(o.status || '')) return R(400, { error: 'You can ask for a refill after the order is completed' });
      if (!o.panel) return R(400, { error: 'This order has no order number yet' });
      const rf = Object.values(o.refills || {});
      if (rf.some(f => !RFINAL(f.status))) return R(400, { error: 'A refill for this order is already in progress' });
      if (rf.length && Date.now() - Math.max(...rf.map(f => f.at)) < DAY) return R(400, { error: 'Please wait 24 hours between refill requests' });
      const lk = await db.ref('pmLock/r' + oid).transaction(x => (x && Date.now() - x < 10000) ? undefined : Date.now());
      if (!lk.committed) return R(429, { error: 'Please wait a moment' });
      let j;
      try { j = await smm({ action: 'refill', order: o.panel }); } catch { return R(502, { error: 'Could not reach the booster service. Please try again.' }); }
      if (!j || j.error || !j.refill) return R(400, { error: clean(j && j.error) || 'Refill is not available for this order yet' });
      await db.ref(`pmOrders/${uid}/${oid}/refills`).push({ id: String(j.refill), at: Date.now(), status: 'Pending' });
      return R(200, { ok: true });
    }
    if (a === 'pmTicket') {
      const msg = String(b.message || '').trim();
      if (msg.length < 5) return R(400, { error: 'Write at least 5 characters about the problem' });
      if (msg.length > 600) return R(400, { error: 'Keep the message under 600 characters' });
      let o = null; const oid = b.orderId ? safe(b.orderId) : '';
      if (oid) { o = (await db.ref(`pmOrders/${uid}/${oid}`).get()).val(); if (!o) return R(404, { error: 'Order not found' }); }
      const mine = Object.values((await db.ref('pmUserTickets/' + uid).get()).val() || {});
      if (mine.filter(t => t.status !== 'solved').length >= 10) return R(429, { error: 'You have many open tickets. Please wait for replies.' });
      if (oid && mine.filter(t => t.oid === oid).length >= 3) return R(400, { error: 'You already sent 3 tickets for this order' });
      if (oid && mine.some(t => t.oid === oid && t.status !== 'solved')) return R(400, { error: 'You already have an open ticket for this order' });
      const tid = db.ref('pmTickets').push().key, at = Date.now();
      await Promise.all([
        db.ref('pmTickets/' + tid).set({ id: tid, uid, email: me.email || null, oid: oid || null, panel: o ? (o.panel || null) : null, name: o ? o.name : null, link: o ? o.link : null, msg, status: 'open', note: '', at }),
        db.ref(`pmUserTickets/${uid}/${tid}`).set({ id: tid, oid: oid || null, panel: o ? (o.panel || null) : null, msg, status: 'open', note: '', at })]);
      return R(200, { ok: true, id: tid });
    }
    if (a === 'pmTickets') {
      const t = Object.values((await db.ref('pmUserTickets/' + uid).get()).val() || {}).sort((x, y) => y.at - x.at);
      return R(200, { tickets: t });
    }
  } catch (e) {
    if (e instanceof Net || e instanceof Api) return R(503, { error: e.message });
    throw e;
  }
  return null;
};

// ---------- admin actions (called from admin.js after the admin is verified) ----------
module.exports.admin = async (b, R) => {
  const a = b.action;
  try {
    if (a === 'admPmOverview') {
      let panel = null, err = null;
      try { const c = await config(true); panel = { bal: c.bal, cur: c.cur, mult: c.mult }; } catch (e) { err = e.message; }
      const [sl, co, tp, ws, al, all] = await Promise.all(['pmSales', 'pmCost', 'pmTopups', 'pmWallets', 'pmAlert'].map(n => db.ref(n).get().then(x => x.val())).concat([db.ref('pmAll').limitToLast(150).get().then(x => x.val() || {})]));
      const now = ist(Date.now()), y = now.slice(0, 4), m = now.slice(0, 7), wk = ist(Date.now() - 6 * DAY);
      const per = d => { const o = { today: 0, week: 0, month: 0, year: 0, all: 0 }; for (const [k, v] of Object.entries(d || {})) { o.all += v; if (k === now) o.today += v; if (k >= wk) o.week += v; if (k.startsWith(m)) o.month += v; if (k.startsWith(y)) o.year += v; } for (const k in o) o[k] = rs(o[k]); return o; };
      const sales = per(sl), cost = per(co), topups = per(tp), profit = {};
      for (const k in sales) profit[k] = r2(sales[k] - cost[k]);
      const wallets = rs(Object.values(ws || {}).reduce((t, w) => t + (w.bal || 0), 0));
      const ids = Object.entries(all).sort((x, y2) => y2[1].at - x[1].at);
      const recs = await Promise.all(ids.map(async ([id, v]) => (await db.ref(`pmOrders/${v.uid}/${id}`).get()).val()));
      const orders = recs.filter(Boolean).map(o => ({ id: o.id, uid: o.uid, email: o.email, name: o.name, p: o.p, link: o.link, qty: o.qty, price: rs(o.priceP), cost: r2((o.costP || 0) / 100), refunded: rs(o.refundedP || 0), status: o.status, review: !!o.review && !o.panel, panel: o.panel || null, created: o.created }));
      return R(200, { panel, err, alert: al, sales, cost, profit, topups, wallets, orders: orders.slice(0, 60), confirming: orders.filter(o => o.review && !o.refunded) });
    }
    if (a === 'admPmRefund') {
      const oid = safe(b.id), uid = safe(b.uid), o = (await db.ref(`pmOrders/${uid}/${oid}`).get()).val();
      if (!o) return R(404, { error: 'Order not found' });
      const got = await refundOrder(uid, o, o.priceP, 'Refund from support');
      if (!got) return R(400, { error: 'Nothing left to refund for this order' });
      await db.ref(`pmOrders/${uid}/${oid}`).update({ status: 'Canceled', review: false });
      return R(200, { ok: true, refunded: rs(got) });
    }
    if (a === 'admPmRefresh') { MEM = null; await db.ref('pmCatalog').remove(); await db.ref('pmAlert').remove(); await config(true); await catalog(); return R(200, { ok: true }); }
    if (a === 'admPmTickets') {
      const v = (await db.ref('pmTickets').limitToLast(150).get()).val() || {}, rank = { open: 0, processing: 1, solved: 2 };
      const l = Object.values(v).sort((x, y) => (rank[x.status] - rank[y.status]) || y.at - x.at).slice(0, 100);
      const os = await Promise.all(l.map(async t => t.oid ? (await db.ref(`pmOrders/${t.uid}/${t.oid}`).get()).val() : null));
      return R(200, { tickets: l.map((t, i) => ({ ...t, order: os[i] ? { id: os[i].id, panel: os[i].panel || null, name: os[i].name, p: os[i].p, link: os[i].link, qty: os[i].qty, price: rs(os[i].priceP), status: os[i].status, created: os[i].created } : null })) });
    }
    if (a === 'admPmTicketSet') {
      const id = safe(b.id), t = (await db.ref('pmTickets/' + id).get()).val();
      if (!t) return R(404, { error: 'Ticket not found' });
      if (!['open', 'processing', 'solved'].includes(b.status)) return R(400, { error: 'Choose a status' });
      const up = { status: b.status, note: String(b.note || '').trim().slice(0, 300), updated: Date.now() };
      await Promise.all([db.ref('pmTickets/' + id).update(up), db.ref(`pmUserTickets/${t.uid}/${id}`).update(up)]);
      return R(200, { ok: true });
    }
    if (a === 'admPmTicketDel') {
      const id = safe(b.id), t = (await db.ref('pmTickets/' + id).get()).val();
      if (!t) return R(404, { error: 'Ticket not found' });
      await Promise.all([db.ref('pmTickets/' + id).remove(), db.ref(`pmUserTickets/${t.uid}/${id}`).remove()]);
      return R(200, { ok: true });
    }
  } catch (e) {
    if (e instanceof Net || e instanceof Api) return R(503, { error: e.message });
    throw e;
  }
  return R(400, { error: 'Unknown admin action' });
};
