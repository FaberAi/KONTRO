/* ==========================================================================
   KONTRO - Service Worker v2
   
   Cosa fa questo file:
   1. CACHE (come prima): pre-caching file statici, esclude Supabase/API/Stripe
   2. PUSH NOTIFICATIONS (nuovo): riceve e mostra le notifiche push
   3. NOTIFICATION CLICK (nuovo): gestisce il click sulla notifica
   
   Come aggiornare KONTRO dopo un deploy:
   Se modifichi app.js, style.css, index.html o questo file:
     -> cambia CACHE_VERSION qui sotto (da 'kontro-v2' a 'kontro-v3', ecc.)
     -> push su GitHub -> Vercel deploy
     -> al prossimo avvio gli utenti vedono la versione nuova
   ========================================================================== */

const CACHE_VERSION = 'kontro-v2';

// File "fondamentali" pre-cachati al primo avvio dell'app
const CORE_FILES = [
  '/app',
  '/index.html',
  '/landing',
  '/landing.html',
  '/style.css',
  '/app.js',
  '/config.js',
  '/pwa-install.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png'
];

// ==========================================================================
// EVENTO 1: INSTALLAZIONE
// ==========================================================================
self.addEventListener('install', (event) => {
  console.log('[SW KONTRO] Installazione versione:', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW KONTRO] Pre-caching file fondamentali');
      return Promise.all(
        CORE_FILES.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW KONTRO] File non precachato:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ==========================================================================
// EVENTO 2: ATTIVAZIONE (pulisce le vecchie cache)
// ==========================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW KONTRO] Attivazione versione:', CACHE_VERSION);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('kontro-') && name !== CACHE_VERSION)
          .map((oldCache) => {
            console.log('[SW KONTRO] Elimino vecchia cache:', oldCache);
            return caches.delete(oldCache);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ==========================================================================
// EVENTO 3: FETCH - regole di caching per ogni richiesta
// ==========================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // MAI in cache Supabase
  if (url.hostname.endsWith('supabase.co') ||
      url.hostname.endsWith('supabase.io')) {
    return;
  }

  // MAI in cache /api/*
  if (url.pathname.startsWith('/api/')) return;

  // MAI in cache Stripe
  if (url.hostname.endsWith('stripe.com') ||
      url.hostname.endsWith('stripe.network')) {
    return;
  }

  // MAI in cache Google Analytics
  if (url.hostname.includes('google-analytics.com') ||
      url.hostname.includes('googletagmanager.com') ||
      url.hostname.includes('doubleclick.net')) {
    return;
  }

  // MAI in cache i PDF generati
  if (url.pathname.endsWith('.pdf')) return;

  // Google Fonts: cache-first
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Solo stesso dominio
  if (url.origin !== self.location.origin) return;

  // HTML pages: network-first
  const acceptHeader = request.headers.get('accept') || '';
  const isHTML = acceptHeader.includes('text/html');

  if (isHTML) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ==========================================================================
// EVENTO 4: PUSH - arriva una notifica dal server
// ==========================================================================
self.addEventListener('push', (event) => {
  console.log('[SW KONTRO] Ricevuta push notification');

  // Decodifica il payload (testo JSON mandato dal nostro server)
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // Se non è JSON, tratta come testo semplice
    data = { title: 'KONTRO', body: event.data ? event.data.text() : 'Nuova notifica' };
  }

  // Valori di default (se il server non manda qualcosa)
  const title = data.title || 'KONTRO';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    image: data.image, // immagine grande (opzionale)
    tag: data.tag || 'kontro-notification', // se arriva un'altra con stesso tag, sostituisce
    data: {
      url: data.url || '/app', // dove andare quando clicchi la notifica
      ...data.data
    },
    actions: data.actions || [], // es. [{ action: 'view', title: 'Vedi' }]
    requireInteraction: data.requireInteraction || false, // se true, resta finché l'utente non la tocca
    vibrate: data.vibrate || [100, 50, 100] // pattern vibrazione Android
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ==========================================================================
// EVENTO 5: NOTIFICATION CLICK - l'utente tocca la notifica
// ==========================================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW KONTRO] Click su notifica');

  event.notification.close();

  // URL da aprire (preso dai dati della notifica, default /app)
  const targetUrl = (event.notification.data && event.notification.data.url) || '/app';

  // Se l'utente ha cliccato su un'azione specifica (es. "Vedi"), gestiscila
  if (event.action) {
    console.log('[SW KONTRO] Azione cliccata:', event.action);
    // Qui in futuro potremo gestire azioni custom
  }

  // Apri o focalizza la finestra dell'app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Se c'è già una finestra di KONTRO aperta, portala in primo piano
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Altrimenti aprine una nuova
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ==========================================================================
// STRATEGIE DI CACHING (invariate)
// ==========================================================================

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/app') || caches.match('/index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      caches.open(CACHE_VERSION).then((cache) => {
        cache.put(request, response.clone());
      });
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}
