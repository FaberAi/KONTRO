/* ==========================================================================
   KONTRO - Push Notifications Client
   
   Questo file espone 3 funzioni tramite window.KontroPush:
   
   1) window.KontroPush.isSupported()
      -> Ritorna true/false se il browser supporta le notifiche push.
      -> iPhone: true solo se l'app e' installata come PWA (Add to Home).
   
   2) window.KontroPush.subscribe()
      -> Chiede il permesso al browser e registra il device in Supabase.
      -> Ritorna: { success: true/false, reason?: string }
      -> Da chiamare DOPO che l'utente ha visto valore (es. chiusura serale).
   
   3) window.KontroPush.sendTest()
      -> Invia una notifica di test a se stessi (serve il subscribe prima).
      -> Ritorna: { success, sent, failed } dal server.
   
   REQUISITI:
   - In config.js deve essere definita const db = window.supabase.createClient(...)
   - L'utente deve essere loggato (db.auth.getUser() deve tornare un user)
   
   SETUP:
   - La VAPID_PUBLIC_KEY qui sotto va sostituita con la TUA VAPID public key.
   - L'ho pre-compilata come placeholder - CAMBIARLA prima del deploy!
   ========================================================================== */

(function() {
  'use strict';

  // =========================================================================
  // CONFIGURAZIONE - SOSTITUIRE CON LA PROPRIA VAPID PUBLIC KEY
  // =========================================================================
  // Questa e' la chiave PUBBLICA (si vede nel codice - e' ok che sia pubblica)
  // La chiave PRIVATA resta solo su Vercel come env variable.
  //
  // INCOLLA QUI LA TUA VAPID PUBLIC KEY (quella lunga che inizia con "B..."):
  const VAPID_PUBLIC_KEY = 'BK89Vw-A29wVihrCg9uJdJmAG4bHielqtSBeCc7F2M8vb-aIegI7VavzeCzpDY1kKrNeBXsmBHUUiB_JgNDnOh4';
  // =========================================================================

  // Converte la chiave da stringa base64 a Uint8Array (formato richiesto dal browser)
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Recupera l'utente corrente da Supabase
  async function getCurrentUser() {
    if (typeof db === 'undefined' || !db.auth) {
      throw new Error('Supabase client (db) non trovato - verificare config.js');
    }
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    if (!data || !data.user) throw new Error('Nessun utente loggato');
    return data.user;
  }

  // Recupera il business_id dell'utente corrente (opzionale)
  async function getCurrentBusinessId() {
    try {
      const user = await getCurrentUser();
      const { data } = await db
        .from('user_roles')
        .select('business_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      return data ? data.business_id : null;
    } catch (err) {
      return null;
    }
  }

  // =========================================================================
  // isSupported() - verifica supporto del browser
  // =========================================================================
  function isSupported() {
    if (!('serviceWorker' in navigator)) return false;
    if (!('PushManager' in window)) return false;
    if (!('Notification' in window)) return false;

    // iOS Safari: supporta push solo se l'app e' installata come PWA
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      const isStandalone =
        window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (!isStandalone) {
        console.log('[KontroPush] iOS rileva: app non installata, push non disponibili');
        return false;
      }
    }
    return true;
  }

  // =========================================================================
  // subscribe() - chiede permesso e registra il device
  // =========================================================================
  async function subscribe() {
    try {
      // Check 1: supporto browser
      if (!isSupported()) {
        return {
          success: false,
          reason: 'Browser/device non supportato. Su iPhone devi prima installare KONTRO come app (Condividi > Aggiungi a Home).'
        };
      }

      // Check 2: VAPID key configurata
      if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.indexOf('INSERISCI') === 0) {
        return {
          success: false,
          reason: 'VAPID_PUBLIC_KEY non configurata in push-notifications.js'
        };
      }

      // Check 3: utente loggato
      const user = await getCurrentUser();

      // Step 1: service worker registration
      const registration = await navigator.serviceWorker.ready;
      if (!registration) {
        return { success: false, reason: 'Service Worker non attivo' };
      }

      // Step 2: chiedi permesso (browser mostra il popup nativo)
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') {
        return {
          success: false,
          reason: 'Permesso notifiche negato. Puoi riattivarlo nelle impostazioni del browser.'
        };
      }

      // Step 3: crea la subscription (o recupera se gia' esiste)
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      // Step 4: salva la subscription sul nostro server
      const businessId = await getCurrentBusinessId();
      const response = await fetch('/api/save-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId: user.id,
          businessId: businessId,
          userAgent: navigator.userAgent
        })
      });

      const result = await response.json();
      if (!response.ok) {
        return { success: false, reason: result.error || 'Errore salvataggio subscription' };
      }

      console.log('[KontroPush] Subscription salvata:', result.subscriptionId);
      return { success: true, subscriptionId: result.subscriptionId };

    } catch (err) {
      console.error('[KontroPush] Errore subscribe:', err);
      return { success: false, reason: err.message };
    }
  }

  // =========================================================================
  // unsubscribe() - disattiva le notifiche per questo device
  // =========================================================================
  async function unsubscribe() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
      return { success: true };
    } catch (err) {
      console.error('[KontroPush] Errore unsubscribe:', err);
      return { success: false, reason: err.message };
    }
  }

  // =========================================================================
  // isSubscribed() - verifica se questo device e' gia' iscritto
  // =========================================================================
  async function isSubscribed() {
    try {
      if (!isSupported()) return false;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return !!subscription;
    } catch (err) {
      return false;
    }
  }

  // =========================================================================
  // sendTest() - invia una notifica di test a se stessi
  // =========================================================================
  async function sendTest() {
    try {
      const user = await getCurrentUser();

      const response = await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: [user.id],
          notification: {
            title: '🎉 Test KONTRO!',
            body: 'Le notifiche push funzionano. Sei pronto!',
            url: '/app',
            tag: 'kontro-test',
            requireInteraction: false
          }
        })
      });

      const result = await response.json();
      if (!response.ok) {
        return { success: false, reason: result.error };
      }
      return result;

    } catch (err) {
      console.error('[KontroPush] Errore sendTest:', err);
      return { success: false, reason: err.message };
    }
  }

  // =========================================================================
  // Espone le funzioni sull'oggetto window.KontroPush
  // =========================================================================
  window.KontroPush = {
    isSupported: isSupported,
    isSubscribed: isSubscribed,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    sendTest: sendTest
  };

  console.log('[KontroPush] Modulo caricato');
})();
