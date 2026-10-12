/**
 * POST /api/cron — תזכורת אוטומטית לפני המועד האחרון לאילוצים (lib/api.js tick). הטריגר בא מבחוץ:
 * cron-job.org (או כל מתזמן) פעם ביום, בבוקר, עם הכותרת Authorization.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<האתר>/api/cron
 *
 * בלי CRON_SECRET בסביבה — התכונה כבויה (404), לא פתוחה.
 */
const auth = require('../lib/auth');
const api = require('../lib/api');

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.status(405).json({ error: 'POST only' }); return }
  const want = String(process.env.CRON_SECRET || '').trim();
  if (!want){ res.status(404).json({ error: 'cron off' }); return }
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!auth.safeEq(got, want)){ res.status(403).json({ error: 'forbidden' }); return }
  try { res.status(200).json(Object.assign({ ok: true }, await api.tick())) }
  catch (e){ console.error('cron', e); res.status(500).json({ error: e.message }) }
};
