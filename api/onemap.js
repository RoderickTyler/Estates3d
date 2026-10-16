// api/onemap.js  (Vercel serverless function for the 3d-mapper project)
// Same style as your ura proxy (CommonJS), but uses Node's built-in fetch,
// so it needs no node-fetch and no package.json.
//
// Env vars to set in Vercel -> Settings -> Environment Variables (use ONE option):
//   Option A: ONEMAP_TOKEN                       a ready-made OneMap API token
//   Option B: ONEMAP_EMAIL + ONEMAP_PASSWORD     your OneMap account login
// Never put these in the code or in the repo.

const ALLOWED = [
  'https://3d-mapper-azure.vercel.app',
  'https://rodericktyler.github.io',
];

let cache = { token: null, exp: 0 };

async function getToken() {
  // Option A: a ready-made token saved in Vercel as ONEMAP_TOKEN (expires after about 3 days; replace it when it does)
  if (process.env.ONEMAP_TOKEN) return process.env.ONEMAP_TOKEN;
  // Option B: email + password, so the function fetches fresh tokens by itself
  // reuse the token until about an hour before it expires
  if (cache.token && Date.now() < cache.exp - 3600e3) return cache.token;
  const r = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD,
    }),
  });
  const text = await r.text();
  let d = {};
  try { d = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!d.access_token) throw new Error('OneMap login failed. HTTP ' + r.status + '. Reply: ' + text.slice(0, 200));
  cache = { token: d.access_token, exp: Number(d.expiry_timestamp) * 1000 };
  return cache.token;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const { action, q, lat, lng } = req.query;
    let url;

    if (action === 'search') {
      if (!q || String(q).length > 100) return res.status(400).json({ error: 'bad query' });
      url =
        'https://www.onemap.gov.sg/api/common/elastic/search' +
        `?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    } else if (action === 'revgeo') {
      const la = Number(lat), ln = Number(lng);
      if (!isFinite(la) || !isFinite(ln)) return res.status(400).json({ error: 'bad coordinates' });
      url =
        'https://www.onemap.gov.sg/api/public/revgeocode' +
        `?location=${la},${ln}&buffer=40&addressType=All&otherFeatures=N`;
    } else {
      return res.status(400).json({ error: 'unknown action' });
    }

    const r = await fetch(url, { headers: { Authorization: await getToken() } });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(r.status).json(data);
  } catch (e) {
    console.error('onemap error:', e.message);
    // TEMPORARY DEBUG: shows the reason in the browser. Never includes your password. Remove once it works.
    return res.status(502).json({
      error: 'upstream failed',
      reason: e.message,
      emailSet: !!process.env.ONEMAP_EMAIL,
      passwordSet: !!process.env.ONEMAP_PASSWORD,
      tokenSet: !!process.env.ONEMAP_TOKEN,
      node: process.version,
    });
  }
};
