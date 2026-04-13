// ── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://eqkvagnfmsxvbwlvhvbk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxa3ZhZ25mbXN4dmJ3bHZodmJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDAxMTksImV4cCI6MjA5MDcxNjExOX0.AFkpaBPeWnqaEcq5Hxhq9dh7PqgPdm1IABZLpm6n-Wo';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentUser = null, currentProfilo = null, currentLocale = 'loveme_bar';
let fornitoriCache = [], bancheCache = [];
let righeFornitoriM = [], righeFornitoriT = [], righeDescFornitori = [];
let righePreleviM   = [], righePreleviT   = [], righeDescPrelievi  = [];

const LOCALE_LABEL = { loveme_bar: 'Love Me Bar', loveme_corso: 'Café del Corso' };

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { currentUser = session.user; await avviaApp(); }
  else showScreen('login');
});

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!email || !pwd) { errEl.textContent = 'Inserisci email e password'; errEl.style.display = 'block'; return; }
  const btn = document.querySelector('#screen-login .btn-primary');
  btn.textContent = 'Accesso in corso...'; btn.disabled = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
    if (error) throw error;
    currentUser = data.user;
    await avviaApp();
  } catch(e) {
    errEl.textContent = 'Email o password non corretti'; errEl.style.display = 'block';
    btn.textContent = 'Accedi'; btn.disabled = false;
  }
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentProfilo = null;
  showScreen('login');
  const btn = document.querySelector('#screen-login .btn-primary');
  if (btn) { btn.textContent = 'Accedi'; btn.disabled = false; }
}

async function avviaApp() {
  await loadProfilo();
  await Promise.all([caricaFornitoriCache(), caricaBancheCache()]);
  showApp();
}

async function loadProfilo() {
  const { data } = await sb.from('pn_utenti').select('*').eq('email', currentUser.email).single();
  currentProfilo = data;
  if (data?.locale) currentLocale = data.locale;
}

// ── CACHE ─────────────────────────────────────────────────────────────────────
async function caricaFornitoriCache() {
  const { data } = await sb.from('pn_fornitori').select('id,ragione_sociale').eq('attivo', true).order('ragione_sociale');
  fornitoriCache = data || [];
}
async function caricaBancheCache() {
  const { data } = await sb.from('pn_banche').select('id,nome,istituto,tipo,saldo_iniziale').eq('attivo', true).order('nome');
  bancheCache = data || [];
}
function bancaOptsHtml() {
  return '<option value="">— banca —</option>' + bancheCache.map(b => `<option value="${b.id}">${b.nome}</option>`).join('');
}
function fornitorOptsHtml() {
  return '<option value="">— descrizione libera —</option>' + fornitoriCache.map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');
}
function refreshFornitoriInTabella() {
  document.querySelectorAll('.sel-fornitore').forEach(sel => {
    const val = sel.value;
    sel.innerHTML = fornitorOptsHtml();
    if (val) sel.value = val;
  });
}

// ── SCREEN / PAGE ─────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

function showApp() {
  showScreen('app');
  const isAdmin = currentProfilo?.ruolo === 'admin';
  const mostraLocaleSwitch = isAdmin || !currentProfilo?.locale;
  document.getElementById('user-badge').textContent = currentProfilo?.nome || currentUser.email;
  document.getElementById('bottom-nav').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('locale-switch').style.display = mostraLocaleSwitch ? 'flex' : 'none';
  if (mostraLocaleSwitch) {
    document.getElementById('ls-bar').classList.toggle('active', currentLocale === 'loveme_bar');
    document.getElementById('ls-corso').classList.toggle('active', currentLocale === 'loveme_corso');
  }
  setTodayDate();
  buildPrimaNota();
  showPage('compila');
  updateLocaleLabel();
  loadNotaDelGiorno();
}

function showPage(page) {
  const pagineSoloAdmin = ['storico','dashboard','admin','assegni','banca','fornitori','contabilita','dipendenti'];
  if (pagineSoloAdmin.includes(page) && currentProfilo?.ruolo !== 'admin') page = 'compila';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const nb = document.getElementById('nav-' + page); if (nb) nb.classList.add('active');
  if (page === 'storico') loadStorico();
  if (page === 'dashboard') loadDashboard();
  if (page === 'admin') loadUtenti();
  if (page === 'contabilita') loadFornioriContabilita();
  // ✅ FIX 1: carica la lista fornitori quando si apre la pagina anagrafica
  if (page === 'fornitori') loadFornitori();
}

function switchLocale(loc) {
  currentLocale = loc;
  document.getElementById('ls-bar').classList.toggle('active', loc === 'loveme_bar');
  document.getElementById('ls-corso').classList.toggle('active', loc === 'loveme_corso');
  updateLocaleLabel(); buildPrimaNota(); loadNotaDelGiorno();
}
function updateLocaleLabel() {
  document.getElementById('compila-locale-label').textContent = LOCALE_LABEL[currentLocale];
}

// ── PRIMA NOTA — STRUTTURA ────────────────────────────────────────────────────
function buildPrimaNota() {
  buildSezioneFornitori(5);
  buildSezionePrelievi(3);
  updateBancaSelects();
  calc();
}

// ── SEZIONE FORNITORI ─────────────────────────────────────────────────────────
function buildSezioneFornitori(nRighe) {
  const tbody = document.getElementById('tbody-fornitori');
  if (!tbody) return;
  tbody.innerHTML = '';
  righeFornitoriM = []; righeFornitoriT = []; righeDescFornitori = [];
  for (let i = 0; i < nRighe; i++) aggiungiRigaFornitoreDOM(tbody, i);
}

function aggiungiRigaFornitorePulsante() {
  const tbody = document.getElementById('tbody-fornitori');
  const idx = righeFornitoriM.length;
  aggiungiRigaFornitoreDOM(tbody, idx);
}

