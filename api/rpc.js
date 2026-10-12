// POST /api/rpc  {fn, args, snap}  — פונקציה מ-lib/api.js FNS, לפי התפקיד שב-cookie.
// snap=true — מחזיר גם snapshot מעודכן אחרי הפעולה, כדי שהממשק לא יצטרך בקשה שנייה.
const auth = require('../lib/auth');
const { FNS, snapshot } = require('../lib/api');

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.status(405).json({ error: 'POST only' }); return }
  const s = auth.session(req);
  if (!s){ res.status(401).json({ error: 'לא מחובר' }); return }
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const fn = String(body.fn || ''), args = Array.isArray(body.args) ? body.args : [];
  const spec = Object.prototype.hasOwnProperty.call(FNS, fn) ? FNS[fn] : null;
  if (!spec){ res.status(404).json({ error: 'פונקציה לא מוכרת: ' + fn }); return }
  if (!auth.atLeast(s.role, spec[1])){ res.status(403).json({ error: 'הפעולה הזו רק לצ׳יף' }); return }
  const env = { role: s.role, did: s.did || '', ck: s.ck || '' };
  try {
    const out = await spec[0](env, ...args);
    const snap = body.snap && fn !== 'snapshot' ? await snapshot({ role: s.role, did: s.did || '', ck: s.ck || '' }) : undefined;
    res.status(200).json({ ok: true, result: out === undefined ? null : out, snap });
  } catch (e) {
    const status = e && (e.status === 401 || e.status === 403) ? e.status : 400;
    if (status === 401) auth.clearCookie(res);
    if (status === 400 && !(e && e.user)) console.error('rpc', fn, e); else console.warn('rpc', fn, s.role, e.message);
    res.status(status).json({ error: (e && e.message) || String(e) });
  }
};
function safeJson(s){ try { return JSON.parse(s) } catch (e) { return {} } }
