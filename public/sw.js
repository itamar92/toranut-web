// Service Worker (מ-Platoon-web) — המעטפת (HTML, מנוע הכללים, אייקונים, manifest) נשמרת במכשיר ונפתחת גם בלי קליטה.
// ניווט הולך קודם לרשת (עד NAV_TIMEOUT), כדי שפריסה חדשה תופיע כבר בפתיחה הראשונה; בלי רשת — המעטפת השמורה.
// /api/* לא נכנס למטמון לעולם: ה-snapshot נשמר ב-localStorage ע"י האפליקציה, והיא בודקת גרסה מול השרת ב-poll.
// בכל פריסה מעלים את CACHE — הדפדפן מוריד מעטפת חדשה ברקע ומודיע לאפליקציה.
var CACHE = 'tr-shell-v1';
var SHELL = ['/', '/rules.js', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
var NAV_TIMEOUT = 3500;                // קליטה גרועה — לא מחכים לרשת יותר מזה, פותחים מהמטמון
var FRESH = '/__shell-fresh';          // סימן: הניווט האחרון הגיע מהרשת. הדף בודק אותו לפני שהוא מציע "יש גרסה חדשה"

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL) }).then(function(){ return self.skipWaiting() }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE }).map(function(k){ return caches.delete(k) }));
  }).then(function(){ return self.clients.claim() }));
});

self.addEventListener('fetch', function(e){
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/dev/')) return;
  if (req.mode === 'navigate') return navigate(e, req);
  // שאר הקבצים (rules.js, אייקונים, manifest) — מהמטמון מיד, ומרעננים ברקע לפעם הבאה
  e.respondWith(caches.open(CACHE).then(function(c){
    return c.match(req).then(function(cached){
      var fresh = fetch(req).then(function(res){
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(function(){ return cached });
      return cached || fresh;
    });
  }));
});

// ניווט: רשת קודם. כל ניווט (/, /?x, /index.html) נשמר תחת '/' — אותה מעטפת.
// גם כשה-timeout ניצח, התשובה שמגיעה אחריו נשמרת — הפתיחה הבאה כבר תהיה בגרסה החדשה.
function navigate(e, req){
  var net = fetch(req);
  e.waitUntil(net.then(function(res){
    if (!res.ok) return;
    var copy = res.clone();
    return caches.open(CACHE).then(function(c){ return c.put('/', copy) });
  }).catch(function(){}));
  var late = new Promise(function(ok, fail){ setTimeout(fail, NAV_TIMEOUT) });
  e.respondWith(Promise.race([net, late]).then(function(res){
    if (res.status >= 500) throw res;                                 // השרת נפל — עדיף המעטפת השמורה
    if (!res.ok) return res;
    return caches.open(CACHE).then(function(c){ return c.put(FRESH, new Response('1')) }).then(function(){ return res });
  }).catch(function(){
    return caches.open(CACHE).then(function(c){
      return c.delete(FRESH).then(function(){ return c.match('/') });
    }).then(function(cached){ return cached || net });
  }));
}
