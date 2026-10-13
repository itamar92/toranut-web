// Service Worker (מ-Platoon-web) — המעטפת (HTML, מנוע הכללים, אייקונים, manifest) נשמרת במכשיר ונפתחת גם בלי קליטה.
// ניווט הולך קודם לרשת (עד NAV_TIMEOUT), כדי שפריסה חדשה תופיע כבר בפתיחה הראשונה; בלי רשת — המעטפת השמורה.
// /api/* לא נכנס למטמון לעולם: ה-snapshot נשמר ב-localStorage ע"י האפליקציה, והיא בודקת גרסה מול השרת ב-poll.
// בכל פריסה מעלים את CACHE — הדפדפן מוריד מעטפת חדשה ברקע ומודיע לאפליקציה.
var CACHE = 'tr-shell-v3';
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

/* ---------- התראות לטלפון (Web Push, מ-Platoon-web בלי כפתור "בדרך") ----------
 * השרת שולח {title, body, url, tag?} — payloadOf ב-lib/push.js. כל push חייב להציג התראה:
 * Safari מבטל את המנוי לאתר ששולח push שקט. url — הטאב והחודש שהלחיצה פותחת (?tab=…&m=…). */
self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {} } catch (x){ d = { title: e.data ? e.data.text() : '' } }
  var o = { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', dir: 'rtl', lang: 'he', data: { url: d.url || '/' } };
  if (d.tag){ o.tag = d.tag; o.renotify = true }
  e.waitUntil(self.registration.showNotification(d.title || 'תורנויות רופאים', o));
});

self.addEventListener('notificationclick', function(e){
  var n = e.notification, d = n.data || {};
  n.close();
  e.waitUntil(openApp(d.url || '/'));
});

// האפליקציה כבר פתוחה — מביאים אותה קדימה ומעבירים לה את הקישור, בלי טעינה מחדש. אחרת — פותחים אותה עליו.
function openApp(url){
  var to = new URL(url, self.location.origin);
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
    var c = list.filter(function(w){ return new URL(w.url).origin === to.origin })[0];
    if (!c) return self.clients.openWindow(to.href);
    return c.focus().then(function(w){ (w || c).postMessage({ type: 'push-open', url: to.pathname + to.search }) })
      .catch(function(){ return self.clients.openWindow(to.href) });
  });
}