function aggiungiRigaFornitoreDOM(tbody, idx) {
  const tr = document.createElement('tr');
  const im = mkNumInput(); im.oninput = calc;
  const it = mkNumInput(); it.oninput = calc;
  righeFornitoriM.push(im);
  righeFornitoriT.push(it);

  let descEl;
  if (fornitoriCache.length > 0) {
    descEl = document.createElement('select');
    descEl.className = 'ni-select sel-fornitore';
    descEl.innerHTML = fornitorOptsHtml();
  } else {
    descEl = document.createElement('input');
    descEl.type = 'text'; descEl.placeholder = 'Fornitore...'; descEl.className = 'ni-desc';
  }
  righeDescFornitori.push(descEl);

  const tdD = document.createElement('td'); tdD.className = 'td-desc';
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:2px';
  wrap.appendChild(descEl);
  if (idx >= 5) {
    const rm = document.createElement('button'); rm.textContent = '×'; rm.className = 'btn-remove-riga';
    rm.onclick = () => {
      const i = righeFornitoriM.indexOf(im);
      if (i >= 0) { righeFornitoriM.splice(i,1); righeFornitoriT.splice(i,1); righeDescFornitori.splice(i,1); }
      tr.remove(); calc();
    };
    wrap.appendChild(rm);
  }
  tdD.appendChild(wrap);
  tr.appendChild(tdD);
  tr.appendChild(mkTd('td-m', im));
  tr.appendChild(mkTd('td-t', it));
  tbody.appendChild(tr);
}

// ── SEZIONE PRELIEVI ──────────────────────────────────────────────────────────
function buildSezionePrelievi(nRighe) {
  const tbody = document.getElementById('tbody-prelievi');
  if (!tbody) return;
  tbody.innerHTML = '';
  righePreleviM = []; righePreleviT = []; righeDescPrelievi = [];
  for (let i = 0; i < nRighe; i++) aggiungiRigaPrelievoDom(tbody, i);
}

function aggiungiRigaPrelievo() {
  const tbody = document.getElementById('tbody-prelievi');
  const idx = righePreleviM.length;
  aggiungiRigaPrelievoDom(tbody, idx);
}

function aggiungiRigaPrelievoDom(tbody, idx) {
  const tr = document.createElement('tr');
  const im = mkNumInput(); im.oninput = calc;
  const it = mkNumInput(); it.oninput = calc;
  righePreleviM.push(im); righePreleviT.push(it);
  const desc = document.createElement('input');
  desc.type = 'text'; desc.placeholder = 'Causale...'; desc.className = 'ni-desc';
  righeDescPrelievi.push(desc);
  const tdD = document.createElement('td'); tdD.className = 'td-desc';
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:2px';
  wrap.appendChild(desc);
  if (idx >= 3) {
    const rm = document.createElement('button'); rm.textContent = '×'; rm.className = 'btn-remove-riga';
    rm.onclick = () => {
      const i = righePreleviM.indexOf(im);
      if (i >= 0) { righePreleviM.splice(i,1); righePreleviT.splice(i,1); righeDescPrelievi.splice(i,1); }
      tr.remove(); calc();
    };
    wrap.appendChild(rm);
  }
  tdD.appendChild(wrap); tr.appendChild(tdD); tr.appendChild(mkTd('td-m', im)); tr.appendChild(mkTd('td-t', it));
  tbody.appendChild(tr);
}

// ── AGGIORNA SELECT BANCA ─────────────────────────────────────────────────────
function updateBancaSelects() {
  document.querySelectorAll('.sel-banca-pn').forEach(sel => {
    const val = sel.value;
    sel.innerHTML = bancaOptsHtml();
    if (val) sel.value = val;
  });
}

// ── CALCOLI ───────────────────────────────────────────────────────────────────
function getVal(el) { return parseFloat(el?.value) || 0; }
function effV(m, t) { return t.value.trim() === '' ? getVal(m) : getVal(t); }
function getFixed(id) { return getVal(document.getElementById(id)); }
function effFixed(idM, idT) {
  const t = document.getElementById(idT);
  const m = document.getElementById(idM);
  return t && t.value.trim() !== '' ? getVal(t) : getVal(m);
}

function calc() {
  const fc = getFixed('pn-fc');

  let umSum = 0, utSum = 0;
  righeFornitoriM.forEach((im, i) => { umSum += getVal(im); utSum += effV(im, righeFornitoriT[i]); });
  righePreleviM.forEach((im, i)   => { umSum += getVal(im); utSum += effV(im, righePreleviT[i]); });
  ['bonifici','pos','carte'].forEach(k => {
    umSum += getFixed(k+'-m');
    utSum += effFixed(k+'-m', k+'-t');
  });
  umSum += getFixed('fc-usc-m');
  utSum += effFixed('fc-usc-m', 'fc-usc-t');

  let emSum = fc, etSum = fc;
  ['money','sisal','incasso','fatture','giornali'].forEach(k => {
    emSum += getFixed(k+'-m');
    etSum += effFixed(k+'-m', k+'-t');
  });

  ['bonifici','pos','carte','fc-usc','money','sisal','incasso','fatture','giornali'].forEach(k => {
    const idM = k+'-m', idT = k+'-t';
    const elM = document.getElementById(idM), elT = document.getElementById(idT);
    if (!elM || !elT) return;
    if (elT.value.trim() === '' && elM.value.trim() !== '') {
      elT.classList.add('ni-auto');
      elT.parentElement.className = 'td-t-auto';
    } else {
      elT.classList.remove('ni-auto');
      if (elT.parentElement.className === 'td-t-auto') elT.parentElement.className = 'td-t';
    }
  });

  righeFornitoriM.forEach((im, i) => {
    const it = righeFornitoriT[i];
    if (it.value.trim() === '' && im.value.trim() !== '') { it.classList.add('ni-auto'); it.parentElement.className = 'td-t-auto'; }
    else { it.classList.remove('ni-auto'); if (it.parentElement.className === 'td-t-auto') it.parentElement.className = 'td-t'; }
  });
  righePreleviM.forEach((im, i) => {
    const it = righePreleviT[i];
    if (it.value.trim() === '' && im.value.trim() !== '') { it.classList.add('ni-auto'); it.parentElement.className = 'td-t-auto'; }
    else { it.classList.remove('ni-auto'); if (it.parentElement.className === 'td-t-auto') it.parentElement.className = 'td-t'; }
  });

  setText('tot-uscite-m', fmtE(umSum));
  setText('tot-uscite-t', fmtE(utSum));
  setText('tot-entrate-m', fmtE(emSum));
  setText('tot-entrate-t', fmtE(etSum));

  const dm = emSum - umSum, dt = etSum - utSum;
  setDiff('diff-m', dm); setDiff('diff-t', dt);

  setText('r-te', fmtE(etSum));
  setText('r-tu', fmtE(utSum));
  setDiffEl('r-td', dt);
  document.getElementById('sb-diff').className = 'stat-box' + (dt > 0 ? ' alarm' : '');

  const allarme = document.getElementById('allarme');
  if (dt > 0) { allarme.style.display = 'flex'; setText('allarme-text', `Differenza positiva (${fmtSigned(dt)}) — verificare la cassa`); }
  else allarme.style.display = 'none';

  const incassoMCalc = getFixed("incasso-m") + Math.abs(dm);
  const ig = effFixed("incasso-m","incasso-t") + Math.abs(dt);
  const incassoPCalc = ig - incassoMCalc;

  setText('r-inc-m', fmtE(incassoMCalc));
  setText('r-inc-p', fmtE(Math.max(0, incassoPCalc)));
  setText('r-inc', fmtE(ig));

  const deltaEl = document.getElementById('r-delta');
  const sbDelta = document.getElementById('sb-delta');
  if (deltaEl) {
    if (incassoMCalc === 0) {
      deltaEl.textContent = '—';
      if (sbDelta) sbDelta.className = 'stat-box';
    } else {
      const diff = incassoPCalc - incassoMCalc;
      const pct = Math.round((diff / incassoMCalc) * 100);
      const segno = diff >= 0 ? '+' : '';
      deltaEl.textContent = segno + fmtE(Math.abs(diff)) + ' (' + segno + pct + '%)';
      deltaEl.className = 'stat-val ' + (diff >= 0 ? 'val-ok' : 'val-alarm');
      if (sbDelta) sbDelta.className = 'stat-box' + (diff >= 0 ? '' : ' alarm');
    }
  }
  const igEl = document.getElementById('inc-g');
  igEl.textContent = fmtE(ig);
  igEl.className = 'incasso-value' + (dt > 0 ? ' alarm' : '');
  const incT = effFixed("incasso-m","incasso-t");
  setText('inc-formula', dt < 0 ? `${fmtE(incT)} + ${fmtE(Math.abs(dt))} diff.` : dt > 0 ? 'Verifica differenza positiva' : fmtE(ig));
}

