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
// Instagram: ask the public profile page (as a link-preview bot) and the web profile endpoint at the same time
async function igProfile(h) {
  const hl = h.toLowerCase();
  const [pg, ap] = await Promise.allSettled([
    get('https://www.instagram.com/' + h + '/', { 'user-agent': FB }),
    get('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + h, { 'x-ig-app-id': '936619743392459' })
  ]);
  let missing = false, found = false, pic = null;
  if (pg.status === 'fulfilled') {
    const r = pg.value;
    if (r.status === 404) missing = true;
    else if (r.ok) {
      const t = await r.text(), info = (meta(t, 'og:title') || '') + ' ' + (meta(t, 'og:description') || '');
      if (info.toLowerCase().includes('@' + hl)) { found = true; pic = meta(t, 'og:image'); }
    }
  }
  if (ap.status === 'fulfilled') {
    const r = ap.value;
    if (r.status === 404) missing = true;
    else if (r.ok) try {
      const u = ((await r.json()).data || {}).user;
      if (u && String(u.username).toLowerCase() === hl) { found = true; pic = pic || u.profile_pic_url; }
    } catch {}
  }
  if (found) return { state: 'ok', pic: pic ? await dataUri(pic) : null };
  return { state: missing ? 'missing' : 'unknown' };
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
module.exports = { profile, ytVideo, igPost };
