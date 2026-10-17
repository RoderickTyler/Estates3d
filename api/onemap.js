// api/onemap.js  (Vercel serverless function for the Estates3d project)
//
// Built from how your working ura-condo-research proxy does it:
//  - action=search  : OneMap's address search needs NO login, so no password is used at all.
//  - action=revgeo  : coordinates -> address. This one needs a token, so it logs in with the
//                     ONEMAP_EMAIL / ONEMAP_PASSWORD saved in Vercel (optional; skip if you
//                     don't need it). Nothing secret is ever returned to the page.

const ALLOWED = [
  'https://estates3d.vercel.app',        // new Vercel project (change if Vercel gives you a different address)
  'https://rodericktyler.github.io',     // GitHub Pages (any repo under this account)
];

let cache = { token: null, exp: 0 };

async function getToken() {
  if (cache.token && Date.now() < cache.exp - 3600e3) return cache.token;
  const email = (process.env.ONEMAP_EMAIL || '').trim();
  const password = (process.env.ONEMAP_PASSWORD || '').trim();
  if (!email || !password) throw new Error('login not configured');
  const r = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('login rejected by OneMap');
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

    if (action === 'search') {
      if (!q || String(q).length > 100) return res.status(400).json({ Status: 'Failure', Message: 'q required' });
      const r = await fetch(
        'https://www.onemap.gov.sg/api/common/elastic/search' +
        `?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
      );
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      return res.json({ Status: 'Success', Result: await r.json() });
    }

    if (action === 'revgeo') {
      const la = Number(lat), ln = Number(lng);
      if (!isFinite(la) || !isFinite(ln)) return res.status(400).json({ Status: 'Failure', Message: 'lat/lng required' });
      const t = await getToken();
      const r = await fetch(
        `https://www.onemap.gov.sg/api/public/revgeocode?location=${la},${ln}&buffer=40&addressType=All&otherFeatures=N`,
        { headers: { Authorization: t } }
      );
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      return res.json({ Status: 'Success', Result: await r.json() });
    }

    return res.status(400).json({ Status: 'Failure', Message: 'Unknown action' });
  } catch (e) {
    console.error('onemap error:', e.message);   // visible only in Vercel Logs
    return res.status(502).json({ Status: 'Failure', Message: 'upstream failed' });
  }
};
