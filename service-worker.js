/* ==========================================================================
   KONTRO - Service Worker
   
   Cosa fa questo file:
   - Mette in cache automaticamente i file statici di KONTRO (HTML, CSS, JS, icone)
   - NON mette mai in cache le chiamate a Supabase (i dati restano sempre live)
   - NON mette mai in cache le chiamate a /api/ (le tue funzioni serverless)
   - Gestisce gli aggiornamenti: quando cambi CACHE_VERSION, la vecchia cache
     viene cancellata e il telefono scarica la versione nuova
   
   Come aggiornare l'app dopo un deploy:
   - Cambia CACHE_VERSION (es. da 'kontro-v1' a 'kontro-v2')
   - Push su GitHub -> Vercel fa deploy -> al prossimo avvio gli utenti
     vedono automaticamente la versione aggiornata
   ========================================================================== */

// IMPORTANTE: cambia questo numero ogni volta che fai un deploy con modifiche
// importanti (es. 'kontro-v2', 'kontro-v3', ecc.) per forzare l'aggiornamento
const CACHE_VERSION = 'kontro-v1';

// File "fondamentali" che vengono scaricati subito alla prima installazione
// Sono i file che devono esserci anche se l'utente va offline la prima volta
const CORE_FILES = [
  '/',
  '/index.html',
  '/landing.html',
  '/style.css',
  '/app.js',
  '/config.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// ==========================================================================
// EVENTO 1: INSTALLAZIONE
// Parte la PRIMA volta che il service worker viene registrato sul telefono
// ==========================================================================
self.addEventListener('install', (event) => {
  console.log('[SW KONTRO] Installazione versione:', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW KONTRO] Pre-caching dei file fondamentali');
      return cache.addAll(CORE_FILES);
    }).then(() => {
      // skipWaiting = attiva subito la nuova versione senza aspettare
      return self.skipWaiting();
    })
  );
});

// ==========================================================================
// EVENTO 2: ATTIVAZIONE
// Parte quando il service worker diventa attivo - qui puliamo le vecchie cache
// ==========================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW KONTRO] Attivazione versione:', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('kontro-') && name !== CACHE_VERSION)
          .map((oldCache) => {
            console.log('[SW KONTRO] Cancello vecchia cache:', oldCache);
            return caches.delete(oldCache);
          })
      );
    }).then(() => {
      // Prende subito il controllo di tutte le pagine aperte
      return self.clients.claim();
    })
  );
});

// ==========================================================================
// EVENTO 3: FETCH (richieste di rete)
// Parte ogni volta che il browser chiede un file (HTML, CSS, JS, API, ecc.)
// ==========================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // --------- REGOLA 1: Solo richieste GET ---------
  // POST/PUT/DELETE non vanno mai in cache (sono scritture su DB)
  if (request.method !== 'GET') {
    return;
  }
  
  // --------- REGOLA 2: Mai in cache Supabase ---------
  // I dati del database devono essere sempre freschi e live
  if (url.hostname.includes('supabase.co')) {
    return; // il browser gestisce normalmente
  }
  
  // --------- REGOLA 3: Mai in cache le funzioni serverless ---------
  // Le chiamate a /api/* sono verso le tue Vercel Functions (es. Stripe)
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  
  // --------- REGOLA 4: Mai in cache Stripe e servizi esterni ---------
  if (url.hostname.includes('stripe.com') || 
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google-analytics.com')) {
    return;
  }
  
  // --------- REGOLA 5: Solo stesso dominio ---------
  // Non mettiamo in cache risorse di altri siti (es. CDN esterne non nostre)
  if (url.origin !== self.location.origin) {
    return;
  }
  
  // --------- STRATEGIA CACHE per tutto il resto ---------
  // Per le pagine HTML: NETWORK FIRST
  //   (prima prova internet, se non c'è usa cache)
  //   Così gli aggiornamenti sono subito visibili
  //
  // Per CSS/JS/immagini: CACHE FIRST con aggiornamento in background
  //   (prima usa cache per velocità, intanto aggiorna per la prossima volta)
  
  const isHTML = request.headers.get('accept')?.includes('text/html');
  
  if (isHTML) {
    // Strategia NETWORK FIRST per pagine HTML
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Se riceviamo una risposta valida, salvala in cache
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Se internet non va, usa la versione in cache
          return caches.match(request).then((cached) => {
            return cached || caches.match('/index.html');
          });
        })
    );
  } else {
    // Strategia CACHE FIRST per CSS/JS/immagini
    event.respondWith(
      caches.match(request).then((cached) => {
        // Se in cache, usala subito
        if (cached) {
          // Nel frattempo aggiorna in background per la prossima volta
          fetch(request).then((response) => {
            if (response && response.status === 200) {
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {}); // ignora errori silenziosamente
          
          return cached;
        }
        
        // Se non in cache, scarica e salva
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
  }
});