function setText(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }
function setDiff(id, v) {
  const el = document.getElementById(id); if(!el) return;
  el.textContent = fmtSigned(v);
  el.className = 'tot-val ' + (v <= 0 ? 'val-ok' : 'val-alarm');
}
function setDiffEl(id, v) {
  const el = document.getElementById(id); if(!el) return;
  el.textContent = fmtSigned(v);
  el.className = 'stat-val ' + (v <= 0 ? 'val-ok' : 'val-alarm');
}
function fmtE(n) { return '€\u00a0' + Math.abs(n).toFixed(2).replace('.', ','); }
function fmtSigned(n) { return (n < 0 ? '- ' : '+ ') + fmtE(n); }
function mkNumInput() { const i=document.createElement('input'); i.type='number'; i.placeholder='—'; i.step='0.01'; i.className='ni'; return i; }
function mkTd(cls, child) { const td=document.createElement('td'); td.className=cls; if(child) td.appendChild(child); return td; }

// ── SALVA ─────────────────────────────────────────────────────────────────────
function giornoDopo(ds) { const d=new Date(ds); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; }
function getBancaKey(key) { const el=document.getElementById(key); return el?.value||null; }

async function salvaNota() {
  const data = document.getElementById('pn-data').value;
  if (!data) { showSaveMsg('Inserisci la data', 'err'); return; }

  const fc = getFixed('pn-fc');
  let umSum=0, emSum=fc, utSum=0, etSum=fc;
  righeFornitoriM.forEach((im,i)=>{ umSum+=getVal(im); utSum+=effV(im,righeFornitoriT[i]); });
  righePreleviM.forEach((im,i)=>{ umSum+=getVal(im); utSum+=effV(im,righePreleviT[i]); });
  ['bonifici','pos','carte'].forEach(k=>{ umSum+=getFixed(k+'-m'); utSum+=effFixed(k+'-m',k+'-t'); });
  umSum+=getFixed('fc-usc-m'); utSum+=effFixed('fc-usc-m','fc-usc-t');
  ['money','sisal','incasso','fatture','giornali'].forEach(k=>{ emSum+=getFixed(k+'-m'); etSum+=effFixed(k+'-m',k+'-t'); });

  const dt = etSum - utSum;
  const ig = effFixed('incasso-m','incasso-t') + Math.abs(dt);
  const fondoChiusura = effFixed('fc-usc-m','fc-usc-t');

  const rows = [];
  righeFornitoriM.forEach((im, i) => {
    const vm = getVal(im), vt = effV(im, righeFornitoriT[i]);
    const descEl = righeDescFornitori[i];
    let desc = '', fornitoreId = null;
    if (descEl.tagName === 'SELECT') {
      fornitoreId = descEl.value || null;
      desc = descEl.value ? descEl.options[descEl.selectedIndex]?.text : '';
    } else { desc = descEl.value.trim(); }
    if (vm || vt || desc) rows.push({
      categoria:'fornitore', descrizione:desc, importo_m:vm, importo_t:vt||vm, ordine:i,
      fornitore_id: fornitoreId, prima_nota_data: data, prima_nota_locale: currentLocale
    });
  });
  righePreleviM.forEach((im, i) => {
    const vm = getVal(im), vt = effV(im, righePreleviT[i]);
    const desc = righeDescPrelievi[i]?.value.trim()||'';
    if (vm || vt || desc) rows.push({ categoria:'prelievo', descrizione:desc, importo_m:vm, importo_t:vt||vm, ordine:i });
  });

  const payload = {
    data, locale: currentLocale, fondo_cassa: fc,
    money_m:      getFixed('money-m'),    money:      effFixed('money-m','money-t'),
    sisal_m:      getFixed('sisal-m'),    sisal:      effFixed('sisal-m','sisal-t'),
    incasso_m:    getFixed('incasso-m'),  incasso:    effFixed('incasso-m','incasso-t'),
    fatture_m:    getFixed('fatture-m'),  fatture:    effFixed('fatture-m','fatture-t'),
    giornali_m:   getFixed('giornali-m'), giornali:   effFixed('giornali-m','giornali-t'),
    bonifici_banca_m: getFixed('bonifici-m'), bonifici_banca: effFixed('bonifici-m','bonifici-t'),
    bonifici_banca_id: getBancaKey('sel-banca-bonifici'),
    pos_m:    getFixed('pos-m'),   pos:    effFixed('pos-m','pos-t'),   pos_banca_id:   getBancaKey('sel-banca-pos'),
    carte_m:  getFixed('carte-m'), carte:  effFixed('carte-m','carte-t'), carte_banca_id: getBancaKey('sel-banca-carte'),
    fondo_cassa_usc_m: getFixed('fc-usc-m'), fondo_cassa_usc: fondoChiusura,
    totale_entrate_m: emSum-fc, totale_uscite_m: umSum, differenza_m: emSum-umSum,
    totale_entrate: etSum-fc, totale_uscite: utSum, differenza: dt,
    incasso_giornaliero: ig,
    compilatore_m: document.getElementById('cm').value,
    compilatore_p: document.getElementById('cp').value,
    compilatore_s: document.getElementById('cs').value,
  };

  const { data: saved, error } = await sb.from('pn_prima_nota').upsert(payload, { onConflict:'data,locale' }).select().single();
  if (error) { showSaveMsg('Errore: '+error.message,'err'); return; }

  if (saved?.id) {
    await sb.from('pn_righe_uscite').delete().eq('prima_nota_id', saved.id);
    if (rows.length) await sb.from('pn_righe_uscite').insert(rows.map(r=>({...r, prima_nota_id:saved.id})));
  }

  if (fondoChiusura > 0) {
    const dom = giornoDopo(data);
    const { data: nd } = await sb.from('pn_prima_nota').select('id,fondo_cassa').eq('data',dom).eq('locale',currentLocale).single();
    if (!nd) await sb.from('pn_prima_nota').insert({ data:dom, locale:currentLocale, fondo_cassa:fondoChiusura });
    else if (!nd.fondo_cassa || nd.fondo_cassa===0) await sb.from('pn_prima_nota').update({fondo_cassa:fondoChiusura}).eq('id',nd.id);
  }

  showSaveMsg('Prima nota salvata' + (fondoChiusura>0?' — fondo cassa domani pre-compilato':''), 'ok');
}

