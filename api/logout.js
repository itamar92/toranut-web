const auth = require('../lib/auth');
module.exports = async (req, res) => { auth.clearCookie(res); res.status(200).json({ ok: true }) };
