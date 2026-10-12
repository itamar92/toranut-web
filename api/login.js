// POST /api/login  {code} או {credential}  → cookie חתום {role, did, ck}
//   code       — קוד אישי של רופא/ה (doctors.login_code_hash) או קוד צ׳יף (CHIEF_CODE / settings.chief_code_hash)
//   credential — ID token מ-Google Identity Services; המייל נבדק מול עמודת email בטבלת doctors
const auth = require('../lib/auth');
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.status(405).json({ error: 'POST only' }); return }
  const ip = auth.ipOf(req);
  if (auth.blocked(ip)){ res.status(429).json({ error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' }); return }
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  let t;
  try { t = await db.readAll(['doctors', 'settings']) }
  catch (e){ console.error('login read', e); res.status(500).json({ error: 'לא הצלחתי לקרוא את רשימת הרופאים: ' + e.message }); return }
  const settings = {}; t.settings.forEach(r => { const k = String(r.key || '').trim(); if (k && settings[k] === undefined) settings[k] = r.value });

  let who = null;
  if (body.credential){
    let email;
    try { email = await auth.verifyGoogle(body.credential) }
    catch (e){ res.status(401).json({ error: e.message }); return }
    const d = auth.doctorByEmail(t.doctors, email);
    if (!d){ res.status(403).json({ error: 'המייל ' + email + ' לא רשום ברשימת הרופאים. בקשו מהצ׳יף להוסיף אותו, או היכנסו עם קוד.' }); return }
    who = { role: String(d.role).trim() === 'chief' ? 'chief' : 'doctor', did: String(d.id) };
  } else {
    who = await auth.loginByCode(body.code, t.doctors, settings);
    if (!who){
      auth.fail(ip);
      await new Promise(r => setTimeout(r, 700));      // מאט ניחוש
      res.status(401).json({ error: 'קוד שגוי' }); return;
    }
  }
  auth.ok(ip);
  try {
    auth.setCookie(res, auth.issue(who), parseInt(process.env.SESSION_DAYS || '60', 10) * 86400);
    const d = t.doctors.find(x => String(x.id) === who.did);
    res.status(200).json({ role: who.role, did: who.did, name: d ? String(d.name) : 'צ׳יף' });
  } catch (e) { res.status(500).json({ error: e.message }) }
};
function safeJson(s){ try { return JSON.parse(s) } catch (e) { return {} } }
