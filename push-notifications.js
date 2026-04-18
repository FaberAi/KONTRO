/* ==========================================================================
   KONTRO - Push Notifications Client (con pulsante di test floating)
   
   Inietta automaticamente un pulsante "🔔 Test notifiche" in basso a destra
   quando l'utente e' loggato. Zero comandi da terminale.
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

  // ===== PULSANTE FLOATING =====

  function injectStyles() {
    if (document.getElementById('kontro-push-test-styles')) return;
    const style = document.createElement('style');
    style.id = 'kontro-push-test-styles';
    style.textContent =
      '#kontro-push-test-btn{position:fixed;bottom:20px;right:20px;z-index:99998;' +
      'background:linear-gradient(135deg,#2563eb 0%,#3b82f6 100%);color:white;border:none;' +
      'padding:14px 20px;border-radius:100px;font-family:"Syne",-apple-system,sans-serif;' +
      'font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,0.5);' +
      'display:flex;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent;' +
      'transition:transform 0.2s,box-shadow 0.2s}' +
      '#kontro-push-test-btn:active{transform:scale(0.96);box-shadow:0 4px 12px rgba(37,99,235,0.4)}' +
      '#kontro-push-test-btn .ic{font-size:18px}' +
      '#kontro-push-test-status{position:fixed;bottom:84px;right:20px;z-index:99997;' +
      'background:#0d1526;color:white;padding:12px 16px;border-radius:12px;' +
      'font-family:-apple-system,sans-serif;font-size:13px;line-height:1.4;max-width:280px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.4);border:1px solid rgba(99,130,200,0.25);' +
      'opacity:0;transform:translateY(10px);transition:opacity 0.3s,transform 0.3s;' +
      'pointer-events:none}' +
      '#kontro-push-test-status.show{opacity:1;transform:translateY(0)}';
    document.head.appendChild(style);
  }

  function showStatus(message, type) {
    let status = document.getElementById('kontro-push-test-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'kontro-push-test-status';
      document.body.appendChild(status);
    }
    const color = type === 'error' ? '#f87171' : (type === 'success' ? '#4ade80' : '#60a5fa');
    const icon = type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️');
    status.innerHTML = '<span style="color:' + color + ';font-weight:700">' + icon + '</span> ' + message;
    status.classList.add('show');
    clearTimeout(status._timer);
    status._timer = setTimeout(function() { status.classList.remove('show'); }, 7000);
  }

  async function handleClick() {
    const btn = document.getElementById('kontro-push-test-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="ic">⏳</span> Attendere...';

    try {
      const already = await isSubscribed();
      if (!already) {
        showStatus('Chiedo il permesso...', 'info');
        const r = await subscribe();
        if (!r.success) {
          showStatus('Errore: ' + r.reason, 'error');
          return;
        }
        showStatus('Dispositivo registrato! Invio test...', 'info');
      } else {
        showStatus('Gia registrato. Invio test...', 'info');
      }
      const t = await sendTest();
      if (t.success && t.sent > 0) {
        showStatus('Notifica inviata! Controlla il telefono.', 'success');
      } else if (t.success && t.sent === 0) {
        showStatus('Nessun device nel database. Retry.', 'error');
      } else {
        showStatus('Errore: ' + (t.reason || 'sconosciuto'), 'error');
      }
    } catch (err) {
      showStatus('Errore: ' + err.message, 'error');
    } finally {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  }

  function injectButton() {
    if (document.getElementById('kontro-push-test-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'kontro-push-test-btn';
    btn.innerHTML = '<span class="ic">🔔</span> Test notifiche';
    btn.addEventListener('click', handleClick);
    document.body.appendChild(btn);
  }

  function removeButton() {
    const btn = document.getElementById('kontro-push-test-btn');
    if (btn) btn.remove();
    const status = document.getElementById('kontro-push-test-status');
    if (status) status.remove();
  }

  async function checkAndShow() {
    try {
      if (typeof db === 'undefined' || !db.auth) return;
      const { data } = await db.auth.getUser();
      if (data && data.user) {
        injectStyles();
        injectButton();
      } else {
        removeButton();
      }
    } catch (err) { /* ignora */ }
  }

  function start() {
    checkAndShow();
    setInterval(checkAndShow, 2000);
  }

  window.KontroPush = {
    isSupported: isSupported,
    isSubscribed: isSubscribed,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    sendTest: sendTest
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  console.log('[KontroPush] Pronto con pulsante test');
})();