// ── CARICA NOTA ───────────────────────────────────────────────────────────────
async function loadNotaDelGiorno() {
  const data = document.getElementById('pn-data').value;
  if (!data) return;
  const { data: nota } = await sb.from('pn_prima_nota').select('*').eq('data',data).eq('locale',currentLocale).single();

  resettaValoriFixed();
  // ✅ FIX 2: refresh cache prima di ricostruire il form
  // così i fornitori aggiunti di recente appaiono subito nel SELECT
  await caricaFornitoriCache();
  buildSezioneFornitori(5);
  buildSezionePrelievi(3);

  if (!nota) return;

  document.getElementById('pn-fc').value  = nota.fondo_cassa||'';
  document.getElementById('cm').value     = nota.compilatore_m||'';
  document.getElementById('cp').value     = nota.compilatore_p||'';
  document.getElementById('cs').value     = nota.compilatore_s||'';

  const sv = (idM, idT, mVal, tVal) => {
    const em=document.getElementById(idM), et=document.getElementById(idT);
    if(em&&mVal) em.value=mVal;
    if(et&&tVal&&tVal!==mVal) et.value=tVal;
  };
  sv('money-m','money-t',       nota.money_m,      nota.money);
  sv('sisal-m','sisal-t',       nota.sisal_m,      nota.sisal);
  sv('incasso-m','incasso-t',   nota.incasso_m,    nota.incasso);
  sv('fatture-m','fatture-t',   nota.fatture_m,    nota.fatture);
  sv('giornali-m','giornali-t', nota.giornali_m,   nota.giornali);
  sv('bonifici-m','bonifici-t', nota.bonifici_banca_m, nota.bonifici_banca);
  sv('pos-m','pos-t',           nota.pos_m,        nota.pos);
  sv('carte-m','carte-t',       nota.carte_m,      nota.carte);
  sv('fc-usc-m','fc-usc-t',     nota.fondo_cassa_usc_m, nota.fondo_cassa_usc);

  const sbk = (id, val) => { const el=document.getElementById(id); if(el&&val) el.value=val; };
  sbk('sel-banca-bonifici', nota.bonifici_banca_id);
  sbk('sel-banca-pos',      nota.pos_banca_id);
  sbk('sel-banca-carte',    nota.carte_banca_id);

  const { data: righe } = await sb.from('pn_righe_uscite').select('*').eq('prima_nota_id',nota.id).order('ordine');
  if (righe && righe.length) {
    const fornRighe = righe.filter(r=>r.categoria==='fornitore');
    const prelRighe = righe.filter(r=>r.categoria==='prelievo');

    const tbody_f = document.getElementById('tbody-fornitori');
    while (righeFornitoriM.length < fornRighe.length) aggiungiRigaFornitoreDOM(tbody_f, righeFornitoriM.length);
    const tbody_p = document.getElementById('tbody-prelievi');
    while (righePreleviM.length < prelRighe.length) aggiungiRigaPrelievoDom(tbody_p, righePreleviM.length);

    fornRighe.forEach((r,i) => {
      if (!righeFornitoriM[i]) return;
      righeFornitoriM[i].value = r.importo_m||'';
      if (r.importo_t !== r.importo_m) righeFornitoriT[i].value = r.importo_t||'';
      const descEl = righeDescFornitori[i];
      if (!descEl) return;
      if (descEl.tagName === 'SELECT') {
        // ✅ FIX 3: usa fornitore_id direttamente — più affidabile del text-match
        if (r.fornitore_id) {
          descEl.value = r.fornitore_id;
          // Se l'opzione non è stata trovata (fornitore disattivato o cache vecchia)
          // aggiungi un'opzione temporanea con il testo originale
          if (!descEl.value || descEl.value !== r.fornitore_id) {
            const o = document.createElement('option');
            o.value = r.fornitore_id;
            o.textContent = r.descrizione || '(fornitore)';
            descEl.insertBefore(o, descEl.firstChild);
            descEl.value = r.fornitore_id;
          }
        } else if (r.descrizione) {
          // Fallback: cerca per testo (vecchie note senza fornitore_id)
          const opt = Array.from(descEl.options).find(o => o.text === r.descrizione);
          if (opt) descEl.value = opt.value;
        }
      } else { descEl.value = r.descrizione||''; }
    });

    prelRighe.forEach((r,i) => {
      if (!righePreleviM[i]) return;
      righePreleviM[i].value = r.importo_m||'';
      if (r.importo_t !== r.importo_m) righePreleviT[i].value = r.importo_t||'';
      if (righeDescPrelievi[i]) righeDescPrelievi[i].value = r.descrizione||'';
    });
  }

  calc();
  showSaveMsg('Nota del '+formatDate(data)+' caricata — puoi modificarla e risalvare', 'ok');
}

