// GET /api/me → {role, did, exp} או 401. בשני המקרים: googleClientId — כדי שמסך הכניסה ידע אם להציג את כפתור Google.
const auth = require('../lib/auth');
module.exports = async (req, res) => {
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const s = auth.session(req);
  if (!s){ res.status(401).json({ error: 'לא מחובר', googleClientId }); return }
  res.status(200).json({ role: s.role, did: s.did || '', exp: s.exp, googleClientId });
};
