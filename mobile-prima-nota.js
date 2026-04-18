/* ==========================================================================
   KONTRO - Mobile Prima Nota Fix
   
   Cambia la vista mobile della Prima Nota da "scroll orizzontale ridondante"
   a "un turno alla volta, vista pulita".
   
   Su mobile (<=768px):
   - Clicchi tab Mattina  -> vedi solo colonna Mattina
   - Clicchi tab Pomeriggio -> vedi solo colonna Pomeriggio
   - Clicchi tab Sera -> vedi solo colonna Sera
   - Colonne: piu' larghe, input piu' grandi, piu' leggibili
   - Tab sticky: restano in alto mentre scrolli
   
   Su desktop (>768px): comportamento invariato (tabella completa).
   ========================================================================== */

(function() {
  'use strict';

  // ============ 1. INIETTA GLI STILI CSS ============
  function injectStyles() {
    if (document.getElementById('kontro-mobile-pn-styles')) return;
    const style = document.createElement('style');
    style.id = 'kontro-mobile-pn-styles';
    style.textContent = [
      '@media (max-width: 768px) {',
        // Tab turni sempre visibili in alto
        '.pn-mobile-tabs {',
          'position: sticky; top: 0; z-index: 10;',
          'background: #0d1526;',
          'padding: 10px 0; margin-bottom: 0 !important;',
          'border-bottom: 1px solid rgba(99,130,200,0.15);',
        '}',
        // Niente piu scroll orizzontale
        '.pn-table-wrap { overflow-x: visible !important; }',
        '.pn-table-wrap::after { display: none !important; }',
        // Tabella a tutta larghezza
        '.pn-table { min-width: 100% !important; width: 100% !important; }',

        // Nasconde POM e SER se la classe show non e presente (default = Mattina)
        '.pn-table-wrap:not(.pn-show-m):not(.pn-show-p):not(.pn-show-s) .pn-table th:nth-child(3),',
        '.pn-table-wrap:not(.pn-show-m):not(.pn-show-p):not(.pn-show-s) .pn-table th:nth-child(4),',
        '.pn-table-wrap:not(.pn-show-m):not(.pn-show-p):not(.pn-show-s) .pn-table tr:not(.pn-section-row) td:nth-child(3),',
        '.pn-table-wrap:not(.pn-show-m):not(.pn-show-p):not(.pn-show-s) .pn-table tr:not(.pn-section-row) td:nth-child(4) {',
          'display: none !important;',
        '}',

        // SHOW-M: mostra solo Mattina (nasconde col 3 e 4)
        '.pn-table-wrap.pn-show-m .pn-table th:nth-child(3),',
        '.pn-table-wrap.pn-show-m .pn-table th:nth-child(4),',
        '.pn-table-wrap.pn-show-m .pn-table tr:not(.pn-section-row) td:nth-child(3),',
        '.pn-table-wrap.pn-show-m .pn-table tr:not(.pn-section-row) td:nth-child(4) {',
          'display: none !important;',
        '}',

        // SHOW-P: mostra solo Pomeriggio (nasconde col 2 e 4)
        '.pn-table-wrap.pn-show-p .pn-table th:nth-child(2),',
        '.pn-table-wrap.pn-show-p .pn-table th:nth-child(4),',
        '.pn-table-wrap.pn-show-p .pn-table tr:not(.pn-section-row) td:nth-child(2),',
        '.pn-table-wrap.pn-show-p .pn-table tr:not(.pn-section-row) td:nth-child(4) {',
          'display: none !important;',
        '}',

        // SHOW-S: mostra solo Sera (nasconde col 2 e 3)
        '.pn-table-wrap.pn-show-s .pn-table th:nth-child(2),',
        '.pn-table-wrap.pn-show-s .pn-table th:nth-child(3),',
        '.pn-table-wrap.pn-show-s .pn-table tr:not(.pn-section-row) td:nth-child(2),',
        '.pn-table-wrap.pn-show-s .pn-table tr:not(.pn-section-row) td:nth-child(3) {',
          'display: none !important;',
        '}',

        // Intestazione colonna turno: piu grande e leggibile
        '.pn-table th.th-turno {',
          'width: auto !important;',
          'font-size: 14px !important;',
          'padding: 12px 8px !important;',
          'text-align: center !important;',
        '}',
        // Nascondi il lucchetto nell intestazione su mobile (poco spazio)
        '.pn-table th.th-turno .btn-blocca { display: none !important; }',

        // Input dei valori: piu grandi e leggibili
        '.pn-table td .pn-input {',
          'font-size: 16px !important;',
          'padding: 12px 10px !important;',
          'text-align: right !important;',
          'width: 100% !important;',
          'min-height: 44px !important;',
        '}',

        // Placeholder piu visibile
        '.pn-table td .pn-input::placeholder {',
          'color: rgba(255,255,255,0.2) !important;',
          'font-size: 18px !important;',
        '}',

        // Colonna descrizione
        '.pn-table td.td-desc {',
          'font-size: 13px !important;',
          'padding: 10px 8px !important;',
        '}',

        // Row totali piu visibili
        '.pn-table .td-tot {',
          'font-size: 15px !important;',
          'padding: 12px 10px !important;',
          'text-align: right !important;',
          'font-weight: 700 !important;',
        '}',

      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // ============ 2. SOVRASCRIVE scrollToTurno ============
  function overrideScrollToTurno() {
    window.scrollToTurno = function(turno) {
      const wrap = document.getElementById('pn-table-wrap');
      if (!wrap) return;

      // Aggiorna tab attiva
      document.querySelectorAll('.pn-mobile-tab').forEach(function(t, i) {
        t.classList.toggle('active', ['m','p','s'][i] === turno);
      });

      // Rimuovi vecchie classi show, applica nuova
      wrap.classList.remove('pn-show-m', 'pn-show-p', 'pn-show-s');
      wrap.classList.add('pn-show-' + turno);
    };
  }

  // ============ 3. IMPOSTA DEFAULT = MATTINA ============
  function ensureInitialState() {
    const wrap = document.getElementById('pn-table-wrap');
    if (!wrap) return;
    // Se non c'e' gia' una classe show, imposta Mattina di default
    if (!wrap.classList.contains('pn-show-m') &&
        !wrap.classList.contains('pn-show-p') &&
        !wrap.classList.contains('pn-show-s')) {
      wrap.classList.add('pn-show-m');
      // Attiva anche il tab Mattina visivamente
      const tabs = document.querySelectorAll('.pn-mobile-tab');
      tabs.forEach(function(t, i) {
        t.classList.toggle('active', i === 0);
      });
    }
  }

  function start() {
    injectStyles();
    overrideScrollToTurno();
    // Attende il rendering della Prima Nota, poi setup iniziale
    setTimeout(ensureInitialState, 500);
    // Ricontrolla periodicamente (utile quando l'utente cambia vista)
    setInterval(ensureInitialState, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  console.log('[KontroMobilePN] Mobile Prima Nota fix attivo');
})();