async function onDataChange() {
  resettaValoriFixed();
  buildSezioneFornitori(5);
  buildSezionePrelievi(3);
  await loadNotaDelGiorno();
}

function resettaValoriFixed() {
  ['pn-fc','cm','cp','cs'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  ['money','sisal','incasso','fatture','giornali','bonifici','pos','carte','fc-usc'].forEach(k => {
    const em=document.getElementById(k+'-m'), et=document.getElementById(k+'-t');
    if(em) em.value=''; if(et) et.value='';
  });
  ['sel-banca-bonifici','sel-banca-pos','sel-banca-carte'].forEach(id => { const el=document.getElementById(id); if(el) el.selectedIndex=0; });
}

function resettaForm() {
  resettaValoriFixed();
  buildSezioneFornitori(5);
  buildSezionePrelievi(3);
  calc();
}

function showSaveMsg(msg, type) {
  const el = document.getElementById('save-msg');
  el.textContent=msg; el.className='save-msg '+type; el.style.display='block';
  setTimeout(()=>{ el.style.display='none'; }, 4000);
}
function setTodayDate() { document.getElementById('pn-data').value=new Date().toISOString().split('T')[0]; }

// ── STORICO ───────────────────────────────────────────────────────────────────
async function loadStorico() {
  const locale  = document.getElementById('filter-locale').value;
  const periodo = document.getElementById('filter-periodo').value;
  let q = sb.from('pn_prima_nota').select('*').order('data',{ascending:false});
  if (locale) q=q.eq('locale',locale);
  q = applyPeriodo(q, periodo);
  const { data } = await q; if (!data) return;
  const totInc  = data.reduce((a,r)=>a+(r.incasso_giornaliero||0),0);
  const totDiff = data.reduce((a,r)=>a+(r.differenza||0),0);
  document.getElementById('storico-summary').innerHTML=`
    <div class="sum-card"><div class="sum-label">Giornate</div><div class="sum-val">${data.length}</div></div>
    <div class="sum-card"><div class="sum-label">Tot. incassi</div><div class="sum-val green">${fmtE(totInc)}</div></div>
    <div class="sum-card"><div class="sum-label">Diff. totale</div><div class="sum-val ${totDiff<=0?'green':''}">${fmtSigned(totDiff)}</div></div>`;
  if (!data.length) { document.getElementById('storico-list').innerHTML='<div class="empty-state">Nessuna prima nota nel periodo</div>'; return; }
  document.getElementById('storico-list').innerHTML=data.map(r=>`
    <div class="storico-item">
      <div class="si-left" onclick="apriEModifica('${r.data}','${r.locale}')" style="flex:1;cursor:pointer">
        <div class="si-date">${formatDate(r.data)}</div>
        <div class="si-meta">
          <span class="badge-locale ${r.locale==='loveme_bar'?'badge-bar':'badge-corso'}">${LOCALE_LABEL[r.locale]}</span>
          ${r.compilatore_s?' · '+r.compilatore_s:''}
        </div>
      </div>
      <div class="si-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="si-incasso">${fmtE(r.incasso_giornaliero)}</div>
        <div class="si-diff">Diff: ${fmtSigned(r.differenza)}</div>
        <div style="display:flex;gap:6px;margin-top:2px">
          <button class="btn-mini" onclick="apriEModifica('${r.data}','${r.locale}')">Modifica</button>
          <button class="btn-mini danger" onclick="eliminaPrimaNota('${r.id}','${r.data}')">Elimina</button>
        </div>
      </div>
    </div>`).join('');
}

async function eliminaPrimaNota(id, data) {
  if (currentProfilo?.ruolo !== 'admin') { alert("Solo l'amministratore può eliminare le prime note."); return; }
  if (!confirm(`Eliminare la prima nota del ${formatDate(data)}?\nL'operazione è irreversibile.`)) return;
  await sb.from('pn_righe_uscite').delete().eq('prima_nota_id', id);
  await sb.from('pn_prima_nota').delete().eq('id', id);
  loadStorico();
}

async function apriEModifica(data, locale) {
  currentLocale = locale;
  document.getElementById('pn-data').value = data;
  if (document.getElementById('ls-bar')) {
    document.getElementById('ls-bar').classList.toggle('active', locale==='loveme_bar');
    document.getElementById('ls-corso').classList.toggle('active', locale==='loveme_corso');
  }
  updateLocaleLabel();
  showPage('compila');
  await loadNotaDelGiorno();
}

function applyPeriodo(q, periodo) {
  const now=new Date();
  if (periodo==='settimana'){const d=new Date(now);d.setDate(d.getDate()-d.getDay()+1);return q.gte('data',d.toISOString().split('T')[0]);}
  if (periodo==='mese') return q.gte('data',`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`);
  if (periodo==='anno') return q.gte('data',`${now.getFullYear()}-01-01`);
  return q;
}
function formatDate(d){if(!d)return'—';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function buildTrendSVG(keys, data, maxVal) {
  if (!keys.length) return '<div class="empty-state" style="padding:2rem">Nessun dato</div>';
  const W = 340, H = 200, padL = 8, padR = 8, padT = 44, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW   = Math.min(38, Math.floor(chartW / keys.length) - 8);
  const gap    = (chartW - barW * keys.length) / (keys.length + 1);
  const colors = ['#818CF8','#A78BFA','#34D399','#FCD34D','#FB923C','#F472B6','#38BDF8','#4ADE80'];
  const baseY  = padT + chartH;

  let bars = '';
  keys.forEach((k, i) => {
    const v    = data[k] || 0;
    const pct  = maxVal > 0 ? v / maxVal : 0;
    const bH   = Math.max(6, Math.round(pct * chartH));
    const x    = padL + gap + i * (barW + gap);
    const y    = baseY - bH;
    const col  = colors[i % colors.length];
    const vStr = v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v).toString();
    bars += '<rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+bH+'" rx="6" fill="'+col+'"/>';
    bars += '<text x="'+(x+barW/2)+'" y="'+(y-7)+'" text-anchor="middle" font-size="10" font-weight="700" fill="'+col+'">'+vStr+'</text>';
    bars += '<text x="'+(x+barW/2)+'" y="'+(H-10)+'" text-anchor="middle" font-size="11" fill="#94A3B8" font-weight="600">'+k+'</text>';
  });

  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block" xmlns="http://www.w3.org/2000/svg">'
    + '<rect width="'+W+'" height="'+H+'" fill="#0F172A" rx="12"/>'
    + '<line x1="'+padL+'" y1="'+baseY+'" x2="'+(W-padR)+'" y2="'+baseY+'" stroke="#1E293B" stroke-width="1.5"/>'
    + bars
    + '</svg>';
}

async function loadDashboard() {
  const periodo=document.getElementById('dash-periodo').value;
  const el=document.getElementById('dashboard-content');
  el.innerHTML='<div class="empty-state">Caricamento...</div>';
  let q=sb.from('pn_prima_nota').select('*').order('data',{ascending:true});
  q=applyPeriodo(q,periodo);
  const{data}=await q;
  if(!data||!data.length){el.innerHTML='<div class="empty-state">Nessun dato nel periodo</div>';return;}
  const bar=data.filter(r=>r.locale==='loveme_bar'),corso=data.filter(r=>r.locale==='loveme_corso');
  const totInc=arr=>arr.reduce((a,x)=>a+(x.incasso_giornaliero||0),0);
  const avgInc=arr=>arr.length?totInc(arr)/arr.length:0;
  const q30=await sb.from('pn_prima_nota').select('incasso_giornaliero,locale').gte('data',daysAgo(30));
  const d30=q30.data||[];
  const avg30Bar=avg(d30.filter(r=>r.locale==='loveme_bar').map(r=>r.incasso_giornaliero));
  const avg30Corso=avg(d30.filter(r=>r.locale==='loveme_corso').map(r=>r.incasso_giornaliero));
  const byWeek={};
  data.forEach(r=>{const wk=getWeekLabel(r.data);byWeek[wk]=(byWeek[wk]||0)+(r.incasso_giornaliero||0);});
  const wkKeys=Object.keys(byWeek).slice(-6);
  const wkMax=Math.max(...wkKeys.map(k=>byWeek[k]),1);
  let prevTot7=0;
  el.innerHTML=`
    <div class="dash-section"><div class="dash-section-title">Riepilogo periodo</div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-label">Love Me Bar</div><div class="dash-val green">${fmtE(totInc(bar))}</div><div class="dash-sub">Media/gg: ${fmtE(avgInc(bar))} · ${bar.length} gg</div></div>
      <div class="dash-card"><div class="dash-label">Café del Corso</div><div class="dash-val green">${fmtE(totInc(corso))}</div><div class="dash-sub">Media/gg: ${fmtE(avgInc(corso))} · ${corso.length} gg</div></div>
      <div class="dash-card full"><div class="dash-label">Totale entrambi</div><div class="dash-val green">${fmtE(totInc(data))}</div><div class="dash-sub">Diff. media: ${fmtSigned(avg(data.map(r=>r.differenza)))}</div></div>
    </div></div>
    <div class="dash-section"><div class="dash-section-title">Trend settimanale</div>
    <div class="dash-card" style="padding:0;overflow:hidden">${buildTrendSVG(wkKeys,byWeek,wkMax)}</div></div>
    <div class="dash-section"><div class="dash-section-title">Previsionale prossimi 7 giorni</div>
    <div class="dash-card">${[...Array(7)].map((_,i)=>{
      const d=new Date();d.setDate(d.getDate()+i+1);
      const gg=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d.getDay()];
      const pb=avg30Bar*stagionalita(d.getDay()),pc=avg30Corso*stagionalita(d.getDay());
      prevTot7+=(pb+pc);
      return`<div class="previsionale-row"><div><div class="prev-label">${gg} ${d.getDate()}/${d.getMonth()+1}</div><div class="prev-note">Bar: ${fmtE(pb)} · Corso: ${fmtE(pc)}</div></div><div class="prev-val">${fmtE(pb+pc)}</div></div>`;
    }).join('')}</div></div>`;
  try {
    const dH = await buildDisponibilitaSection(prevTot7);
    const aH = await buildAllineamentoSection(periodo);
    el.innerHTML += dH + aH;
  } catch(e) { console.error('Dashboard extra:', e); }
}

async function buildDisponibilitaSection(prevTot7) {
  const tra30 = new Date(); tra30.setDate(tra30.getDate()+30);
  const tra30str = tra30.toISOString().split('T')[0];
  const [
    { data: noteMedia },
    { data: righeFornitoriMedia },
    { data: assScad30 },
    { data: assScadSett }
  ] = await Promise.all([
    sb.from('pn_prima_nota').select('incasso_giornaliero').gte('data', daysAgo(30)).gt('incasso_giornaliero',0),
    sb.from('pn_righe_uscite').select('importo_t,importo_m,pn_prima_nota!inner(data)')
      .eq('categoria','fornitore').gte('pn_prima_nota.data', daysAgo(30)),
    sb.from('pn_assegni').select('importo').eq('incassato',false).lte('data_scadenza',tra30str),
    sb.from('pn_assegni').select('importo,data_scadenza').eq('incassato',false).gte('data_scadenza', new Date().toISOString().split('T')[0]).order('data_scadenza')
  ]);
  const n = Math.max((noteMedia||[]).length, 1);
  const mediaIncasso   = (noteMedia||[]).reduce((a,r)=>a+(r.incasso_giornaliero||0),0) / n;
  const totFornitori30 = (righeFornitoriMedia||[]).reduce((a,r)=>a+(r.importo_t||r.importo_m||0),0);
  const mediaFornitori = totFornitori30 / n;
  const margineMedio   = mediaIncasso - mediaFornitori;
  const incassiPrev30  = mediaIncasso * 30;
  const fornPrev30     = mediaFornitori * 30;
  const assScad30Tot   = (assScad30||[]).reduce((a,r)=>a+(r.importo||0),0);
  const fabbisogno     = incassiPrev30 - fornPrev30 - assScad30Tot;
  const scadSett = {};
  (assScadSett||[]).forEach(a => {
    const d = new Date(a.data_scadenza);
    const wk = 'S'+getWeekNumber(d);
    scadSett[wk] = (scadSett[wk]||0) + a.importo;
  });
  const scadKeys = Object.keys(scadSett);
  const scadMax  = Math.max(...scadKeys.map(k=>scadSett[k]), 1);
  let scadSvg = '';
  if (scadKeys.length) {
    const W=340,H=140,padL=8,padR=8,padT=32,padB=24;
    const cW=W-padL-padR, cH=H-padT-padB;
    const bW=Math.min(40,Math.floor(cW/scadKeys.length)-6);
    const gap=(cW-bW*scadKeys.length)/(scadKeys.length+1);
    const baseY=padT+cH;
    let rects='';
    scadKeys.forEach((k,i)=>{
      const v=scadSett[k], pct=v/scadMax;
      const bH=Math.max(4,Math.round(pct*cH));
      const x=padL+gap+i*(bW+gap), y=baseY-bH;
      const vStr=v>=1000?(v/1000).toFixed(1)+'k':Math.round(v).toString();
      rects+='<rect x="'+x+'" y="'+y+'" width="'+bW+'" height="'+bH+'" rx="5" fill="#F59E0B"/>';
      rects+='<text x="'+(x+bW/2)+'" y="'+(y-5)+'" text-anchor="middle" font-size="9" fill="#F59E0B" font-weight="700">'+vStr+'</text>';
      rects+='<text x="'+(x+bW/2)+'" y="'+(H-6)+'" text-anchor="middle" font-size="9" fill="#94A3B8">'+k+'</text>';
    });
    scadSvg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block" xmlns="http://www.w3.org/2000/svg">'
      +'<rect width="'+W+'" height="'+H+'" fill="#0F172A" rx="10"/>'
      +'<line x1="'+padL+'" y1="'+baseY+'" x2="'+(W-padR)+'" y2="'+baseY+'" stroke="#1E293B" stroke-width="1.5"/>'
      +rects+'</svg>';
  }
  const fmtS = v => (v>=0?'+ ':' - ')+fmtE(Math.abs(v));
  const cls  = v => v>=0?'green':'red';
  return '<div class="dash-section">'
    +'<div class="dash-section-title">Previsionale finanziario — 30 giorni</div>'
    +'<div class="disp-grid" style="margin-bottom:12px">'
    +'<div class="disp-card"><div class="disp-label">Media incasso / giorno</div><div class="disp-val green">'+fmtE(mediaIncasso)+'</div><div class="disp-sub">'+n+' giorni rilevati</div></div>'
    +'<div class="disp-card"><div class="disp-label">Media spese fornitori / giorno</div><div class="disp-val red">'+fmtE(mediaFornitori)+'</div><div class="disp-sub">solo uscite fornitori</div></div>'
    +'<div class="disp-card"><div class="disp-label">Margine operativo / giorno</div><div class="disp-val '+cls(margineMedio)+'">'+fmtS(margineMedio)+'</div><div class="disp-sub">incasso meno fornitori</div></div>'
    +'<div class="disp-card '+(fabbisogno<0?'alarm':'')+'"><div class="disp-label">Fabbisogno netto 30gg</div><div class="disp-val '+cls(fabbisogno)+'">'+fmtS(fabbisogno)+'</div><div class="disp-sub">margine - assegni in scadenza</div></div>'
    +'</div>'
    +'<div class="prev30-box" style="margin-bottom:10px">'
    +'<div class="prev30-title">Proiezione 30 giorni</div>'
    +'<div class="prev30-row"><span>Incassi previsti (media × 30)</span><span class="p30-val green">+ '+fmtE(incassiPrev30)+'</span></div>'
    +'<div class="prev30-row"><span>Spese fornitori previste (media × 30)</span><span class="p30-val red"> - '+fmtE(fornPrev30)+'</span></div>'
    +'<div class="prev30-row"><span>Assegni fornitori in scadenza 30gg</span><span class="p30-val red"> - '+fmtE(assScad30Tot)+'</span></div>'
    +'<div class="prev30-row total"><span>Fabbisogno netto disponibile</span><span class="p30-val '+cls(fabbisogno)+' big">'+fmtS(fabbisogno)+'</span></div>'
    +'</div>'
    +(scadKeys.length?'<div class="dash-section-title" style="margin-top:1rem;margin-bottom:8px">Scadenzario assegni per settimana</div>'+scadSvg:'')
    +'</div>';
}

async function buildAllineamentoSection(periodoDefault) {
  const sel = document.getElementById('alig-periodo-filter');
  const periodo = sel ? sel.value : (periodoDefault || 'mese');
  const now = new Date();
  let dataFrom;
  if (periodo==='settimana'){const d=new Date(now);d.setDate(d.getDate()-d.getDay()+1);dataFrom=d.toISOString().split('T')[0];}
  else if (periodo==='anno') dataFrom=now.getFullYear()+'-01-01';
  else if (periodo==='tutto') dataFrom='2020-01-01';
  else dataFrom=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-01';
  const [{ data: note }, { data: vers }] = await Promise.all([
    sb.from('pn_prima_nota').select('money,sisal,incasso,fatture,giornali').gte('data',dataFrom),
    sb.from('pn_versamenti').select('importo_contante,importo_pos').gte('data_versamento',dataFrom)
  ]);
  const totMoney   = (note||[]).reduce((a,r)=>a+(r.money||0),0);
  const totSisal   = (note||[]).reduce((a,r)=>a+(r.sisal||0),0);
  const totIncasso = (note||[]).reduce((a,r)=>a+(r.incasso||0),0);
  const totFatture = (note||[]).reduce((a,r)=>a+(r.fatture||0),0);
  const totGiornali= (note||[]).reduce((a,r)=>a+(r.giornali||0),0);
  const totFiscale = totMoney + totSisal + totIncasso + totFatture + totGiornali;
  const contanteVers = (vers||[]).reduce((a,r)=>a+(r.importo_contante||0),0);
  const posVers      = (vers||[]).reduce((a,r)=>a+(r.importo_pos||0),0);
  const totVersato   = contanteVers + posVers;
  const delta = totFiscale - totVersato;
  const isAlert = delta < 0;
  const labels = {mese:'Mese corrente',settimana:'Settimana corrente',anno:"Quest'anno",tutto:'Tutto'};
  const fmtS = v => (v>=0?'+ ':' - ')+fmtE(Math.abs(v));
  return '<div class="dash-section" id="sezione-allineamento">'
    +'<div class="dash-section-header">'
    +'<div class="dash-section-title">Conciliazione fiscale</div>'
    +'<select id="alig-periodo-filter" class="alig-filter-select" onchange="refreshAllineamento()">'
    +'<option value="settimana"'+(periodo==='settimana'?' selected':'')+'>Questa settimana</option>'
    +'<option value="mese"'+(periodo==='mese'?' selected':'')+'>Questo mese</option>'
    +'<option value="anno"'+(periodo==='anno'?' selected':'')+">Quest'anno</option>"
    +'<option value="tutto"'+(periodo==='tutto'?' selected':'')+'>Tutto</option>'
    +'</select>'
    +'</div>'
    +(isAlert ? '<div class="allarme-box" style="display:flex;margin-bottom:1rem"><div class="allarme-dot"></div><span>ATTENZIONE: hai versato in banca più di quanto incassato fiscalmente (+'+fmtE(Math.abs(delta))+'). Verificare immediatamente.</span></div>' : '')
    +'<div class="prev30-box" style="margin-bottom:10px">'
    +'<div class="prev30-title">Incassato fiscale — ' + (labels[periodo]||periodo) + '</div>'
    +'<div class="prev30-row"><span>Money</span><span class="p30-val">'+fmtE(totMoney)+'</span></div>'
    +'<div class="prev30-row"><span>Sisal</span><span class="p30-val">'+fmtE(totSisal)+'</span></div>'
    +'<div class="prev30-row"><span>Incasso</span><span class="p30-val">'+fmtE(totIncasso)+'</span></div>'
    +'<div class="prev30-row"><span>Fatture</span><span class="p30-val">'+fmtE(totFatture)+'</span></div>'
    +'<div class="prev30-row"><span>Giornali</span><span class="p30-val">'+fmtE(totGiornali)+'</span></div>'
    +'<div class="prev30-row total"><span>Totale incassato fiscale</span><span class="p30-val big">'+fmtE(totFiscale)+'</span></div>'
    +'</div>'
    +'<div class="prev30-box '+(isAlert?'prev30-alarm':'')+'">'
    +'<div class="prev30-title">Versato in banca</div>'
    +'<div class="prev30-row"><span>Contante versato</span><span class="p30-val">'+fmtE(contanteVers)+'</span></div>'
    +'<div class="prev30-row"><span>POS versato</span><span class="p30-val">'+fmtE(posVers)+'</span></div>'
    +'<div class="prev30-row total"><span>Totale versato</span><span class="p30-val big">'+fmtE(totVersato)+'</span></div>'
    +'<div class="prev30-row '+(isAlert?'total':'delta ok')+'"><span>'+(isAlert?'ALERT: versato supera incassato':'Differenza gestita fuori banca')+'</span><span class="p30-val '+(isAlert?'red big':'green')+'">'+(isAlert?'- '+fmtE(Math.abs(delta)):fmtS(delta))+'</span></div>'
    +(isAlert?'':('<div style="font-size:10px;color:var(--gray-400);padding:6px 0;font-style:italic">Spese fornitori cash, fondo cassa e gestione interna</div>'))
    +'</div>'
    +'</div>';
}

async function refreshAllineamento() {
  const sez = document.getElementById('sezione-allineamento');
  if (!sez) return;
  const html = await buildAllineamentoSection();
  sez.outerHTML = html;
}

function avg(arr){return arr.length?arr.reduce((a,b)=>a+(b||0),0)/arr.length:0;}
function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().split('T')[0];}
function getWeekLabel(s){return`S${getWeekNumber(new Date(s))}`;}
function getWeekNumber(d){const j=new Date(d.getFullYear(),0,1);return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7);}
function stagionalita(dow){return[0.85,0.90,0.90,0.92,0.95,1.15,1.20][dow]||1;}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
function localeLabel(locale) {
  if (!locale) return 'Entrambi i locali';
  return LOCALE_LABEL[locale] || locale;
}

