/* ==========================================================================
   KONTRO - PWA Install Banner
   
   Banner intelligente che invita l'utente a installare KONTRO come app.
   
   COMPORTAMENTO:
   - Appare dopo 5 secondi sulla pagina
   - Solo su mobile (iOS e Android) - mai su desktop
   - Mai se l'app è gia' installata (modalita' standalone)
   - Ricorda il dismissal per 7 giorni (poi riappare)
   - Android: usa il prompt nativo di Chrome (installazione in 1 tap)
   - iOS: apre un mini-tutorial con le 3 istruzioni per "Aggiungi a Home"
   
   COME USARLO:
   Basta includere questo file in qualsiasi pagina HTML con:
     <script src="/pwa-install.js" defer></script>
   Tutto il resto (HTML del banner, CSS, logica) viene iniettato automaticamente.
   
   COME RESETTARE PER TESTARE:
   In console del browser: localStorage.removeItem('kontro_pwa_install_dismissed')
   Poi ricarica la pagina.
   ========================================================================== */

(function() {
  'use strict';

  // ============ RILEVAMENTI DI BASE ============

  // Se l'app e' gia' installata (modalita' standalone), NON mostrare nulla
  var isStandalone = 
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true ||
    document.referrer.indexOf('android-app://') !== -1;

  if (isStandalone) return;

  // Rilevamento piattaforma
  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isAndroid = /Android/.test(ua);
  var isMobile = isIOS || isAndroid || /Mobi/.test(ua);

  // Non mostrare su desktop
  if (!isMobile) return;

  // Dismissal persistente (7 giorni)
  var DISMISSED_KEY = 'kontro_pwa_install_dismissed';
  var DISMISS_DAYS = 7;

  try {
    var dismissedAt = localStorage.getItem(DISMISSED_KEY);
    if (dismissedAt) {
      var daysSince = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSince < DISMISS_DAYS) return;
    }
  } catch (e) {
    // localStorage bloccato (private browsing) - procediamo comunque
  }

  // ============ EVENTI PWA ============

  // Android: cattura beforeinstallprompt per poterlo lanciare quando clicchiamo "Installa"
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Se l'app viene installata, nascondi tutto
  window.addEventListener('appinstalled', function() {
    hideBanner();
    closeIOSModal();
    try { localStorage.setItem(DISMISSED_KEY, Date.now().toString()); } catch (e) {}
    console.log('[PWA] KONTRO installata con successo');
  });

  // ============ INIEZIONE STILI ============

  function injectStyles() {
    if (document.getElementById('pwa-install-styles')) return;
    var style = document.createElement('style');
    style.id = 'pwa-install-styles';
    style.textContent = [
      '#pwa-install-banner{',
        'position:fixed;bottom:20px;left:50%;',
        'transform:translateX(-50%) translateY(200%);',
        'width:calc(100% - 32px);max-width:460px;',
        'background:#0d1526;',
        'border:1px solid rgba(99,130,200,0.2);',
        'border-radius:14px;',
        'box-shadow:0 10px 40px rgba(0,0,0,0.5),0 0 0 1px rgba(59,130,246,0.15);',
        'display:flex;align-items:center;gap:12px;padding:14px 16px;',
        'z-index:99999;',
        'font-family:"Syne",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
        'transition:transform 0.4s cubic-bezier(0.16,1,0.3,1),opacity 0.3s;',
        'opacity:0;',
      '}',
      '#pwa-install-banner.pwa-show{',
        'transform:translateX(-50%) translateY(0);opacity:1;',
      '}',
      '.pwa-banner-icon{',
        'flex:0 0 auto;width:42px;height:42px;',
        'background:#2563eb;border-radius:10px;',
        'display:flex;align-items:center;justify-content:center;',
        'color:#fff;font-weight:800;font-size:22px;',
        'font-family:"Syne",sans-serif;letter-spacing:0.02em;',
        'box-shadow:0 4px 12px rgba(37,99,235,0.3);',
      '}',
      '.pwa-banner-text{flex:1 1 auto;min-width:0}',
      '.pwa-banner-title{',
        'color:#fff;font-size:14px;font-weight:700;',
        'margin:0 0 2px 0;line-height:1.3;',
      '}',
      '.pwa-banner-subtitle{',
        'color:#94a3b8;font-size:12px;margin:0;line-height:1.4;',
      '}',
      '.pwa-banner-install{',
        'flex:0 0 auto;background:#2563eb;color:#fff;',
        'border:none;padding:8px 14px;border-radius:8px;',
        'font-size:13px;font-weight:700;cursor:pointer;',
        'font-family:inherit;transition:background 0.2s;',
        '-webkit-tap-highlight-color:transparent;',
      '}',
      '.pwa-banner-install:active{background:#1d4ed8}',
      '.pwa-banner-close{',
        'flex:0 0 auto;background:transparent;color:#64748b;',
        'border:none;width:28px;height:28px;border-radius:6px;',
        'font-size:20px;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;',
        'font-family:inherit;line-height:1;',
        'transition:background 0.2s,color 0.2s;',
        '-webkit-tap-highlight-color:transparent;',
      '}',
      '.pwa-banner-close:active{background:rgba(255,255,255,0.08);color:#fff}',
      // Modal iOS
      '#pwa-ios-modal{',
        'position:fixed;inset:0;',
        'background:rgba(0,0,0,0.65);',
        '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);',
        'z-index:100000;display:none;',
        'align-items:flex-end;justify-content:center;',
        'opacity:0;transition:opacity 0.3s;',
      '}',
      '#pwa-ios-modal.pwa-show{opacity:1}',
      '.pwa-ios-content{',
        'background:#0d1526;',
        'border-top-left-radius:20px;border-top-right-radius:20px;',
        'width:100%;max-width:520px;',
        'padding:20px 20px 32px;',
        'transform:translateY(100%);',
        'transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);',
        'box-shadow:0 -10px 40px rgba(0,0,0,0.5);',
      '}',
      '#pwa-ios-modal.pwa-show .pwa-ios-content{transform:translateY(0)}',
      '.pwa-ios-handle{',
        'width:40px;height:4px;background:rgba(255,255,255,0.15);',
        'border-radius:2px;margin:0 auto 16px;',
      '}',
      '.pwa-ios-header{',
        'display:flex;align-items:center;justify-content:space-between;',
        'margin-bottom:18px;',
      '}',
      '.pwa-ios-title{',
        'color:#fff;font-size:18px;font-weight:800;',
        'font-family:"Syne",sans-serif;letter-spacing:0.04em;',
      '}',
      '.pwa-ios-step{',
        'display:flex;gap:14px;align-items:center;',
        'padding:14px;background:rgba(99,130,200,0.08);',
        'border:1px solid rgba(99,130,200,0.15);',
        'border-radius:12px;margin-bottom:10px;',
      '}',
      '.pwa-ios-step-num{',
        'flex:0 0 auto;width:32px;height:32px;',
        'background:#2563eb;color:#fff;border-radius:50%;',
        'display:flex;align-items:center;justify-content:center;',
        'font-weight:800;font-size:14px;font-family:"Syne",sans-serif;',
      '}',
      '.pwa-ios-step-text{',
        'color:#cbd5e1;font-size:14px;line-height:1.5;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '}',
      '.pwa-ios-step-text strong{color:#fff}',
      '.pwa-ios-share{',
        'display:inline-flex;align-items:center;justify-content:center;',
        'width:22px;height:22px;background:rgba(59,130,246,0.18);',
        'border-radius:5px;vertical-align:-6px;',
        'color:#60a5fa;font-size:14px;margin:0 2px;',
      '}',
      // Responsive
      '@media (max-width:360px){',
        '.pwa-banner-subtitle{display:none}',
        '#pwa-install-banner{padding:12px 14px;gap:10px}',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // ============ INIEZIONE HTML ============

  function injectBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML =
      '<div class="pwa-banner-icon">K</div>' +
      '<div class="pwa-banner-text">' +
        '<div class="pwa-banner-title">Installa KONTRO come app</div>' +
        '<div class="pwa-banner-subtitle">Accesso rapido dalla Home del tuo telefono</div>' +
      '</div>' +
      '<button class="pwa-banner-install" id="pwa-banner-install-btn" type="button">Installa</button>' +
      '<button class="pwa-banner-close" id="pwa-banner-close-btn" type="button" aria-label="Chiudi">&times;</button>';
    document.body.appendChild(banner);
  }

  function injectIOSModal() {
    if (document.getElementById('pwa-ios-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'pwa-ios-modal';
    modal.innerHTML =
      '<div class="pwa-ios-content">' +
        '<div class="pwa-ios-handle"></div>' +
        '<div class="pwa-ios-header">' +
          '<div class="pwa-ios-title">Installa KONTRO</div>' +
          '<button class="pwa-banner-close" id="pwa-ios-close-btn" type="button" aria-label="Chiudi">&times;</button>' +
        '</div>' +
        '<div class="pwa-ios-step">' +
          '<div class="pwa-ios-step-num">1</div>' +
          '<div class="pwa-ios-step-text">Tocca il pulsante <strong>Condividi</strong> <span class="pwa-ios-share">&#x2B06;</span> in basso al centro</div>' +
        '</div>' +
        '<div class="pwa-ios-step">' +
          '<div class="pwa-ios-step-num">2</div>' +
          '<div class="pwa-ios-step-text">Scorri e tocca <strong>"Aggiungi a Home"</strong></div>' +
        '</div>' +
        '<div class="pwa-ios-step">' +
          '<div class="pwa-ios-step-num">3</div>' +
          '<div class="pwa-ios-step-text">Conferma toccando <strong>"Aggiungi"</strong> in alto a destra</div>' +
        '</div>' +
      '</div>';
    // Click sullo sfondo (non sul contenuto) = chiudi
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeIOSModal();
    });
    document.body.appendChild(modal);
  }

  // ============ LOGICA SHOW/HIDE ============

  function showBanner() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) setTimeout(function() { banner.classList.add('pwa-show'); }, 20);
  }

  function hideBanner() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.classList.remove('pwa-show');
      setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 400);
    }
  }

  function dismissBanner() {
    hideBanner();
    try { localStorage.setItem(DISMISSED_KEY, Date.now().toString()); } catch (e) {}
  }

  function showIOSModal() {
    var modal = document.getElementById('pwa-ios-modal');
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(function() { modal.classList.add('pwa-show'); }, 20);
    }
  }

  function closeIOSModal() {
    var modal = document.getElementById('pwa-ios-modal');
    if (modal) {
      modal.classList.remove('pwa-show');
      setTimeout(function() { modal.style.display = 'none'; }, 300);
    }
  }

  function handleInstallClick() {
    if (isIOS) {
      // iOS: Apple non consente install automatico, mostro istruzioni
      showIOSModal();
    } else if (deferredPrompt) {
      // Android: uso il prompt nativo di Chrome
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(choice) {
        console.log('[PWA] Esito installazione:', choice.outcome);
        deferredPrompt = null;
        hideBanner();
        if (choice.outcome !== 'accepted') {
          try { localStorage.setItem(DISMISSED_KEY, Date.now().toString()); } catch (e) {}
        }
      });
    } else {
      // Android senza prompt pronto (Chrome non ha ancora deciso che sei idoneo)
      alert('Tocca i 3 puntini del menu di Chrome in alto a destra, poi "Installa app".');
      dismissBanner();
    }
  }

  // ============ INIZIALIZZAZIONE ============

  function init() {
    injectStyles();
    injectBanner();
    injectIOSModal();

    var installBtn = document.getElementById('pwa-banner-install-btn');
    var closeBtn = document.getElementById('pwa-banner-close-btn');
    var iosCloseBtn = document.getElementById('pwa-ios-close-btn');

    if (installBtn) installBtn.addEventListener('click', handleInstallClick);
    if (closeBtn) closeBtn.addEventListener('click', dismissBanner);
    if (iosCloseBtn) iosCloseBtn.addEventListener('click', closeIOSModal);

    // Mostra il banner dopo 5 secondi
    setTimeout(showBanner, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
