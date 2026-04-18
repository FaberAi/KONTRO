/* ==========================================================================
   KONTRO - Push Notifications Client (versione produzione)
   
   Questo file espone 5 funzioni tramite window.KontroPush:
   - isSupported(), isSubscribed(), subscribe(), unsubscribe(), sendTest()
   
   Nessun pulsante automatico: la subscribe() verra' chiamata da altri
   punti dell'applicazione (es. dopo la chiusura serale).
   
   Come usarlo dal codice:
     const result = await window.KontroPush.subscribe();
     if (result.success) { ... ha dato permesso ... }
   ========================================================================== */

(function() {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BK89Vw-A29wVihrCg9uJdJmAG4bHielqtSBeCc7F2M8vb-aIegI7VavzeCzpDY1kKrNeBXsmBHUUiB_JgNDnOh4';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function getCurrentUser() {
    if (typeof db === 'undefined' || !db.auth) throw new Error('Supabase client non trovato');
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    if (!data || !data.user) throw new Error('Nessun utente loggato');
    return data.user;
  }

  async function getCurrentBusinessId() {
    try {
      const user = await getCurrentUser();
      const { data } = await db.from('user_roles')
        .select('business_id').eq('user_id', user.id).limit(1).single();
      return data ? data.business_id : null;
    } catch (err) { return null; }
  }

  function isSupported() {
    if (!('serviceWorker' in navigator)) return false;
    if (!('PushManager' in window)) return false;
    if (!('Notification' in window)) return false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      const standalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (!standalone) return false;
    }
    return true;
  }

  async function subscribe() {
    try {
      if (!isSupported()) {
        return { success: false, reason: 'Su iPhone devi prima installare KONTRO come app (Condividi > Aggiungi a Home).' };
      }
      const user = await getCurrentUser();
      const registration = await navigator.serviceWorker.ready;

      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return { success: false, reason: 'Permesso notifiche non concesso' };
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

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
      if (!response.ok) return { success: false, reason: result.error };
      return { success: true, subscriptionId: result.subscriptionId };
    } catch (err) {
      console.error('[KontroPush] subscribe error:', err);
      return { success: false, reason: err.message };
    }
  }

  async function unsubscribe() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      return { success: true };
    } catch (err) { return { success: false, reason: err.message }; }
  }

  async function isSubscribed() {
    try {
      if (!isSupported()) return false;
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      return !!sub;
    } catch (err) { return false; }
  }

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
            tag: 'kontro-test'
          }
        })
      });
      const result = await response.json();
      if (!response.ok) return { success: false, reason: result.error };
      return result;
    } catch (err) { return { success: false, reason: err.message }; }
  }

  // Espone API
  window.KontroPush = {
    isSupported: isSupported,
    isSubscribed: isSubscribed,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    sendTest: sendTest
  };

  console.log('[KontroPush] Modulo caricato (modalita produzione)');
})();