async function loadUtenti() {
  const { data } = await sb.from('pn_utenti').select('*').order('nome');
  if (!data) return;
  document.getElementById('utenti-list').innerHTML = `<div class="utenti-list">${data.map(u => `
    <div class="utente-item">
      <div>
        <div class="ut-nome">${u.nome} ${!u.attivo ? '<span style="font-size:10px;color:var(--gray-400)">(disattivo)</span>' : ''}</div>
        <div class="ut-email">${u.email}</div>
        <div class="ut-email" style="margin-top:2px">
          <span style="font-size:11px;color:var(--blue);font-weight:500">${localeLabel(u.locale)}</span>
          · <span style="font-size:11px">${u.ruolo}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-toggle" onclick="toggleUtente('${u.id}',${u.attivo})">${u.attivo ? 'Disattiva' : 'Attiva'}</button>
        <button class="btn-toggle btn-danger" onclick="eliminaUtente('${u.id}','${u.nome.replace(/'/g,"\\'")}')">Elimina</button>
      </div>
    </div>`).join('')}</div>`;
}

async function toggleUtente(id, attivo) {
  await sb.from('pn_utenti').update({ attivo: !attivo }).eq('id', id);
  loadUtenti();
}

async function eliminaUtente(id, nome) {
  if (!confirm(`Sei sicuro di voler eliminare l'utente "${nome}"?\n\nQuesta operazione è irreversibile.`)) return;
  const { error } = await sb.from('pn_utenti').delete().eq('id', id);
  if (error) { alert('Errore eliminazione: ' + error.message); return; }
  loadUtenti();
}

function showAddUser() {
  const f = document.getElementById('add-user-form');
  f.style.display = 'flex'; f.style.flexDirection = 'column';
}
function hideAddUser() { document.getElementById('add-user-form').style.display = 'none'; }

async function creaUtente() {
  const nome   = document.getElementById('nu-nome').value.trim();
  const email  = document.getElementById('nu-email').value.trim();
  const ruolo  = document.getElementById('nu-ruolo').value;
  const locale = document.getElementById('nu-locale').value || null;
  const msgEl  = document.getElementById('nu-msg');
  if (!nome || !email) { showMsgEl(msgEl, 'Compila nome ed email', 'err'); return; }
  const { error } = await sb.from('pn_utenti').insert({ email, nome, ruolo, locale });
  if (error) { showMsgEl(msgEl, 'Errore: ' + error.message, 'err'); return; }
  showMsgEl(msgEl, 'Utente salvato. Crealo su Supabase Auth per abilitare il login.', 'ok');
  hideAddUser();
  loadUtenti();
}

function showMsgEl(el, msg, type) {
  el.textContent = msg; el.className = 'save-msg ' + type; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
