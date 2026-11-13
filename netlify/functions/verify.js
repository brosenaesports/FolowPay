// Account / video checks without any official API (best effort: social sites can block servers)
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const get = async (u, h = {}) => {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 3500);
  try { return await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en', ...h }, signal: c.signal }); }
  finally { clearTimeout(t); }
};
const meta = (h, p) => { const m = h.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)`, 'i')); return m && m[1].replace(/&amp;/g, '&'); };
async function dataUri(url) {
  try {
    const r = await get(url), b = Buffer.from(await r.arrayBuffer());
    return r.ok && b.length < 60000 ? `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${b.toString('base64')}` : null;
  } catch { return null; }
}
const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MOB = 'Instagram 219.0.0.12.117 Android (30/11; 420dpi; 1080x2220; samsung; SM-G991B; o1s; exynos2100; en_US; 350696610)';
// Instagram: four independent checks run at the same time; any one that confirms the account is enough
async function igScrape(h) {
  const hl = h.toLowerCase(), enc = encodeURIComponent(h);
  const api = (host, ua) => get(`https://${host}/api/v1/users/web_profile_info/?username=${enc}`, { 'user-agent': ua, 'x-ig-app-id': '936619743392459' });
  const [pg, a1, a2, em] = await Promise.allSettled([
    get('https://www.instagram.com/' + h + '/', { 'user-agent': FB }),
    api('www.instagram.com', UA),
    api('i.instagram.com', MOB),
    get('https://www.instagram.com/' + h + '/embed/')
  ]);
  const st = x => x.status === 'fulfilled' ? x.value.status : 'no answer';
  const why = `page ${st(pg)}, web ${st(a1)}, mobile ${st(a2)}, embed ${st(em)}`;
  let missing = false, found = false, pic = null;
  if (pg.status === 'fulfilled') {
    const r = pg.value;
    if (r.status === 404) missing = true;
    else if (r.ok) {
      const t = await r.text(), info = (meta(t, 'og:title') || '') + ' ' + (meta(t, 'og:description') || '');
      if (info.toLowerCase().includes('@' + hl)) { found = true; pic = meta(t, 'og:image'); }
    }
  }
  for (const a of [a1, a2]) if (a.status === 'fulfilled') {
    const r = a.value;
    if (r.status === 404) missing = true;
    else if (r.ok) try {
      const u = ((await r.json()).data || {}).user;
      if (u && String(u.username).toLowerCase() === hl) { found = true; pic = pic || u.profile_pic_url; }
    } catch {}
  }
  if (em.status === 'fulfilled' && em.value.ok) try {
    if ((await em.value.text()).toLowerCase().includes('"username":"' + hl + '"')) found = true;
  } catch {}
  if (found) return { state: 'ok', pic: pic ? await dataUri(pic) : null, why };
  return { state: missing ? 'missing' : 'unknown', why };
}
// Main Instagram check: SearchApi.io profile lookup (works from servers; scraping above is only a backup)
async function searchApi(h) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
  try {
    const r = await fetch('https://www.searchapi.io/api/v1/search?engine=instagram_profile&username=' + encodeURIComponent(h),
      { headers: { authorization: 'Bearer ' + (process.env.SEARCHAPI_KEY || 'dUXLeq5TjY2Ty82Dy7mwz2if') }, signal: c.signal });
    let j = {}; try { j = await r.json(); } catch {}
    if (j.profile && String(j.profile.username || '').toLowerCase() === h.toLowerCase()) return { state: 'ok', pic: j.profile.avatar, why: 'searchapi ok' };
    const msg = String(j.error || '').slice(0, 80), why = `searchapi ${r.status} ${msg}`.trim();
    if (r.status === 404 || /not found|does not exist|doesn.?t exist|no (such )?(user|profile|account)/i.test(msg)) return { state: 'missing', why };
    return { state: 'unknown', why };
  } catch { return { state: 'unknown', why: 'searchapi no answer' }; }
  finally { clearTimeout(t); }
}
async function igProfile(h) {
  const s = await searchApi(h);
  if (s.state === 'ok') return { state: 'ok', pic: s.pic ? await dataUri(s.pic) : null, why: s.why };
  if (s.state === 'missing') return s;
  const f = await igScrape(h);                                      // backup when SearchApi is unavailable
  return { ...f, why: s.why + '; ' + f.why };
}
// -> { state: 'ok' | 'missing' | 'unknown', pic }
async function profile(p, h) {
  try {
    if (p === 'youtube') {
      const r = await get('https://www.youtube.com/' + h + '?hl=en');
      if (r.status === 404) return { state: 'missing' };
      const pic = meta(await r.text(), 'og:image');
      return r.ok && pic ? { state: 'ok', pic: await dataUri(pic.replace(/=s\d+.*$/, '=s96-c')) } : { state: 'unknown' };
    }
    return await igProfile(h);
  } catch { return { state: 'unknown' }; }
}
const ytId = u => {
  try {
    const L = new URL(u);
    if (L.hostname === 'youtu.be') return L.pathname.slice(1, 12);
    const m = L.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
    return m ? m[2] : L.searchParams.get('v');
  } catch { return null; }
};
// video must exist and belong to the chosen channel handle; optionally read its length
async function ytVideo(url, handle, needLen) {
  const id = ytId(String(url || '').trim());
  if (!id || !/^[\w-]{11}$/.test(id)) return { error: 'Enter a valid YouTube video link' };
  try {
    const r = await get('https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=' + id);
    if (!r.ok) return { error: 'Video not found, or it is not public' };
    const a = String((await r.json()).author_url || '').toLowerCase();
    if (!a.endsWith('/' + handle.toLowerCase())) return { error: 'This video does not belong to ' + handle };
    let secs = null;
    if (needLen) try { const m = (await (await get('https://www.youtube.com/watch?v=' + id)).text()).match(/"lengthSeconds":"(\d+)"/); if (m) secs = +m[1]; } catch {}
    return { ok: true, id, secs };
  } catch { return { error: 'Could not check the video. Try again.' }; }
}
async function igPost(url, handle) {
  let L; try { L = new URL(String(url || '').trim()); } catch { return { error: 'Enter a valid Instagram link' }; }
  if (!/(^|\.)instagram\.com$/.test(L.hostname)) return { error: 'Enter a valid Instagram link' };
  const seg = L.pathname.split('/').filter(Boolean), i = seg.findIndex(s => ['p', 'reel', 'reels', 'tv'].includes(s));
  if (i < 0 || !seg[i + 1]) return { error: 'Enter a reel or post link' };
  if (i === 1) return seg[0].toLowerCase() === handle.toLowerCase() ? { ok: true } : { error: 'This reel does not belong to @' + handle };
  try {
    const m = (await (await get(`https://www.instagram.com/${seg[i]}/${seg[i + 1]}/`)).text()).match(/"owner":\{[^}]*?"username":"([^"]+)"/);
    if (m) return m[1].toLowerCase() === handle.toLowerCase() ? { ok: true } : { error: 'This reel does not belong to @' + handle };
  } catch {}
  return { error: 'Could not confirm the owner. Use the full link that includes your username (instagram.com/yourname/reel/...)' };
}
// ---- order links (no linked profile needed): the link itself tells us what to boost ----
const reservedIg = ['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct', 'about', 'legal', 'developer', 'web', 'tags', 'locations'];
// YouTube: video link (likes, views, comments, watch time, or subscribers via the video) or channel link (subscribers)
async function ytLink(url, type) {
  let L; try { L = new URL(String(url || '').trim()); } catch { return { error: 'Paste a valid YouTube link' }; }
  const host = L.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return { error: 'Paste a valid YouTube link' };
  const id = ytId(L.href);
  if (id && /^[\w-]{11}$/.test(id)) {
    try {
      const r = await get('https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=' + id);
      if (!r.ok) return { error: 'Video not found, or it is not public' };
      const j = await r.json(), au = String(j.author_url || ''), m = au.match(/\/(@[^/?#]+)$/);
      let secs = null;
      if (type === 'watch') try { const mm = (await (await get('https://www.youtube.com/watch?v=' + id)).text()).match(/"lengthSeconds":"(\d+)"/); if (mm) secs = +mm[1]; } catch {}
      return { ok: true, id, secs, link: 'https://www.youtube.com/watch?v=' + id, handle: String(m ? decodeURIComponent(m[1]) : (j.author_name || 'YouTube channel')).slice(0, 60) };
    } catch { return { error: 'Could not check the video. Try again.' }; }
  }
  if (type !== 'subscribe') return { error: 'Paste a video link (youtube.com/watch?v=… or youtu.be/…)' };
  const seg = L.pathname.split('/').filter(Boolean);       // channel link: /@name, /channel/UC…, /c/name, /user/name
  let handle = null, path = null;
  if (seg[0] && seg[0][0] === '@') { handle = decodeURIComponent(seg[0]); path = '/' + seg[0]; }
  else if (seg[0] === 'channel' && /^UC[\w-]{20,24}$/.test(seg[1] || '')) { handle = seg[1]; path = '/channel/' + seg[1]; }
  else if ((seg[0] === 'c' || seg[0] === 'user') && /^[\w.-]{1,60}$/.test(seg[1] || '')) { handle = seg[1]; path = '/' + seg[0] + '/' + seg[1]; }
  if (!handle) return { error: 'Paste a channel link (youtube.com/@yourchannel) or any video link of the channel' };
  try { const r = await get('https://www.youtube.com' + path + '?hl=en'); if (r.status === 404) return { error: 'This YouTube channel was not found' }; } catch {}
  return { ok: true, id: null, secs: null, link: 'https://www.youtube.com' + path, handle: handle.slice(0, 60) };
}
// Instagram: profile link (followers, profile visits) or reel / post link (likes, views, comments)
async function igLink(url, type) {
  let L; try { L = new URL(String(url || '').trim()); } catch { return { error: 'Paste a valid Instagram link' }; }
  if (!/(^|\.)instagram\.com$/.test(L.hostname.toLowerCase())) return { error: 'Paste a valid Instagram link' };
  const seg = L.pathname.split('/').filter(Boolean), i = seg.findIndex(x => ['p', 'reel', 'reels', 'tv'].includes(x));
  if (['follow', 'visits'].includes(type)) {
    const h = seg[0] || '';
    if (i >= 0 || reservedIg.includes(h.toLowerCase()) || !/^[A-Za-z0-9._]{1,30}$/.test(h)) return { error: 'Paste a profile link like instagram.com/yourname' };
    const v = await profile('instagram', h);
    if (v.state === 'missing') return { error: 'No Instagram account found with this name' };
    return { ok: true, link: 'https://www.instagram.com/' + h + '/', handle: h };
  }
  if (i < 0 || !/^[\w-]{5,}$/.test(seg[i + 1] || '')) return { error: 'Paste a reel or post link' };
  const kind = seg[i] === 'reels' ? 'reel' : seg[i], owner = i === 1 && /^[A-Za-z0-9._]{1,30}$/.test(seg[0]) ? seg[0] : null;
  return { ok: true, link: `https://www.instagram.com/${kind}/${seg[i + 1]}/`, handle: owner || 'Instagram ' + (kind === 'p' ? 'post' : 'reel') };
}
module.exports = { profile, ytVideo, igPost, ytLink, igLink };
