/* ==========================================================================
   KONTRO - Autosave Prima Nota
   
   Salva automaticamente la Prima Nota dopo 3 secondi di pausa
   (debounce: se l'utente continua a digitare, il timer si resetta).
   
   Comportamento:
   - Si attiva SOLO quando la vista Prima Nota e' aperta
   - Si attiva SOLO se l'utente e' loggato (currentBusiness disponibile)
   - Si attiva SOLO se la data e' compilata
   - Chiama la funzione esistente salvaNotaGiorno() senza modificarla
   
   Feedback visivo: un piccolo badge in alto a destra con 4 stati:
   - ✏️ Modifiche non salvate... (utente sta digitando)
   - 💾 Salvataggio... (durante il salvataggio)
   - ✅ Salvato [orario] (dopo successo, si nasconde dopo 3 secondi)
   - ❌ Errore (se il salvataggio fallisce)
   ========================================================================== */

(function() {
  'use strict';

  const DEBOUNCE_MS = 3000;        // 3 secondi di pausa prima di salvare
  const SUCCESS_VISIBLE_MS = 3000; // 3 secondi di visualizzazione "salvato"

  let saveTimer = null;
  let savingNow = false;
  let lastSaveTime = null;

  // ============ INIEZIONE STILI ============
  function injectStyles() {
    if (document.getElementById('kontro-autosave-styles')) return;
    const style = document.createElement('style');
    style.id = 'kontro-autosave-styles';
    style.textContent = [
      '#kontro-autosave-badge {',
        'position: fixed;',
        'top: 16px;',
        'right: 16px;',
        'z-index: 99996;',
        'background: #0d1526;',
        'border: 1px solid rgba(99,130,200,0.25);',
        'color: white;',
        'padding: 8px 14px;',
        'border-radius: 100px;',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
        'font-size: 12px;',
        'font-weight: 600;',
        'display: none;',
        'align-items: center;',
        'gap: 6px;',
        'box-shadow: 0 4px 12px rgba(0,0,0,0.4);',
        'transition: all 0.3s;',
      '}',
      '#kontro-autosave-badge.show { display: inline-flex; }',
      '#kontro-autosave-badge.state-editing {',
        'border-color: rgba(251,191,36,0.4);',
        'color: #fbbf24;',
      '}',
      '#kontro-autosave-badge.state-saving {',
        'border-color: rgba(59,130,246,0.5);',
        'color: #60a5fa;',
      '}',
      '#kontro-autosave-badge.state-saved {',
        'border-color: rgba(52,211,153,0.4);',
        'color: #4ade80;',
      '}',
      '#kontro-autosave-badge.state-error {',
        'border-color: rgba(248,113,113,0.5);',
        'color: #f87171;',
      '}',
      // Su mobile il badge non deve coprire il logo
      '@media (max-width: 768px) {',
        '#kontro-autosave-badge {',
          'top: auto;',
          'bottom: 16px;',
          'right: 16px;',
          'left: 16px;',
          'text-align: center;',
          'justify-content: center;',
          'font-size: 13px;',
        '}',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // ============ BADGE ============
  function getBadge() {
    let badge = document.getElementById('kontro-autosave-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'kontro-autosave-badge';
      document.body.appendChild(badge);
    }
    return badge;
  }

  function setBadge(state, text) {
    const badge = getBadge();
    badge.className = 'show state-' + state;
    badge.innerHTML = text;
  }

  function hideBadge() {
    const badge = document.getElementById('kontro-autosave-badge');
    if (badge) badge.className = '';
  }

  // ============ PRE-CONDIZIONI ============

  function isPrimaNotaActive() {
    const view = document.getElementById('view-primanota');
    if (!view) return false;
    return view.classList.contains('active') || view.offsetParent !== null;
  }

  function canSave() {
    // Utente loggato?
    if (typeof currentBusiness === 'undefined' || !currentBusiness) return false;
    // Data compilata?
    const dataEl = document.getElementById('pn-data');
    if (!dataEl || !dataEl.value) return false;
    // Funzione di salvataggio disponibile?
    if (typeof window.salvaNotaGiorno !== 'function') return false;
    return true;
  }

  // ============ LOGICA SALVATAGGIO ============

  async function performSave() {
    if (savingNow) return;
    if (!canSave()) {
      hideBadge();
      return;
    }

    savingNow = true;
    setBadge('saving', '💾 Salvataggio...');

    try {
      // Chiamiamo la funzione esistente
      await window.salvaNotaGiorno();

      lastSaveTime = new Date();
      const hh = String(lastSaveTime.getHours()).padStart(2, '0');
      const mm = String(lastSaveTime.getMinutes()).padStart(2, '0');
      setBadge('saved', '✅ Salvato ' + hh + ':' + mm);

      // Dopo 3 secondi nascondi il badge
      setTimeout(function() {
        const badge = document.getElementById('kontro-autosave-badge');
        if (badge && badge.classList.contains('state-saved')) {
          hideBadge();
        }
      }, SUCCESS_VISIBLE_MS);

    } catch (err) {
      console.error('[KontroAutosave] Errore:', err);
      setBadge('error', '❌ Errore salvataggio');
    } finally {
      savingNow = false;
    }
  }

  function scheduleAutosave() {
    if (!isPrimaNotaActive()) return;
    if (!canSave()) return;

    // Mostra subito il badge "modifiche"
    setBadge('editing', '✏️ Modifiche non salvate...');

    // Reset del timer precedente (questo e il debounce)
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(performSave, DEBOUNCE_MS);
  }

  // ============ LISTENER INPUT ============

  function attachListeners() {
    const view = document.getElementById('view-primanota');
    if (!view) return;

    // Un solo listener a livello di vista che intercetta tutti gli input
    // (delegation - funziona anche per righe aggiunte dinamicamente)
    view.addEventListener('input', function(e) {
      const target = e.target;
      if (!target) return;
      // Ignora campi non rilevanti
      if (target.id === 'pn-data') return;          // data gia' richiede conferma utente
      if (target.id === 'pn-location') return;      // cambio sede non e una modifica dati
      // Qualsiasi altro input/select/textarea in Prima Nota triggera autosave
      if (target.matches('input, select, textarea')) {
        scheduleAutosave();
      }
    }, true); // capture = intercetta anche prima

    // Intercetta anche i change (per i select)
    view.addEventListener('change', function(e) {
      const target = e.target;
      if (!target) return;
      if (target.id === 'pn-data') return;
      if (target.id === 'pn-location') return;
      if (target.matches('select')) {
        scheduleAutosave();
      }
    }, true);
  }

  // ============ CLEANUP QUANDO SI CAMBIA VISTA ============

  function monitorViewChange() {
    // Ogni 2 secondi verifichiamo se la Prima Nota e' ancora attiva
    setInterval(function() {
      if (!isPrimaNotaActive()) {
        // Se c'e' un salvataggio schedulato, lascialo andare ma nascondi il badge
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
          hideBadge();
        }
      }
    }, 2000);
  }

  function start() {
    injectStyles();
    getBadge();
    // Attende un po' che la Prima Nota sia renderizzata
    setTimeout(function() {
      attachListeners();
      monitorViewChange();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Espone funzione per reset manuale (utile per debug)
  window.KontroAutosave = {
    forceSave: performSave,
    isScheduled: function() { return saveTimer !== null; }
  };

  console.log('[KontroAutosave] Autosave Prima Nota attivo (debounce 3s)');
})();
