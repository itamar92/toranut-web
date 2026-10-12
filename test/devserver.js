/**
 * test/devserver.js — שרת פיתוח מקומי בלי Google: ה-API האמיתי (lib/api.js) על DB בזיכרון (test/memdb.js),
 * מאוכלס במחלקה לדוגמה (test/demo.js). לפיתוח הממשק ולבדיקות ידניות.
 *   node test/devserver.js   →  http://localhost:8787
 * קודים: צ׳יף 0000 · רופא/ה 1001 … 1018. /dev/cron?now=<ISO> מריץ את התזכורת האוטומטית בתאריך שבוחרים.
 * כניסה עם Google לא פעילה כאן (אין GOOGLE_CLIENT_ID) — היא נבדקת ב-test/auth.test.js.
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-dev-secret-dev-secret-1234';
process.env.CHIEF_CODE = process.env.CHIEF_CODE || '0000';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const http = require('http'), fs = require('fs'), path = require('path');
const mem = require('./memdb').use(require('./demo').demoData(require('../lib/api').todayIso()));

const handlers = { login: require('../api/login'), logout: require('../api/logout'), me: require('../api/me'), rpc: require('../api/rpc'), cron: require('../api/cron') };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function wrap(req, res, body){
  res.status = c => { res.statusCode = c; return res };
  res.json = o => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)) };
  req.body = body ? (() => { try { return JSON.parse(body) } catch (e) { return {} } })() : {};
}
async function devCron(req, res){
  const q = new URL(req.url, 'http://x').searchParams;
  const now = q.get('now') ? Date.parse(q.get('now')) : Date.now();
  const out = await require('../lib/api').tick(now);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out, null, 2));
}

const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')){ const h = handlers[url.slice(5)]; if (!h){ res.statusCode = 404; return res.end('{}') } wrap(req, res, body); return h(req, res) }
    if (url === '/dev/cron') return devCron(req, res).catch(e => { res.statusCode = 500; res.end(String(e && e.message)) });
    const f = path.join(__dirname, '..', 'public', url === '/' ? 'index.html' : path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.join(__dirname, '..', 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.statusCode = 404; return res.end('not found') }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store'); res.end(fs.readFileSync(f));
  });
});
const PORT = process.env.PORT || 8787;
if (require.main === module) srv.listen(PORT, () => console.log('dev server http://localhost:' + PORT + '  (צ׳יף 0000 · רופא/ה 1001…1018)'));
module.exports = { srv, mem };
