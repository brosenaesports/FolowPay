// Serves a stored profile picture for an order: /pic?o=ORDER_ID  (browser caches it for a day)
const { db, bad } = require('./lib');
const none = c => ({ statusCode: c, body: '' });
exports.handler = async e => {
  if (bad) return none(500);
  const id = (e.queryStringParameters || {}).o;
  if (!id || !/^[\w-]+$/.test(id)) return none(404);
  try {
    const o = (await db.ref('orders/' + id).get()).val();
    if (!o) return none(404);
    const k = String(o.handle).toLowerCase().replace(/^@/, '').replace(/\./g, ',');
    const pic = (await db.ref(`userProfiles/${o.uid}/${o.platform}/${k}/pic`).get()).val();
    const m = String(pic || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) return none(404);
    return { statusCode: 200, headers: { 'content-type': m[1], 'cache-control': 'public, max-age=86400' }, body: m[2], isBase64Encoded: true };
  } catch { return none(500); }
};
