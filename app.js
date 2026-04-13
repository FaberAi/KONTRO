// ============================================
// KONTRO — Logica Applicazione
// ============================================

let currentUser = null;
let currentBusiness = null;
let currentLocations = [];
let selectedLocation = null;
let selectedType = 'entrata';

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  setTodayDate();
  populateReportSelects();

  const { data: { session } } = await db.auth.getSession();
  await checkInviteToken();
  if (session) {
    currentUser = session.user;
    await initApp();
  } else {
    showScreen('login');
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await initApp();
    } else if (event === 'SIGNED_OUT') {
      showScreen('login');
    }
  });
});

function setTodayDate() {
  const today = new Date().toISOString().split('T')[0];
  const dateEl = document.getElementById('mov-date');
  if (dateEl) dateEl.value = today;

  const fromEl = document.getElementById('filter-from');
  const toEl = document.getElementById('filter-to');
  if (fromEl) fromEl.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  if (toEl) toEl.value = today;

  const pageDate = document.getElementById('page-date');
  if (pageDate) {
    pageDate.textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
}

async function initApp() {
  showScreen('app');
  await loadBusiness();
  await loadLocations();
  await loadCategories();
  // Carica cache fornitori e banche all'avvio
  if (currentBusiness) {
    const [{ data: forn }, { data: banche }] = await Promise.all([
      db.from('fornitori').select('id,ragione_sociale')
        .eq('business_id', currentBusiness.id).eq('attivo', true).order('ragione_sociale'),
      db.from('banche').select('*')
        .eq('business_id', currentBusiness.id).eq('attivo', true).order('nome')
    ]);
    fornitoriCache = forn || [];
    bancheCache = banche || [];
  }
  await loadDashboard();
  if (currentRole === 'cashier') await loadCurrentUserPermissions();
  updateUserUI();
}

// ============================================
// AUTH
// ============================================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('auth-message');

  if (!email || !password) { showAuthMsg('Inserisci email e password', 'error'); return; }

  showAuthMsg('Accesso in corso...', '');
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) { showAuthMsg(error.message, 'error'); return; }
  showAuthMsg('Accesso effettuato!', 'success');
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const businessName = document.getElementById('reg-business').value.trim();

  if (!name || !email || !password || !businessName) {
    showAuthMsg('Compila tutti i campi', 'error'); return;
  }

  showAuthMsg('Creazione account...', '');

  const { data, error } = await db.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });

  if (error) { showAuthMsg(error.message, 'error'); return; }

  if (data.user) {
    // Crea azienda
    const { data: biz, error: bizErr } = await db
      .from('businesses')
      .insert({ name: businessName, email })
      .select().single();

    if (!bizErr && biz) {
      await db.from('user_roles').insert({
        user_id: data.user.id,
        business_id: biz.id,
        role: 'owner'
      });
      await db.rpc('create_default_categories', { p_business_id: biz.id });
    }
  }

  showAuthMsg('Account creato! Controlla la tua email per confermare.', 'success');
}

async function doLogout() {
  await db.auth.signOut();
  currentUser = null;
  currentBusiness = null;
  currentLocations = [];
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-message');
  el.textContent = msg;
  el.className = 'auth-message ' + type;
}

// ============================================
// BUSINESS & LOCATIONS
// ============================================
let currentRole = null;

async function loadBusiness() {
  const { data } = await db
    .from('user_roles')
    .select('business_id, role, businesses(*)')
    .eq('user_id', currentUser.id)
    .single();

  if (data) {
    currentBusiness = data.businesses;
    currentRole = data.role; // 'owner', 'admin', 'cashier'
  }
}

async function loadLocations() {
  if (!currentBusiness) return;

  const { data } = await db
    .from('locations')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('active', true);

  currentLocations = data || [];
  populateLocationSelects();
  renderLocationsList();
}

function populateLocationSelects() {
  const selects = ['location-select', 'mov-location'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const firstOption = id === 'location-select' ? '<option value="">Tutte le sedi</option>' : '<option value="">Sede principale</option>';
    el.innerHTML = firstOption + currentLocations.map(l =>
      `<option value="${l.id}">${l.name}</option>`
    ).join('');
  });
}

function onLocationChange() {
  selectedLocation = document.getElementById('location-select').value || null;
  loadDashboard();
}

// ============================================
// CATEGORIES
// ============================================
async function loadCategories() {
  if (!currentBusiness) return;

  const { data } = await db
    .from('categories')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('active', true)
    .order('name');

  window.allCategories = data || [];
  filterCategoriesByType(selectedType);
}

function filterCategoriesByType(type) {
  const cats = (window.allCategories || []).filter(c => c.type === type);
  const el = document.getElementById('mov-category');
  if (!el) return;
  el.innerHTML = '<option value="">Seleziona categoria</option>' +
    cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

// ============================================
// UI HELPERS
// ============================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

async function showView(name) {
  // Controllo accessi
  const ownerOnly = ['impostazioni', 'team', 'hr'];
  const adminOnly = ['storico', 'report', 'banca', 'fornitori'];
  if (ownerOnly.includes(name) && currentRole !== 'owner') {
    showToast('Accesso non autorizzato', 'error'); return;
  }
  if (adminOnly.includes(name) && currentRole === 'cashier') {
    showToast('Accesso non autorizzato', 'error'); return;
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === name);
  });
  const titles = { dashboard: 'Dashboard', primanota: 'Prima Nota', nuovo: 'Movimenti extra cassa', movimenti: 'Movimenti', report: 'Report', sedi: 'Sedi', team: 'Team' };
  document.getElementById('page-title').textContent = titles[name] || name;

  if (name === 'movimenti') loadMovimenti();
  if (name === 'report') loadReport();
  if (name === 'sedi') renderLocationsList();
  if (name === 'team') loadTeam();
  if (name === 'primanota') {
    // Ricarica cache fornitori e causali prima di inizializzare
    if (currentBusiness) {
      const [{ data: forn }] = await Promise.all([
        db.from('fornitori').select('id,ragione_sociale')
          .eq('business_id', currentBusiness.id).eq('attivo', true).order('ragione_sociale')
      ]);
      fornitoriCache = forn || [];
      await loadCausaliCache();
    }
    initPrimaNota();
    buildPNPrelievoSelects();
  }
  if (name === 'storico') initStorico();
  if (name === 'banca') initBanca();
  if (name === 'fornitori') initFornitori();
  if (name === 'impostazioni') initImpostazioni();
  if (name === 'hr') initHR();
}

function updateUserUI() {
  const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '?';
  const initial = name[0].toUpperCase();
  document.getElementById('user-avatar').textContent = initial;
  document.getElementById('user-name-sidebar').textContent = name;
  document.getElementById('business-name-sidebar').textContent = currentBusiness?.name || '—';

  // Controllo accessi per ruolo
  const isOwner = currentRole === 'owner';
  const isAdmin = currentRole === 'admin' || isOwner;
  const isCashier = currentRole === 'cashier';

  // Per i cassieri usa i permessi personalizzati
  const perms = window.userPerms || {};

  document.querySelectorAll('.nav-item').forEach(btn => {
    const view = btn.dataset.view;
    if (!view) return;

    let visible = true;

    if (isOwner) {
      visible = true; // owner vede tutto
    } else if (isAdmin) {
      visible = !['team','impostazioni'].includes(view);
    } else if (isCashier) {
      // Cassiere vede solo quello che gli è stato abilitato
      const permMap = {
        dashboard: true,
        primanota: true,
        sedi: true,
        movimenti: perms.movimenti,
        storico: perms.storico,
        report: perms.report,
        banca: perms.banca,
        fornitori: perms.fornitori,
        team: false,
        impostazioni: false
      };
      visible = permMap[view] ?? false;
    }

    btn.style.display = visible ? 'flex' : 'none';
  });

  // Mostra badge ruolo nella sidebar
  const roleLabels = { owner: 'Owner', admin: 'Admin', cashier: 'Cassiere' };
  document.getElementById('business-name-sidebar').textContent =
    (currentBusiness?.name || '—') + ' · ' + (roleLabels[currentRole] || '');
}

function setType(type) {
  selectedType = type;
  document.getElementById('btn-entrata').classList.toggle('active', type === 'entrata');
  document.getElementById('btn-uscita').classList.toggle('active', type === 'uscita');
  filterCategoriesByType(type);
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatEur(n) {
  return '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT');
}

const paymentLabels = {
  contanti: '💵 Contanti', carta: '💳 Carta',
  bonifico: '🏦 Bonifico', assegno: '📝 Assegno', altro: '📌 Altro'
};

// ============================================
// DASHBOARD
// ============================================
async function loadDashboard() {
  if (!currentBusiness) return;
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  let query = db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id);

  if (selectedLocation) query = query.eq('location_id', selectedLocation);

  const { data: allData } = await query;
  const all = allData || [];

  const todayData = all.filter(e => e.entry_date === today);
  const monthData = all.filter(e => e.entry_date >= firstDay);

  const todayIn = todayData.filter(e => e.type === 'entrata').reduce((s, e) => s + Number(e.amount), 0);
  const todayOut = todayData.filter(e => e.type === 'uscita').reduce((s, e) => s + Number(e.amount), 0);
  const monthIn = monthData.filter(e => e.type === 'entrata').reduce((s, e) => s + Number(e.amount), 0);
  const monthOut = monthData.filter(e => e.type === 'uscita').reduce((s, e) => s + Number(e.amount), 0);

  document.getElementById('kpi-entrate').textContent = formatEur(todayIn);
  document.getElementById('kpi-uscite').textContent = formatEur(todayOut);
  document.getElementById('kpi-saldo').textContent = formatEur(todayIn - todayOut);
  document.getElementById('kpi-mese').textContent = formatEur(monthIn - monthOut);
  document.getElementById('kpi-entrate-count').textContent = todayData.filter(e => e.type === 'entrata').length + ' movimenti';
  document.getElementById('kpi-uscite-count').textContent = todayData.filter(e => e.type === 'uscita').length + ' movimenti';

  const recent = [...all].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
  renderEntries(recent, 'recent-entries');
  loadCharts();
  loadPrevisioni();
}

// ============================================
// MOVIMENTI
// ============================================
async function loadMovimenti() {
  if (!currentBusiness) return;

  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  const type = document.getElementById('filter-type').value;
  const payment = document.getElementById('filter-payment').value;

  let query = db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);
  if (type) query = query.eq('type', type);
  if (payment) query = query.eq('payment_method', payment);
  if (selectedLocation) query = query.eq('location_id', selectedLocation);

  const { data } = await query;
  const entries = data || [];

  const totIn = entries.filter(e => e.type === 'entrata').reduce((s, e) => s + Number(e.amount), 0);
  const totOut = entries.filter(e => e.type === 'uscita').reduce((s, e) => s + Number(e.amount), 0);

  document.getElementById('ft-entrate').textContent = formatEur(totIn);
  document.getElementById('ft-uscite').textContent = formatEur(totOut);
  document.getElementById('ft-saldo').textContent = formatEur(totIn - totOut);

  renderEntries(entries, 'all-entries', true);
}

function renderEntries(entries, containerId, showDate = false) {
  const el = document.getElementById(containerId);
  if (!entries.length) { el.innerHTML = '<div class="empty-state">Nessun movimento trovato</div>'; return; }

  el.innerHTML = entries.map(e => {
    const cat = (window.allCategories || []).find(c => c.id === e.category_id);
    const catName = cat ? `${cat.icon} ${cat.name}` : '—';
    const loc = currentLocations.find(l => l.id === e.location_id);
    const meta = [
      showDate ? formatDate(e.entry_date) : null,
      catName,
      paymentLabels[e.payment_method] || e.payment_method,
      loc ? loc.name : null
    ].filter(Boolean).join(' · ');

    return `
      <div class="entry-item">
        <div class="entry-dot ${e.type}"></div>
        <div class="entry-info">
          <div class="entry-desc">${e.description || (e.type === 'entrata' ? 'Entrata' : 'Uscita')}</div>
          <div class="entry-meta">${meta}</div>
        </div>
        <div class="entry-amount ${e.type}">${e.type === 'entrata' ? '+' : '-'}${formatEur(e.amount)}</div>
        <div class="entry-actions">
          <button class="entry-del" onclick="deleteEntry('${e.id}')" title="Elimina">✕</button>
        </div>
      </div>`;
  }).join('');
}

async function saveMovimento() {
  if (!currentBusiness) return;

  const amount = parseFloat(document.getElementById('mov-amount').value);
  const date = document.getElementById('mov-date').value;
  const category = document.getElementById('mov-category').value;
  const payment = document.getElementById('mov-payment').value;
  const location = document.getElementById('mov-location').value;
  const description = document.getElementById('mov-description').value.trim();
  const notes = document.getElementById('mov-notes').value.trim();

  if (!amount || amount <= 0) { showMovMsg('Inserisci un importo valido', 'error'); return; }
  if (!date) { showMovMsg('Seleziona una data', 'error'); return; }

  const { error } = await db.from('cash_entries').insert({
    business_id: currentBusiness.id,
    location_id: location || null,
    user_id: currentUser.id,
    category_id: category || null,
    type: selectedType,
    amount,
    description: description || null,
    payment_method: payment,
    entry_date: date,
    notes: notes || null
  });

  if (error) { showMovMsg('Errore: ' + error.message, 'error'); return; }

  showToast('Movimento salvato ✓', 'success');
  document.getElementById('mov-amount').value = '';
  document.getElementById('mov-description').value = '';
  document.getElementById('mov-notes').value = '';

  await loadDashboard();
  showView('dashboard');
}

function showMovMsg(msg, type) {
  const el = document.getElementById('mov-message');
  el.textContent = msg;
  el.className = 'auth-message ' + type;
  setTimeout(() => el.textContent = '', 3000);
}

async function deleteEntry(id) {
  
  const { error } = await db.from('cash_entries').delete().eq('id', id);
  if (error) { showToast('Errore eliminazione', 'error'); return; }
  showToast('Movimento eliminato', 'success');
  await loadDashboard();
  await loadMovimenti();
}

// ============================================
// EXPORT CSV
// ============================================
async function exportCSV() {
  if (!currentBusiness) return;

  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;

  let query = db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .order('entry_date', { ascending: false });

  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);

  const { data } = await query;
  if (!data?.length) { showToast('Nessun dato da esportare', ''); return; }

  const header = ['Data', 'Tipo', 'Importo', 'Categoria', 'Metodo', 'Descrizione', 'Note'];
  const rows = data.map(e => {
    const cat = (window.allCategories || []).find(c => c.id === e.category_id);
    return [
      e.entry_date, e.type, e.amount,
      cat ? cat.name : '', e.payment_method || '',
      e.description || '', e.notes || ''
    ].map(v => `"${v}"`).join(',');
  });

  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kontro_${from}_${to}.csv`;
  a.click();
  showToast('CSV scaricato ✓', 'success');
}

// ============================================
// REPORT
// ============================================
function populateReportSelects() {
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const monthEl = document.getElementById('report-month');
  const yearEl = document.getElementById('report-year');
  if (!monthEl) return;

  months.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i + 1;
    o.textContent = m;
    if (i === new Date().getMonth()) o.selected = true;
    monthEl.appendChild(o);
  });

  for (let y = new Date().getFullYear(); y >= 2023; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === new Date().getFullYear()) o.selected = true;
    yearEl.appendChild(o);
  }
}

async function loadReport() {
  if (!currentBusiness) return;

  const month = parseInt(document.getElementById('report-month').value);
  const year = parseInt(document.getElementById('report-year').value);
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

  const { data } = await db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .gte('entry_date', from).lte('entry_date', to);

  const entries = data || [];
  const totIn = entries.filter(e => e.type === 'entrata').reduce((s, e) => s + Number(e.amount), 0);
  const totOut = entries.filter(e => e.type === 'uscita').reduce((s, e) => s + Number(e.amount), 0);
  const saldo = totIn - totOut;

  const methodGroups = {};
  entries.forEach(e => {
    const m = e.payment_method || 'altro';
    if (!methodGroups[m]) methodGroups[m] = 0;
    methodGroups[m] += Number(e.amount);
  });

  document.getElementById('report-content').innerHTML = `
    <div class="report-row"><span class="label">Totale entrate</span><span class="val-positive">${formatEur(totIn)}</span></div>
    <div class="report-row"><span class="label">Totale uscite</span><span class="val-negative">${formatEur(totOut)}</span></div>
    <div class="report-row"><span class="label">Saldo netto</span><span class="${saldo >= 0 ? 'val-neutral' : 'val-negative'}">${formatEur(saldo)}</span></div>
    <div class="report-row"><span class="label">Numero movimenti</span><span class="val-neutral">${entries.length}</span></div>
    <hr style="border-color:rgba(255,255,255,0.05);margin:8px 0">
    ${Object.entries(methodGroups).map(([m, v]) =>
      `<div class="report-row"><span class="label">${paymentLabels[m] || m}</span><span class="val-neutral">${formatEur(v)}</span></div>`
    ).join('')}
  `;

  // Categorie
  const catGroups = {};
  entries.forEach(e => {
    const cat = (window.allCategories || []).find(c => c.id === e.category_id);
    const key = cat ? `${cat.icon} ${cat.name}` : '—';
    if (!catGroups[key]) catGroups[key] = { total: 0, type: e.type, color: cat?.color || '#6b7280' };
    catGroups[key].total += Number(e.amount);
  });

  const maxVal = Math.max(...Object.values(catGroups).map(c => c.total), 1);
  document.getElementById('report-categories').innerHTML = Object.entries(catGroups)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => `
      <div class="cat-row">
        <span class="cat-name">${name}</span>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${(data.total/maxVal*100)}%;background:${data.color}"></div></div>
        <span class="cat-total">${formatEur(data.total)}</span>
      </div>`
    ).join('') || '<div class="empty-state">Nessun dato</div>';
}

// ============================================
// SEDI
// ============================================
function showAddLocation() { document.getElementById('add-location-form').classList.remove('hidden'); }
function hideAddLocation() { document.getElementById('add-location-form').classList.add('hidden'); }

async function saveLocation() {
  const name = document.getElementById('new-loc-name').value.trim();
  const address = document.getElementById('new-loc-address').value.trim();
  if (!name) { showToast('Inserisci il nome della sede', 'error'); return; }

  const { error } = await db.from('locations').insert({
    business_id: currentBusiness.id,
    name, address: address || null
  });

  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  showToast('Sede aggiunta ✓', 'success');
  hideAddLocation();
  document.getElementById('new-loc-name').value = '';
  document.getElementById('new-loc-address').value = '';
  await loadLocations();
}

function renderLocationsList() {
  const el = document.getElementById('locations-list');
  if (!currentLocations.length) {
    el.innerHTML = '<div class="empty-state">Nessuna sede aggiuntiva configurata</div>';
    return;
  }
  el.innerHTML = currentLocations.map(l => `
    <div class="location-card">
      <div class="loc-name">◉ ${l.name}</div>
      ${l.address ? `<div class="loc-addr">${l.address}</div>` : ''}
    </div>`).join('');
}

// ============================================
// TEAM MANAGEMENT
// ============================================
function showInviteForm() { document.getElementById('invite-form').classList.remove('hidden'); }
function hideInviteForm() { document.getElementById('invite-form').classList.add('hidden'); }

async function loadTeam() {
  if (!currentBusiness) return;

  // Carica membri attivi
  const { data: roles } = await db
    .from('user_roles')
    .select('role, profiles(id, full_name, email)')
    .eq('business_id', currentBusiness.id);

  const membersEl = document.getElementById('team-members');
  if (!roles?.length) {
    membersEl.innerHTML = '<div class="empty-state">Nessun membro</div>';
  } else {
    membersEl.innerHTML = roles.map(r => {
      const p = r.profiles;
      const initial = (p?.full_name || p?.email || '?')[0].toUpperCase();
      const isCashier = r.role === 'cashier';
      return `
        <div class="member-item">
          <div class="member-avatar">${initial}</div>
          <div class="member-info">
            <div class="member-name">${p?.full_name || '—'}</div>
            <div class="member-email">${p?.email || '—'}</div>
          </div>
          <span class="role-badge ${r.role}">${roleLabel(r.role)}</span>
          ${isCashier && currentRole === 'owner' ? `
            <button class="btn-secondary sm" onclick="apriModalPermessi('${p?.id}','${p?.full_name || p?.email}','${r.role}')">
              🔑 Permessi
            </button>` : ''}
        </div>`;
    }).join('');
  }

  // Carica inviti pendenti
  const { data: invites } = await db
    .from('invites')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString());

  const invitesEl = document.getElementById('team-invites');
  if (!invites?.length) {
    invitesEl.innerHTML = '<div class="empty-state">Nessun invito pendente</div>';
  } else {
    invitesEl.innerHTML = invites.map(inv => `
      <div class="invite-item">
        <span style="font-size:18px">✉</span>
        <div class="invite-email">${inv.email}</div>
        <span class="role-badge ${inv.role}">${roleLabel(inv.role)}</span>
        <span class="invite-expires">scade ${formatDate(inv.expires_at)}</span>
        <button class="invite-del" onclick="copyInviteLink('${inv.token}')" title="Copia link invito">🔗</button>
        <button class="invite-del" onclick="deleteInvite('${inv.id}')" title="Elimina">✕</button>
      </div>`).join('');
  }
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', cashier: 'Cassiere' }[role] || role;
}

async function sendInvite() {
  if (!currentBusiness) return;
  const email = document.getElementById('invite-email').value.trim();
  const role = document.getElementById('invite-role').value;
  const msgEl = document.getElementById('invite-message');

  if (!email) { msgEl.textContent = 'Inserisci una email'; msgEl.className = 'auth-message error'; return; }

  msgEl.textContent = 'Invio in corso...'; msgEl.className = 'auth-message';

  // Crea invito nel DB
  const { data: invite, error } = await db
    .from('invites')
    .insert({
      business_id: currentBusiness.id,
      email,
      role,
      created_by: currentUser.id
    })
    .select().single();

  if (error) { msgEl.textContent = 'Errore: ' + error.message; msgEl.className = 'auth-message error'; return; }

  // Genera il link di invito
  const link = `${window.location.origin}?invite=${invite.token}`;

  // Invia email tramite API
  try {
    const resp = await fetch('/api/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        role,
        inviteLink: link,
        businessName: currentBusiness.name
      })
    });

    const result = await resp.json();

    if (resp.ok) {
      msgEl.textContent = '✓ Email inviata a ' + email;
      msgEl.className = 'auth-message success';
    } else {
      // Fallback: copia link negli appunti
      await navigator.clipboard.writeText(link).catch(() => {});
      msgEl.textContent = '⚠ Email non inviata. Link copiato negli appunti.';
      msgEl.className = 'auth-message error';
    }
  } catch {
    // Fallback: copia link negli appunti
    await navigator.clipboard.writeText(link).catch(() => {});
    msgEl.textContent = '⚠ Email non inviata. Link copiato negli appunti.';
    msgEl.className = 'auth-message error';
  }

  document.getElementById('invite-email').value = '';
  await loadTeam();
}

async function copyInviteLink(token) {
  const link = `${window.location.origin}?invite=${token}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link invito copiato ✓', 'success');
  } catch {
    showToast(link, '');
  }
}

async function deleteInvite(id) {
  if (!confirm('Eliminare questo invito?')) return;
  await db.from('invites').delete().eq('id', id);
  showToast('Invito eliminato', 'success');
  await loadTeam();
}

// Gestione invito in arrivo (quando utente clicca il link)
async function checkInviteToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (!token) return false;

  const { data: invite } = await db
    .from('invites')
    .select('*')
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!invite) {
    showToast('Invito non valido o scaduto', 'error');
    return false;
  }

  // Pre-compila email nel form registrazione
  document.getElementById('reg-email').value = invite.email;
  switchTab('register');

  // Salva token per dopo la registrazione
  window._pendingInviteToken = token;
  window._pendingInvite = invite;

  showToast('Sei stato invitato come ' + roleLabel(invite.role), 'success');
  return true;
}

// Collega utente appena registrato all'azienda tramite invito
async function applyInvite(userId) {
  if (!window._pendingInvite) return;
  const inv = window._pendingInvite;

  await db.from('user_roles').insert({
    user_id: userId,
    business_id: inv.business_id,
    role: inv.role
  }).onConflict('user_id, business_id').ignore();

  await db.from('invites').update({ used: true }).eq('id', inv.id);

  window._pendingInvite = null;
  window._pendingInviteToken = null;
}

// ============================================
// GRAFICI
// ============================================
let chartWeekly = null;
let chartCategories = null;

async function loadCharts() {
  if (!currentBusiness) return;

  // Ultimi 7 giorni
  const days = [];
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
    labels.push(d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }));
  }

  const from = days[0];
  const to = days[days.length - 1];

  let query = db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .gte('entry_date', from)
    .lte('entry_date', to);

  if (selectedLocation) query = query.eq('location_id', selectedLocation);

  const { data } = await query;
  const entries = data || [];

  // Dati per grafico settimanale
  const entratePerDay = days.map(d =>
    entries.filter(e => e.entry_date === d && e.type === 'entrata')
           .reduce((s, e) => s + Number(e.amount), 0)
  );
  const uscitePerDay = days.map(d =>
    entries.filter(e => e.entry_date === d && e.type === 'uscita')
           .reduce((s, e) => s + Number(e.amount), 0)
  );

  // Grafico settimanale
  const ctxW = document.getElementById('chart-weekly');
  if (ctxW) {
    if (chartWeekly) chartWeekly.destroy();
    chartWeekly = new Chart(ctxW, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Entrate',
            data: entratePerDay,
            backgroundColor: 'rgba(16, 185, 129, 0.7)',
            borderColor: 'rgba(16, 185, 129, 1)',
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: 'Uscite',
            data: uscitePerDay,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderColor: 'rgba(239, 68, 68, 1)',
            borderWidth: 1,
            borderRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: { color: '#9ca3af', font: { family: 'DM Mono', size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => ' € ' + ctx.parsed.y.toLocaleString('it-IT', { minimumFractionDigits: 2 })
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#6b7280', font: { family: 'DM Mono', size: 11 } },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            ticks: {
              color: '#6b7280',
              font: { family: 'DM Mono', size: 11 },
              callback: v => '€ ' + v.toLocaleString('it-IT')
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  // Dati per grafico categorie (mese corrente)
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const { data: monthData } = await db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .gte('entry_date', firstDay);

  const catGroups = {};
  (monthData || []).forEach(e => {
    const cat = (window.allCategories || []).find(c => c.id === e.category_id);
    const key = cat ? cat.name : 'Altro';
    const color = cat ? cat.color : '#6b7280';
    if (!catGroups[key]) catGroups[key] = { total: 0, color };
    catGroups[key].total += Number(e.amount);
  });

  const catLabels = Object.keys(catGroups);
  const catValues = catLabels.map(k => catGroups[k].total);
  const catColors = catLabels.map(k => catGroups[k].color);

  const ctxC = document.getElementById('chart-categories');
  if (ctxC) {
    if (chartCategories) chartCategories.destroy();
    if (catLabels.length === 0) {
      ctxC.parentElement.querySelector('canvas').style.display = 'none';
      return;
    }
    chartCategories = new Chart(ctxC, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catValues,
          backgroundColor: catColors.map(c => c + 'cc'),
          borderColor: catColors,
          borderWidth: 1,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#9ca3af',
              font: { family: 'DM Mono', size: 11 },
              padding: 12,
              boxWidth: 12
            }
          },
          tooltip: {
            callbacks: {
              label: ctx => ' € ' + ctx.parsed.toLocaleString('it-IT', { minimumFractionDigits: 2 })
            }
          }
        },
        cutout: '65%'
      }
    });
  }
}

// ============================================
// EXPORT PDF
// ============================================
async function exportPDF() {
  if (!currentBusiness) return;

  const month = parseInt(document.getElementById('report-month').value);
  const year = parseInt(document.getElementById('report-year').value);
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                      'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

  showToast('Generazione PDF...', '');

  const { data } = await db.from('cash_entries').select('*')
    .eq('business_id', currentBusiness.id)
    .gte('entry_date', from).lte('entry_date', to)
    .order('entry_date', { ascending: true });

  const entries = data || [];
  const totIn = entries.filter(e => e.type === 'entrata').reduce((s, e) => s + Number(e.amount), 0);
  const totOut = entries.filter(e => e.type === 'uscita').reduce((s, e) => s + Number(e.amount), 0);
  const saldo = totIn - totOut;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210;
  const margin = 16;
  let y = 0;

  // ---- HEADER ----
  doc.setFillColor(10, 15, 30);
  doc.rect(0, 0, W, 40, 'F');

  // Logo K
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(margin, 10, 18, 18, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('K', margin + 9, 22, { align: 'center' });

  // Titolo
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('KONTRO', margin + 22, 22);

  // Data generazione
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(156, 163, 175);
  doc.text('Generato il ' + new Date().toLocaleDateString('it-IT'), W - margin, 22, { align: 'right' });

  y = 48;

  // ---- TITOLO REPORT ----
  doc.setTextColor(30, 40, 70);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Report ${monthNames[month - 1]} ${year}`, margin, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text(currentBusiness.name, margin, y + 6);

  y += 18;

  // ---- KPI BOX ----
  const kpiW = (W - margin * 2 - 8) / 3;

  // Entrate
  doc.setFillColor(16, 185, 129, 0.1);
  doc.setFillColor(236, 253, 245);
  doc.roundedRect(margin, y, kpiW, 22, 3, 3, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('ENTRATE', margin + 4, y + 7);
  doc.setFontSize(13);
  doc.text(formatEur(totIn), margin + 4, y + 16);

  // Uscite
  const x2 = margin + kpiW + 4;
  doc.setFillColor(254, 242, 242);
  doc.roundedRect(x2, y, kpiW, 22, 3, 3, 'F');
  doc.setTextColor(239, 68, 68);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('USCITE', x2 + 4, y + 7);
  doc.setFontSize(13);
  doc.text(formatEur(totOut), x2 + 4, y + 16);

  // Saldo
  const x3 = margin + (kpiW + 4) * 2;
  doc.setFillColor(saldo >= 0 ? 239 : 254, saldo >= 0 ? 246 : 242, saldo >= 0 ? 255 : 242);
  doc.roundedRect(x3, y, kpiW, 22, 3, 3, 'F');
  doc.setTextColor(saldo >= 0 ? 37 : 239, saldo >= 0 ? 99 : 68, saldo >= 0 ? 235 : 68);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SALDO NETTO', x3 + 4, y + 7);
  doc.setFontSize(13);
  doc.text(formatEur(saldo), x3 + 4, y + 16);

  y += 30;

  // ---- TABELLA MOVIMENTI ----
  doc.setTextColor(10, 15, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Dettaglio movimenti', margin, y);
  y += 6;

  // Header tabella
  doc.setFillColor(10, 15, 30);
  doc.rect(margin, y, W - margin * 2, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DATA', margin + 2, y + 5);
  doc.text('DESCRIZIONE', margin + 22, y + 5);
  doc.text('CATEGORIA', margin + 90, y + 5);
  doc.text('METODO', margin + 130, y + 5);
  doc.text('IMPORTO', W - margin - 2, y + 5, { align: 'right' });
  y += 9;

  // Righe
  doc.setFont('helvetica', 'normal');
  entries.forEach((e, i) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 3, W - margin * 2, 7, 'F');
    }

    const cat = (window.allCategories || []).find(c => c.id === e.category_id);
    const isEntrata = e.type === 'entrata';

    doc.setTextColor(107, 114, 128);
    doc.setFontSize(8);
    doc.text(formatDate(e.entry_date), margin + 2, y + 2);

    doc.setTextColor(10, 15, 30);
    const desc = (e.description || (isEntrata ? 'Entrata' : 'Uscita')).substring(0, 35);
    doc.text(desc, margin + 22, y + 2);

    doc.setTextColor(107, 114, 128);
    doc.text((cat ? cat.name : '—').substring(0, 18), margin + 90, y + 2);
    doc.text((e.payment_method || '—'), margin + 130, y + 2);

    isEntrata ? doc.setTextColor(16, 185, 129) : doc.setTextColor(239, 68, 68);
    doc.setFont('helvetica', 'bold');
    doc.text((isEntrata ? '+' : '-') + formatEur(e.amount), W - margin - 2, y + 2, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += 7;
  });

  if (entries.length === 0) {
    doc.setTextColor(156, 163, 175);
    doc.setFontSize(9);
    doc.text('Nessun movimento nel periodo selezionato', margin + 2, y + 4);
    y += 10;
  }

  // ---- TOTALE FINALE ----
  y += 4;
  doc.setDrawColor(10, 15, 30);
  doc.setLineWidth(0.3);
  doc.line(margin, y, W - margin, y);
  y += 6;

  doc.setFillColor(10, 15, 30);
  doc.rect(margin, y, W - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTALE', margin + 2, y + 5.5);
  doc.setTextColor(saldo >= 0 ? 52 : 248, saldo >= 0 ? 211 : 113, saldo >= 0 ? 153 : 113);
  doc.text(formatEur(saldo), W - margin - 2, y + 5.5, { align: 'right' });

  // ---- FOOTER ----
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text('KONTRO — Prima nota digitale · www.kontro.cloud', margin, 290);
    doc.text(`Pagina ${i} di ${pageCount}`, W - margin, 290, { align: 'right' });
  }

  // Salva
  const filename = `KONTRO_Report_${monthNames[month-1]}_${year}_${currentBusiness.name.replace(/\s/g,'_')}.pdf`;
  doc.save(filename);
  showToast('PDF scaricato ✓', 'success');
}

// ============================================
// PRIMA NOTA
// ============================================
let pnFornitoriRows = [];
let pnPrelieviRows = [];

// [rimossa versione obsoleta initPrimaNota v1]

// ── RIGHE DINAMICHE ───────────────────────────────────────────────
function buildFornitoriRows(n) {
  pnFornitoriRows = [];
  const tbody = document.getElementById('tbody-fornitori');
  tbody.innerHTML = '';
  for (let i = 0; i < n; i++) addFornitoreRow(false);
}

function buildPrelieviRows(n) {
  pnPrelieviRows = [];
  const tbody = document.getElementById('tbody-prelievi');
  tbody.innerHTML = '';
  for (let i = 0; i < n; i++) addPrelievRow(false);
}

function addFornitoreRow(recalc = true) {
  const tbody = document.getElementById('tbody-fornitori');
  const idx = pnFornitoriRows.length;
  const tr = document.createElement('tr');

  const desc = document.createElement('input');
  desc.type = 'text'; desc.placeholder = 'Fornitore...'; desc.className = 'pn-desc-input';

  const im = mkPNInput(); const ip = mkPNInput(); const is = mkPNInput();
  pnFornitoriRows.push({ desc, im, ip, is });

  const tdDesc = document.createElement('td'); tdDesc.className = 'td-desc';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px';
  wrap.appendChild(desc);
  if (idx >= 5) {
    const rm = document.createElement('button');
    rm.textContent = '×'; rm.className = 'pn-remove-btn';
    rm.onclick = () => {
      const i = pnFornitoriRows.findIndex(r => r.im === im);
      if (i >= 0) pnFornitoriRows.splice(i, 1);
      tr.remove(); calcPN();
    };
    wrap.appendChild(rm);
  }
  tdDesc.appendChild(wrap);

  const totEl = document.createElement('td');
  totEl.className = 'td-tot'; totEl.textContent = '€ 0,00';

  tr.appendChild(tdDesc);
  tr.appendChild(mkPNTd(im)); tr.appendChild(mkPNTd(ip)); tr.appendChild(mkPNTd(is));
  tr.appendChild(totEl);
  tbody.appendChild(tr);

  [im, ip, is].forEach(el => el.oninput = () => {
    const tot = (parseFloat(im.value)||0) + (parseFloat(ip.value)||0) + (parseFloat(is.value)||0);
    totEl.textContent = fmtPN(tot);
    calcPN();
  });

  if (recalc) calcPN();
}

function addPrelievRow(recalc = true) {
  const tbody = document.getElementById('tbody-prelievi');
  const idx = pnPrelieviRows.length;
  const tr = document.createElement('tr');

  const desc = document.createElement('input');
  desc.type = 'text'; desc.placeholder = 'Causale...'; desc.className = 'pn-desc-input';

  const im = mkPNInput(); const ip = mkPNInput(); const is = mkPNInput();
  pnPrelieviRows.push({ desc, im, ip, is });

  const tdDesc = document.createElement('td'); tdDesc.className = 'td-desc';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px';
  wrap.appendChild(desc);
  if (idx >= 3) {
    const rm = document.createElement('button');
    rm.textContent = '×'; rm.className = 'pn-remove-btn';
    rm.onclick = () => {
      const i = pnPrelieviRows.findIndex(r => r.im === im);
      if (i >= 0) pnPrelieviRows.splice(i, 1);
      tr.remove(); calcPN();
    };
    wrap.appendChild(rm);
  }
  tdDesc.appendChild(wrap);

  const totEl = document.createElement('td');
  totEl.className = 'td-tot'; totEl.textContent = '€ 0,00';

  tr.appendChild(tdDesc);
  tr.appendChild(mkPNTd(im)); tr.appendChild(mkPNTd(ip)); tr.appendChild(mkPNTd(is));
  tr.appendChild(totEl);
  tbody.appendChild(tr);

  [im, ip, is].forEach(el => el.oninput = () => {
    const tot = (parseFloat(im.value)||0) + (parseFloat(ip.value)||0) + (parseFloat(is.value)||0);
    totEl.textContent = fmtPN(tot);
    calcPN();
  });

  if (recalc) calcPN();
}

function mkPNInput() {
  const i = document.createElement('input');
  i.type = 'number'; i.step = '0.01'; i.placeholder = '—'; i.className = 'pn-input';
  return i;
}

function mkPNTd(child) {
  const td = document.createElement('td');
  if (child) td.appendChild(child);
  return td;
}

function fmtPN(n) {
  return '€ ' + Math.abs(n||0).toFixed(2).replace('.', ',');
}

function getPN(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

function sumTurni(id) {
  return getPN(id+'-m') + getPN(id+'-p') + getPN(id+'-s');
}

function setPN(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = fmtPN(val);
}

// ── CALCOLO ───────────────────────────────────────────────────────

// ── CARICA/SALVA ──────────────────────────────────────────────────
async function loadNotaGiorno() {
  if (!currentBusiness) return;
  const data = document.getElementById('pn-data').value;
  const locId = document.getElementById('pn-location').value || null;
  if (!data) return;

  let query = db.from('daily_notes').select('*, daily_note_rows(*)')
    .eq('business_id', currentBusiness.id)
    .eq('data', data);

  if (locId) query = query.eq('location_id', locId);
  // Non filtriamo per null esplicitamente — prendiamo il record e controlliamo
  const { data: noteList } = await query.order('created_at', { ascending: false }).limit(10);
  const nota = (noteList || []).find(n => locId ? n.location_id === locId : !n.location_id) || null;

  resetPN(false);
  if (!nota) return;

  // Popola campi fissi
  document.getElementById('pn-fc').value = nota.fondo_cassa || '';
  const campi = ['incasso','money','sisal','fatture','giornali','pos','carte','bonifici','fc-usc'];
  campi.forEach(k => {
    const key = k.replace('-','_');
    ['m','p','s'].forEach(t => {
      const el = document.getElementById(k+'-'+t);
      if (el) el.value = nota[key+'_'+t] || '';
    });
  });

  document.getElementById('cm').value = nota.compilatore_m || '';
  document.getElementById('cp').value = nota.compilatore_p || '';
  document.getElementById('cs').value = nota.compilatore_s || '';
  document.getElementById('pn-note').value = nota.note || '';

  // Popola righe dinamiche
  if (nota.daily_note_rows?.length) {
    const fornitori = nota.daily_note_rows.filter(r => r.categoria === 'fornitore');
    const prelievi = nota.daily_note_rows.filter(r => r.categoria === 'prelievo');

    buildFornitoriRows(Math.max(5, fornitori.length));
    fornitori.forEach((r, i) => {
      if (pnFornitoriRows[i]) {
        pnFornitoriRows[i].desc.value = r.descrizione || '';
        pnFornitoriRows[i].im.value = r.importo_m || '';
        pnFornitoriRows[i].ip.value = r.importo_p || '';
        pnFornitoriRows[i].is.value = r.importo_s || '';
      }
    });

    buildPrelieviRows(Math.max(3, prelievi.length));
    prelievi.forEach((r, i) => {
      if (pnPrelieviRows[i]) {
        pnPrelieviRows[i].desc.value = r.descrizione || '';
        pnPrelieviRows[i].im.value = r.importo_m || '';
        pnPrelieviRows[i].ip.value = r.importo_p || '';
        pnPrelieviRows[i].is.value = r.importo_s || '';
      }
    });
  }

  calcPN();
}


function resetPN(rebuild = true) {
  const campi = ['pn-fc','incasso-m','incasso-p','incasso-s','money-m','money-p','money-s',
    'grattavinci-m','grattavinci-p','grattavinci-s','sisal-m','sisal-p','sisal-s','fatture-m','fatture-p','fatture-s','giornali-m','giornali-p','giornali-s','conto-bet-m','conto-bet-p','conto-bet-s',
    'pos-m','pos-p','pos-s','carte-m','carte-p','carte-s','bonifici-m','bonifici-p','bonifici-s',
    'fc-usc-m','fc-usc-p','fc-usc-s','cm','cp','cs','pn-note'];
  campi.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (rebuild) { buildFornitoriRows(5); buildPrelieviRows(3); }
  calcPN();
}

function showPNMsg(msg, type) {
  const el = document.getElementById('pn-msg');
  el.textContent = msg;
  el.className = 'auth-message ' + type;
  setTimeout(() => el.textContent = '', 4000);
}

// ============================================
// PRIMA NOTA v2 — Struttura statica
// ============================================
let pnFornitoriCount = 5;
let pnPrelieviCount = 3;

function initPrimaNota() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('pn-data').value = today;
  const sel = document.getElementById('pn-location');
  if (sel) {
    sel.innerHTML = '<option value="">Sede principale</option>' +
      currentLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  }
  _buildPNFornitoriSelects();
  populatePNBetSelect();
  calcPN2();
  loadNotaGiorno2();
}

function _buildPNFornitoriSelects() {
  const optsHtml = '<option value="">— Fornitore —</option>' +
    (fornitoriCache||[]).map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');
  for (let i = 0; i < 20; i++) {
    const el = document.getElementById('fdesc-' + i);
    if (!el) break;
    if (el.tagName === 'SELECT') {
      const val = el.value;
      el.innerHTML = optsHtml;
      if (val) el.value = val;
    } else if (el.tagName === 'INPUT') {
      const sel = document.createElement('select');
      sel.id = 'fdesc-' + i;
      sel.className = 'pn-desc-input';
      sel.innerHTML = optsHtml;
      el.parentNode.replaceChild(sel, el);
    }
  }
}

function getV(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

function calcPN2() {
  const fc = getV('pn-fc');
  const vociFisse = ['incasso','money','grattavinci','sisal','conto-bet','fatture','giornali'];
  const uscVoci = ['pos','carte','bonifici'];

  // Come Love Me effFixed ma con 3 colonne:
  // S sovrascrive P, P sovrascrive M
  // Se sera è compilata → usa sera (= totale giornata)
  // Se pomeriggio è compilato → usa pomeriggio (= totale fino al PM)
  // Altrimenti → usa mattina
  function eff3(idM, idP, idS) {
    const s = document.getElementById(idS), p = document.getElementById(idP), m = document.getElementById(idM);
    if (s && s.value.trim() !== '') return parseFloat(s.value) || 0;
    if (p && p.value.trim() !== '') return parseFloat(p.value) || 0;
    return parseFloat(m?.value) || 0;
  }
  function eff2(idM, idP) {
    const p = document.getElementById(idP), m = document.getElementById(idM);
    if (p && p.value.trim() !== '') return parseFloat(p.value) || 0;
    return parseFloat(m?.value) || 0;
  }

  // ── Fornitori ──
  let fM=0, fP=0, fS=0;
  for (let i = 0; i < pnFornitoriCount; i++) {
    fM += getV('fm-'+i);
    fP += eff2('fm-'+i, 'fp-'+i);
    fS += eff3('fm-'+i, 'fp-'+i, 'fs-'+i);
  }

  // ── Prelievi ──
  let prlM=0, prlP=0, prlS=0;
  for (let i = 0; i < pnPrelieviCount; i++) {
    prlM += getV('pm-'+i);
    prlP += eff2('pm-'+i, 'pp-'+i);
    prlS += eff3('pm-'+i, 'pp-'+i, 'ps-'+i);
  }

  // ── Fondo chiusura ──
  const fcUscM = getV('fc-usc-m');
  const fcUscP = eff2('fc-usc-m','fc-usc-p');
  const fcUscS = eff3('fc-usc-m','fc-usc-p','fc-usc-s');

  // ── ENTRATE per colonna (come Love Me emSum/etSum) ──
  // Mattina: fc + voci M
  const emM = fc + vociFisse.reduce((s,k) => s + getV(k+'-m'), 0);
  // Pomeriggio: fc + voci effettivi P (P se compilato, altrimenti M)
  const emP = fc + vociFisse.reduce((s,k) => s + eff2(k+'-m', k+'-p'), 0);
  // Sera: fc + voci effettivi S (S se compilato, else P, else M)
  const emS = fc + vociFisse.reduce((s,k) => s + eff3(k+'-m', k+'-p', k+'-s'), 0);

  // ── USCITE per colonna (stessa logica) ──
  const umM = uscVoci.reduce((s,k) => s + getV(k+'-m'), 0) + fM + prlM + fcUscM;
  const umP = uscVoci.reduce((s,k) => s + eff2(k+'-m', k+'-p'), 0) + fP + prlP + fcUscP;
  const umS = uscVoci.reduce((s,k) => s + eff3(k+'-m', k+'-p', k+'-s'), 0) + fS + prlS + fcUscS;

  // ── DIFFERENZE (come Love Me dm/dt) ──
  const dm = emM - umM;  // differenza mattina
  const dp = emP - umP;  // differenza pomeriggio (P sovrascrive M)
  const ds = emS - umS;  // differenza sera finale (= dt di Love Me)

  // ── Visual auto-inherit: P e S grigi se ereditano (come Love Me ni-auto) ──
  [...vociFisse, ...uscVoci, 'fc-usc'].forEach(k => {
    const elM = document.getElementById(k+'-m');
    const elP = document.getElementById(k+'-p');
    const elS = document.getElementById(k+'-s');
    if (!elM || !elP || !elS) return;
    // P eredita da M se vuoto
    if (elP.value.trim() === '' && elM.value.trim() !== '') elP.classList.add('pn-auto');
    else elP.classList.remove('pn-auto');
    // S eredita da P (o M) se vuoto
    if (elS.value.trim() === '' && eff2(k+'-m', k+'-p') !== 0) elS.classList.add('pn-auto');
    else elS.classList.remove('pn-auto');
  });

  // ── AGGIORNA UI ──
  const setT = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = fmtPN(v); };

  setT('tot-ent-m', emM); setT('tot-ent-p', emP); setT('tot-ent-s', emS);
  setT('tot-usc-m', umM); setT('tot-usc-p', umP); setT('tot-usc-s', umS);

  [['diff-m',dm],['diff-p',dp],['diff-s',ds]].forEach(([id,d]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = (d>=0?'+ ':'- ') + fmtPN(Math.abs(d));
      el.className = 'td-tot' + (d>0?' alarm':'');
    }
  });

  // ── INCASSO (identico a Love Me, esteso a 3 turni) ──
  // Love Me: incassoMCalc = incasso-m + |dm|
  //          ig = effFixed(incasso-m, incasso-t) + |dt|
  //          incassoPCalc = ig - incassoMCalc
  // KONTRO 3 turni:
  const incassoMCalc = getV('incasso-m') + Math.abs(dm);
  const igPM         = eff2('incasso-m','incasso-p') + Math.abs(dp);
  const ig           = eff3('incasso-m','incasso-p','incasso-s') + Math.abs(ds);
  const incassoPCalc = Math.max(0, igPM - incassoMCalc);
  const incassoSCalc = Math.max(0, ig  - igPM);

  setT('r-inc-m',   incassoMCalc);
  setT('r-inc-p',   incassoPCalc);
  setT('r-inc-s',   incassoSCalc);
  setT('r-inc-tot', ig);

  const allarme = document.getElementById('pn-allarme');
  if (allarme) allarme.classList.toggle('hidden', ds <= 0);
}

// Override calcPN con la v2
function calcPN() { calcPN2(); }

function addFornitoreRow() {
  const idx = pnFornitoriCount;
  const tr = document.createElement('tr');
  tr.className = 'pn-dyn-row' + (idx%2===0?' pn-row-even':'');
  tr.id = 'fornitori-r'+idx;

  // Select fornitore dall'anagrafica
  const optsHtml = '<option value="">— Fornitore —</option>' +
    (fornitoriCache||[]).map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');

  tr.innerHTML = `
    <td class="td-desc" style="display:flex;align-items:center;gap:4px">
      <select class="pn-desc-input" id="fdesc-${idx}">${optsHtml}</select>
      <button class="pn-remove-btn" onclick="removeRow(this,'f',${idx})">×</button>
    </td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fm-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fp-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fs-${idx}" oninput="calcPN()"/></td>`;

  // Inserisce prima della sezione prelievi (non chiusura)
  const prelieviHeader = document.getElementById('prelievi-header');
  if (prelieviHeader) prelieviHeader.parentNode.insertBefore(tr, prelieviHeader);
  pnFornitoriCount++;
}

function addPrelievRow() {
  const idx = pnPrelieviCount;
  const tr = document.createElement('tr');
  tr.className = 'pn-dyn-row' + (idx%2===0?' pn-row-even':'');
  tr.id = 'prelievi-r'+idx;

  // Select causale
  const optsHtml = '<option value="">— Causale —</option>' +
    (causaliCache||[]).map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');

  tr.innerHTML = `
    <td class="td-desc" style="display:flex;align-items:center;gap:4px">
      <select class="pn-desc-input" id="pdesc-${idx}">${optsHtml}</select>
      <button class="pn-remove-btn" onclick="removeRow(this,'p',${idx})">×</button>
    </td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="pm-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="pp-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="ps-${idx}" oninput="calcPN()"/></td>`;

  // Inserisce prima della sezione chiusura
  const chiusura = document.querySelector('.pn-section-row.chiusura');
  if (chiusura) chiusura.parentNode.insertBefore(tr, chiusura);
  pnPrelieviCount++;
}

function removeRow(btn, tipo, idx) {
  btn.closest('tr').remove();
  calcPN();
}

function resetPN() {
  const campi = ['pn-fc','incasso-m','incasso-p','incasso-s','money-m','money-p','money-s',
    'grattavinci-m','grattavinci-p','grattavinci-s','sisal-m','sisal-p','sisal-s','fatture-m','fatture-p','fatture-s','giornali-m','giornali-p','giornali-s','conto-bet-m','conto-bet-p','conto-bet-s',
    'pos-m','pos-p','pos-s','carte-m','carte-p','carte-s','bonifici-m','bonifici-p','bonifici-s',
    'fc-usc-m','fc-usc-p','fc-usc-s','cm','cp','cs','pn-note'];
  campi.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Pulisci righe statiche fornitori
  for (let i=0; i<5; i++) { ['fdesc','fm','fp','fs'].forEach(p => { const el=document.getElementById(p+'-'+i); if(el) el.value=''; }); }
  for (let i=0; i<3; i++) { ['pdesc','pm','pp','ps'].forEach(p => { const el=document.getElementById(p+'-'+i); if(el) el.value=''; }); }
  calcPN();
}

async function loadNotaGiorno2() {
  if (!currentBusiness) return;
  const data = document.getElementById('pn-data')?.value;
  const locId = document.getElementById('pn-location')?.value || null;
  if (!data) return;

  let query = db.from('daily_notes').select('*, daily_note_rows(*)')
    .eq('business_id', currentBusiness.id).eq('data', data);
  if (locId) query = query.eq('location_id', locId);
  const { data: noteList2 } = await query.order('created_at', { ascending: false }).limit(10);
  const nota = (noteList2 || []).find(n => locId ? n.location_id === locId : !n.location_id) || null;

  resetPN();
  if (!nota) return;

  document.getElementById('pn-fc').value = nota.fondo_cassa || '';
  const campiMap = [
    ['incasso','incasso'],['money','money'],['grattavinci','grattavinci'],['sisal','sisal'],['conto-bet','conto_bet'],
    ['fatture','fatture'],['giornali','giornali'],
    ['pos','pos'],['carte','carte'],['bonifici','bonifici'],['fc-usc','fondo_chiusura']
  ];
  campiMap.forEach(([html, db]) => {
    ['m','p','s'].forEach(t => {
      const el = document.getElementById(html+'-'+t);
      if (el) el.value = nota[db+'_'+t] || '';
    });
  });
  document.getElementById('cm').value = nota.compilatore_m || '';
  document.getElementById('cp').value = nota.compilatore_p || '';
  document.getElementById('cs').value = nota.compilatore_s || '';
  document.getElementById('pn-note').value = nota.note || '';

  const fornitori = (nota.daily_note_rows||[]).filter(r=>r.categoria==='fornitore');
  const prelievi  = (nota.daily_note_rows||[]).filter(r=>r.categoria==='prelievo');

  fornitori.forEach((r,i) => {
    if (i>=5) addFornitoreRow();
    const el = (id) => document.getElementById(id+'-'+i);
    if (el('fdesc')) el('fdesc').value = r.descrizione||'';
    if (el('fm'))    el('fm').value    = r.importo_m||'';
    if (el('fp'))    el('fp').value    = r.importo_p||'';
    if (el('fs'))    el('fs').value    = r.importo_s||'';
  });

  prelievi.forEach((r,i) => {
    if (i>=3) addPrelievRow();
    const el = (id) => document.getElementById(id+'-'+i);
    if (el('pdesc')) el('pdesc').value = r.descrizione||'';
    if (el('pm'))    el('pm').value    = r.importo_m||'';
    if (el('pp'))    el('pp').value    = r.importo_p||'';
    if (el('ps'))    el('ps').value    = r.importo_s||'';
  });

  calcPN();

  // Mostra bottone elimina solo a owner/admin quando la nota esiste
  const btnElimina = document.getElementById('btn-elimina-nota');
  if (btnElimina) {
    const canDelete = ['owner','admin'].includes(currentRole);
    btnElimina.style.display = (canDelete && nota) ? 'inline-flex' : 'none';
    btnElimina.dataset.noteId = nota?.id || '';
  }
}

// Override loadNotaGiorno
function loadNotaGiorno() { loadNotaGiorno2(); }

async function eliminaNotaGiorno() {
  if (!['owner','admin'].includes(currentRole)) {
    showToast('Non autorizzato', 'error'); return;
  }
  const btn = document.getElementById('btn-elimina-nota');
  const noteId = btn?.dataset.noteId;
  if (!noteId) { showToast('Nessuna nota da eliminare', 'error'); return; }

  const data = document.getElementById('pn-data')?.value;
  if (!confirm(`Eliminare definitivamente la prima nota del ${data}?\nL'operazione è irreversibile.`)) return;

  const { error } = await db.from('daily_notes').delete().eq('id', noteId);
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  showToast('Prima nota eliminata', 'success');
  btn.style.display = 'none';
  btn.dataset.noteId = '';
  resetPN();
}


// ============================================
// STORICO PRIMA NOTA
// ============================================
async function initStorico() {
  // Imposta date default (mese corrente)
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const fromEl = document.getElementById('storico-from');
  const toEl = document.getElementById('storico-to');
  if (fromEl && !fromEl.value) fromEl.value = firstDay;
  if (toEl && !toEl.value) toEl.value = today;

  // Popola select sede
  const sel = document.getElementById('storico-location');
  if (sel) {
    sel.innerHTML = '<option value="">Tutte le sedi</option>' +
      currentLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  }

  await loadStorico();
}

async function loadStorico() {
  if (!currentBusiness) return;

  const from = document.getElementById('storico-from').value;
  const to = document.getElementById('storico-to').value;
  const locId = document.getElementById('storico-location').value;

  let query = db.from('daily_notes')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .order('data', { ascending: false });

  if (from) query = query.gte('data', from);
  if (to) query = query.lte('data', to);
  if (locId) query = query.eq('location_id', locId);

  const { data: notes } = await query;
  const list = notes || [];

  // KPI totali
  const totEnt = list.reduce((s, n) => s + Number(n.totale_entrate || 0), 0);
  const totUsc = list.reduce((s, n) => s + Number(n.totale_uscite || 0), 0);
  const totInc = list.reduce((s, n) => s + Number(n.incasso_giornaliero || 0), 0);

  document.getElementById('st-giorni').textContent = list.length;
  document.getElementById('st-entrate').textContent = formatEur(totEnt);
  document.getElementById('st-uscite').textContent = formatEur(totUsc);
  document.getElementById('st-incasso').textContent = formatEur(totInc);

  const container = document.getElementById('storico-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Nessun giorno registrato nel periodo</div>';
    return;
  }

  container.innerHTML = `
    <div class="storico-header">
      <span>Data</span>
      <span>Compilatori</span>
      <span style="text-align:right">Entrate</span>
      <span style="text-align:right">Uscite</span>
      <span style="text-align:right">Differenza</span>
      <span style="text-align:right">Incasso</span>
      <span></span>
    </div>
    ${list.map(n => {
      const loc = currentLocations.find(l => l.id === n.location_id);
      const compilatori = [n.compilatore_m, n.compilatore_p, n.compilatore_s].filter(Boolean).join(' · ') || '—';
      const diff = Number(n.differenza || 0);
      const inc = Number(n.incasso_giornaliero || 0);
      const dataFormatted = new Date(n.data + 'T12:00:00').toLocaleDateString('it-IT', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
      });

      return `
        <div class="storico-item" onclick="apriGiorno('${n.data}', '${n.location_id || ''}')">
          <div>
            <div class="st-data">${dataFormatted}</div>
            ${loc ? `<div class="st-sede">${loc.name}</div>` : ''}
          </div>
          <div class="st-sede">${compilatori}</div>
          <div class="st-val green">${formatEur(n.totale_entrate || 0)}</div>
          <div class="st-val red">${formatEur(n.totale_uscite || 0)}</div>
          <div class="st-val ${diff <= 0 ? 'blue' : 'red'}">${diff <= 0 ? '' : '⚠ '}${formatEur(diff)}</div>
          <div class="st-val gold">${formatEur(inc)}</div>
          <div class="st-arrow">→</div>
        </div>`;
    }).join('')}`;
}

async function apriGiorno(data, locationId) {
  // Vai alla Prima Nota con quella data
  showView('primanota');

  // Imposta data e sede
  const dataEl = document.getElementById('pn-data');
  const locEl = document.getElementById('pn-location');

  if (dataEl) dataEl.value = data;
  if (locEl && locationId) locEl.value = locationId;

  // Carica i dati
  await loadNotaGiorno2();

  // Scroll in cima
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Giorno del ' + new Date(data + 'T12:00:00').toLocaleDateString('it-IT') + ' caricato', 'success');
}

// ============================================
// BANCA & FINANZA
// ============================================
let bancheCache = [];
let currentAssegniFilter = 'aperti';

function switchBancaTab(tab) {
  document.querySelectorAll('.banca-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.banca-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('btab-' + tab).classList.add('active');
  document.getElementById('bpanel-' + tab).classList.add('active');
  if (tab === 'estratto') initEstrattoBanca();
}

async function initBanca() {
  await loadBancheCache();
  populateBancaSelects();
  setTodayFields();
  await Promise.all([
    loadOverview(),
    loadBancheList(),
    loadVersamenti(),
    loadAssegni(),
    loadRid()
  ]);
}

function setTodayFields() {
  const today = new Date().toISOString().split('T')[0];
  ['nv-data','na-emissione','na-scadenza','nr-prossimo'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
}

async function loadBancheCache() {
  if (!currentBusiness) return;
  const { data } = await db.from('banche').select('*')
    .eq('business_id', currentBusiness.id).eq('attivo', true).order('nome');
  bancheCache = data || [];
}

function populateBancaSelects() {
  const opts = '<option value="">Seleziona banca</option>' +
    bancheCache.map(b => `<option value="${b.id}">${b.nome} — ${b.istituto || ''}</option>`).join('');
  ['nv-banca','na-banca','nr-banca'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}

// ── OVERVIEW ─────────────────────────────────────────────────────
async function loadOverview() {
  if (!currentBusiness) return;
  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split('T')[0];

  const [{ data: vers }, { data: movUsc }, { data: assAperte }, { data: ridAttivi }] = await Promise.all([
    db.from('versamenti').select('importo_contante,importo_pos,banca_id').eq('business_id', currentBusiness.id),
    db.from('movimenti_banca').select('importo,banca_id').eq('business_id', currentBusiness.id).eq('segno','dare'),
    db.from('assegni').select('*').eq('business_id', currentBusiness.id).eq('incassato', false),
    db.from('rid_bancari').select('*').eq('business_id', currentBusiness.id).eq('attivo', true)
  ]);

  // Saldo banche = saldo iniziale + versamenti - movimenti dare
  let saldoBanche = bancheCache.reduce((s, b) => s + Number(b.saldo_iniziale || 0), 0);
  saldoBanche += (vers || []).reduce((s, v) => s + Number(v.importo_contante||0) + Number(v.importo_pos||0), 0);
  saldoBanche -= (movUsc || []).reduce((s, m) => s + Number(m.importo||0), 0);

  const assTot = (assAperte || []).reduce((s, a) => s + Number(a.importo||0), 0);
  const ridMensile = (ridAttivi || []).reduce((s, r) => {
    const mult = { mensile:1, bimestrale:0.5, trimestrale:0.33, semestrale:0.17, annuale:0.08 }[r.frequenza] || 1;
    return s + Number(r.importo||0) * mult;
  }, 0);
  const dispReale = saldoBanche - assTot;

  document.getElementById('ov-saldo-banche').textContent = formatEur(saldoBanche);
  document.getElementById('ov-saldo-sub').textContent = bancheCache.length + ' conti attivi';
  document.getElementById('ov-assegni').textContent = formatEur(assTot);
  document.getElementById('ov-assegni-sub').textContent = (assAperte||[]).length + ' assegni';
  document.getElementById('ov-rid').textContent = formatEur(ridMensile);
  document.getElementById('ov-rid-sub').textContent = (ridAttivi||[]).length + ' addebiti attivi';
  document.getElementById('ov-disp').textContent = formatEur(dispReale);

  // Alerts
  const alerts = [];
  const scaduti = (assAperte||[]).filter(a => a.data_scadenza < today);
  const inScadenza = (assAperte||[]).filter(a => a.data_scadenza >= today && a.data_scadenza <= in30str);
  if (scaduti.length) alerts.push({ type: 'danger', msg: `⚠️ ${scaduti.length} assegni scaduti per ${formatEur(scaduti.reduce((s,a)=>s+Number(a.importo),0))}` });
  if (inScadenza.length) alerts.push({ type: 'warning', msg: `⏰ ${inScadenza.length} assegni in scadenza nei prossimi 30 giorni: ${formatEur(inScadenza.reduce((s,a)=>s+Number(a.importo),0))}` });
  if (dispReale < 0) alerts.push({ type: 'danger', msg: `🚨 Disponibilità negativa: ${formatEur(dispReale)}` });

  const ridProssimi = (ridAttivi||[]).filter(r => r.prossimo_addebito && r.prossimo_addebito <= in30str);
  if (ridProssimi.length) alerts.push({ type: 'info', msg: `📅 ${ridProssimi.length} RID in addebito nei prossimi 30 giorni: ${formatEur(ridProssimi.reduce((s,r)=>s+Number(r.importo),0))}` });

  document.getElementById('ov-alerts').innerHTML = alerts.map(a =>
    `<div class="ov-alert ${a.type}">${a.msg}</div>`).join('');

  // Previsione 30 giorni
  buildPrevisione(dispReale, assAperte||[], ridAttivi||[]);
}

function buildPrevisione(dispReale, assegni, rid) {
  const rows = [];
  const today = new Date();

  rows.push({ data: 'Oggi', desc: 'Disponibilità attuale', val: dispReale, cls: dispReale >= 0 ? 'green' : 'red', saldo: true });

  let saldo = dispReale;
  const eventi = [];

  // Assegni in scadenza nei prossimi 30 gg
  assegni.forEach(a => {
    const d = new Date(a.data_scadenza);
    if (d >= today) eventi.push({ data: d, desc: `Assegno: ${a.beneficiario || 'N/D'}`, importo: -Number(a.importo), tipo: 'assegno' });
  });

  // RID
  rid.forEach(r => {
    if (r.prossimo_addebito) {
      const d = new Date(r.prossimo_addebito);
      if (d >= today) eventi.push({ data: d, desc: `RID: ${r.nome}`, importo: -Number(r.importo), tipo: 'rid' });
    }
  });

  eventi.sort((a, b) => a.data - b.data);
  eventi.slice(0, 10).forEach(ev => {
    saldo += ev.importo;
    rows.push({
      data: ev.data.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
      desc: ev.desc,
      val: ev.importo,
      saldo,
      cls: ev.importo < 0 ? 'red' : 'green'
    });
  });

  document.getElementById('ov-previsione').innerHTML = rows.map(r => `
    <div class="prev-row ${r.saldo ? 'saldo' : ''}">
      <span class="prev-data">${r.data}</span>
      <span class="prev-desc">${r.desc}</span>
      <span class="prev-val ${r.cls}">${r.val >= 0 ? '+' : ''}${formatEur(r.val)}</span>
      ${r.saldo !== undefined && !r.saldo ? `<span class="prev-val ${r.saldo >= 0 ? 'gold' : 'red'}" style="min-width:100px;text-align:right">${formatEur(r.saldo)}</span>` : '<span></span>'}
    </div>`).join('') || '<div class="empty-state">Nessun evento nei prossimi 30 giorni</div>';
}

// ── BANCHE ───────────────────────────────────────────────────────
function showAddBanca() { document.getElementById('add-banca-form').classList.remove('hidden'); }
function hideAddBanca() { document.getElementById('add-banca-form').classList.add('hidden'); }

async function saveBanca() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nb-nome').value.trim();
  if (!nome) { showToast('Inserisci il nome del conto', 'error'); return; }
  const { error } = await db.from('banche').insert({
    business_id: currentBusiness.id,
    nome,
    istituto: document.getElementById('nb-istituto').value.trim(),
    iban: document.getElementById('nb-iban').value.trim(),
    tipo: document.getElementById('nb-tipo').value,
    saldo_iniziale: parseFloat(document.getElementById('nb-saldo').value) || 0
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Conto aggiunto ✓', 'success');
  hideAddBanca();
  await loadBancheCache();
  populateBancaSelects();
  loadBancheList();
  loadOverview();
}

async function loadBancheList() {
  if (!currentBusiness) return;
  const { data } = await db.from('banche').select('*')
    .eq('business_id', currentBusiness.id).order('nome');
  const el = document.getElementById('banche-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun conto configurato</div>'; return; }
  el.innerHTML = data.map(b => `
    <div class="banca-card">
      <div class="bc-nome">${b.nome}</div>
      <div class="bc-istituto">${b.istituto || '—'}</div>
      ${b.iban ? `<div class="bc-iban">${b.iban}</div>` : ''}
      <div class="bc-saldo-label">Saldo iniziale</div>
      <div class="bc-saldo">${formatEur(b.saldo_iniziale)}</div>
      <div class="bc-actions">
        <button class="btn-secondary sm" onclick="deleteBanca('${b.id}')">Elimina</button>
      </div>
    </div>`).join('');
}

async function deleteBanca(id) {
  
  await db.from('banche').delete().eq('id', id);
  await loadBancheCache();
  populateBancaSelects();
  loadBancheList();
  loadOverview();
  showToast('Conto eliminato', 'success');
}

// ── VERSAMENTI ────────────────────────────────────────────────────
async function saveVersamento() {
  if (!currentBusiness) return;
  const banca = document.getElementById('nv-banca').value;
  const contante = parseFloat(document.getElementById('nv-contante').value) || 0;
  const pos = parseFloat(document.getElementById('nv-pos').value) || 0;
  if (!banca) { showToast('Seleziona una banca', 'error'); return; }
  if (!contante && !pos) { showToast('Inserisci almeno un importo', 'error'); return; }
  const { error } = await db.from('versamenti').insert({
    business_id: currentBusiness.id,
    banca_id: banca,
    data_versamento: document.getElementById('nv-data').value,
    importo_contante: contante,
    importo_pos: pos,
    note: document.getElementById('nv-note').value,
    created_by: currentUser.id
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Versamento registrato ✓', 'success');
  ['nv-contante','nv-pos','nv-note'].forEach(id => document.getElementById(id).value = '');
  loadVersamenti(); loadOverview();
}

async function loadVersamenti() {
  if (!currentBusiness) return;
  const { data } = await db.from('versamenti').select('*')
    .eq('business_id', currentBusiness.id)
    .order('data_versamento', { ascending: false }).limit(20);
  const el = document.getElementById('versamenti-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun versamento registrato</div>'; return; }
  el.innerHTML = data.map(v => {
    const banca = bancheCache.find(b => b.id === v.banca_id);
    const tot = Number(v.importo_contante||0) + Number(v.importo_pos||0);
    return `<div class="entry-item">
      <div class="entry-dot entrata"></div>
      <div class="entry-info">
        <div class="entry-desc">Versamento${banca ? ' → ' + banca.nome : ''}</div>
        <div class="entry-meta">${formatDate(v.data_versamento)} · Contante: ${formatEur(v.importo_contante)} · POS: ${formatEur(v.importo_pos)}</div>
      </div>
      <div class="entry-amount entrata">+${formatEur(tot)}</div>
      <button class="entry-del" onclick="deleteVersamento('${v.id}')">✕</button>
    </div>`;
  }).join('');
}

async function deleteVersamento(id) {
  
  await db.from('versamenti').delete().eq('id', id);
  loadVersamenti(); loadOverview();
  showToast('Versamento eliminato', 'success');
}

// ── ASSEGNI ───────────────────────────────────────────────────────
async function saveAssegno() {
  if (!currentBusiness) return;
  const importo = parseFloat(document.getElementById('na-importo').value);
  const scadenza = document.getElementById('na-scadenza').value;
  const fornitoreId = document.getElementById('na-fornitore')?.value || null;
  if (!importo || importo <= 0) { showToast('Inserisci un importo valido', 'error'); return; }
  if (!scadenza) { showToast('Inserisci la data di scadenza', 'error'); return; }

  // Auto-compila beneficiario dal fornitore selezionato
  let beneficiario = '';
  if (fornitoreId) { const f2 = fornitoriCache.find(x => x.id === fornitoreId); if (f2) beneficiario = f2.ragione_sociale; }


  const { error } = await db.from('assegni').insert({
    business_id: currentBusiness.id,
    banca_id: document.getElementById('na-banca').value || null,
    fornitore_id: fornitoreId,
    numero: document.getElementById('na-numero').value.trim(),
    beneficiario,
    importo,
    data_emissione: document.getElementById('na-emissione').value,
    data_scadenza: scadenza,
    stato: 'emesso',
    note: document.getElementById('na-note').value
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Assegno registrato ✓', 'success');
  ['na-numero','na-importo','na-note'].forEach(id => document.getElementById(id).value = '');
  const naF = document.getElementById('na-fornitore'); if (naF) naF.value = '';
  loadAssegni(); loadOverview();
}

async function loadAssegni(filter = null) {
  if (!currentBusiness) return;
  if (filter) currentAssegniFilter = filter;
  let query = db.from('assegni').select('*').eq('business_id', currentBusiness.id).order('data_scadenza');
  if (currentAssegniFilter === 'aperti') query = query.eq('incassato', false);
  const { data } = await query;
  const today = new Date().toISOString().split('T')[0];
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7str = in7.toISOString().split('T')[0];
  const el = document.getElementById('assegni-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun assegno</div>'; return; }
  el.innerHTML = data.map(a => {
    const banca = bancheCache.find(b => b.id === a.banca_id);
    let stato = 'aperto', badge = 'aperto';
    if (a.incassato) { stato = 'incassato'; badge = 'incassato'; }
    else if (a.data_scadenza < today) { stato = 'scaduto'; badge = 'scaduto'; }
    else if (a.data_scadenza <= in7str) { stato = 'scadenza'; badge = 'scadenza'; }
    return `<div class="assegno-item ${stato}">
      <div class="ass-info">
        <div class="ass-num">${a.numero ? 'N° ' + a.numero : ''}</div>
        <div class="ass-benef">${a.beneficiario || 'N/D'}</div>
        <div class="ass-meta">Scadenza: ${formatDate(a.data_scadenza)}${banca ? ' · ' + banca.nome : ''}</div>
      </div>
      <span class="ass-badge ${badge}">${{ aperto:'Aperto', scadenza:'In scadenza', scaduto:'Scaduto', incassato:'Incassato' }[badge]}</span>
      <div class="ass-importo ${a.incassato ? 'incassato' : ''}">${formatEur(a.importo)}</div>
      <div style="display:flex;gap:4px">
        ${!a.incassato ? `<button class="btn-secondary sm" onclick="apriModalePagamento('${a.id}')">Paga</button>` : ''}
        <button class="entry-del" onclick="deleteAssegno('${a.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function filterAssegni(f) { loadAssegni(f); }

async function incassaAssegno(id) {
  const today = new Date().toISOString().split('T')[0];
  await db.from('assegni').update({ incassato: true, data_incasso: today }).eq('id', id);
  loadAssegni(); loadOverview();
  showToast('Assegno marcato come incassato ✓', 'success');
}

async function deleteAssegno(id) {
  const { error } = await db.from('assegni').delete().eq('id', id);
  if (error) { showToast('Errore eliminazione: ' + error.message, 'error'); return; }
  loadAssegniV2(); loadOverview();
  showToast('Assegno eliminato ✓', 'success');
}

// ── RID/SDD ───────────────────────────────────────────────────────
async function saveRid() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nr-nome').value.trim();
  const importo = parseFloat(document.getElementById('nr-importo').value);
  if (!nome) { showToast('Inserisci il nome del RID', 'error'); return; }
  if (!importo || importo <= 0) { showToast('Inserisci un importo valido', 'error'); return; }
  const { error } = await db.from('rid_bancari').insert({
    business_id: currentBusiness.id,
    banca_id: document.getElementById('nr-banca').value || null,
    nome,
    descrizione: document.getElementById('nr-desc').value,
    importo,
    frequenza: document.getElementById('nr-frequenza').value,
    giorno_addebito: parseInt(document.getElementById('nr-giorno').value) || null,
    prossimo_addebito: document.getElementById('nr-prossimo').value || null
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('RID aggiunto ✓', 'success');
  ['nr-nome','nr-importo','nr-giorno','nr-desc'].forEach(id => document.getElementById(id).value = '');
  loadRid(); loadOverview();
}

async function loadRid() {
  if (!currentBusiness) return;
  const { data } = await db.from('rid_bancari').select('*')
    .eq('business_id', currentBusiness.id).order('nome');
  const el = document.getElementById('rid-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun RID configurato</div>'; return; }
  const freqLabel = { mensile:'Mensile', bimestrale:'Bimestrale', trimestrale:'Trimestrale', semestrale:'Semestrale', annuale:'Annuale' };
  el.innerHTML = data.map(r => {
    const banca = bancheCache.find(b => b.id === r.banca_id);
    return `<div class="rid-item">
      <div class="rid-info">
        <div class="rid-nome">${r.nome}</div>
        <div class="rid-meta">${freqLabel[r.frequenza] || r.frequenza}${r.giorno_addebito ? ' · giorno ' + r.giorno_addebito : ''}${banca ? ' · ' + banca.nome : ''}</div>
      </div>
      <div class="rid-prossimo">${r.prossimo_addebito ? 'Prossimo: ' + formatDate(r.prossimo_addebito) : '—'}</div>
      <div class="rid-importo">- ${formatEur(r.importo)}</div>
      <div style="display:flex;gap:4px">
        <button class="entry-del" onclick="toggleRid('${r.id}', ${r.attivo})" title="${r.attivo ? 'Disattiva' : 'Attiva'}">${r.attivo ? '⏸' : '▶'}</button>
        <button class="entry-del" onclick="deleteRid('${r.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleRid(id, attivo) {
  await db.from('rid_bancari').update({ attivo: !attivo }).eq('id', id);
  loadRid(); loadOverview();
}

async function deleteRid(id) {
  
  await db.from('rid_bancari').delete().eq('id', id);
  loadRid(); loadOverview();
  showToast('RID eliminato', 'success');
}

// ============================================
// FORNITORI
// ============================================
let fornitoriCache = [];

function switchFornitoriTab(tab) {
  document.querySelectorAll('.banca-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.banca-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('ftab-' + tab).classList.add('active');
  document.getElementById('fpanel-' + tab).classList.add('active');
  if (tab === 'fatture') loadFatture();
  if (tab === 'estratto') initEstratto();
}

async function initFornitori() {
  await loadFornitoriCache();
  populateFornitoriSelects();
  loadFornitoriList();
  // Date default estratto
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const ecFrom = document.getElementById('ec-from');
  const ecTo = document.getElementById('ec-to');
  if (ecFrom && !ecFrom.value) ecFrom.value = firstDay;
  if (ecTo && !ecTo.value) ecTo.value = today;
  // Date default fattura
  const nftData = document.getElementById('nft-data');
  if (nftData && !nftData.value) nftData.value = today;
}

async function loadFornitoriCache() {
  if (!currentBusiness) return;
  const { data } = await db.from('fornitori').select('id,ragione_sociale')
    .eq('business_id', currentBusiness.id).eq('attivo', true).order('ragione_sociale');
  fornitoriCache = data || [];
}

function populateFornitoriSelects() {
  const opts = '<option value="">Seleziona fornitore</option>' +
    fornitoriCache.map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');
  ['nft-fornitore','ec-fornitore','na-fornitore','ft-filter-fornitore'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const first = id === 'ft-filter-fornitore'
      ? '<option value="">Tutti i fornitori</option>'
      : id === 'na-fornitore'
        ? '<option value="">Nessun fornitore collegato</option>'
        : '<option value="">Seleziona fornitore</option>';
    el.innerHTML = first + fornitoriCache.map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');
  });
}

// ── ANAGRAFICA ────────────────────────────────────────────────────
function showAddFornitore() { document.getElementById('add-fornitore-form').classList.remove('hidden'); }
function hideAddFornitore() { document.getElementById('add-fornitore-form').classList.add('hidden'); }

async function saveFornitore() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nf-nome').value.trim();
  if (!nome) { showToast('Inserisci la ragione sociale', 'error'); return; }
  const { error } = await db.from('fornitori').insert({
    business_id: currentBusiness.id,
    ragione_sociale: nome,
    piva: document.getElementById('nf-piva').value.trim(),
    cf: document.getElementById('nf-cf').value.trim(),
    email: document.getElementById('nf-email').value.trim(),
    telefono: document.getElementById('nf-tel').value.trim(),
    indirizzo: document.getElementById('nf-indirizzo').value.trim(),
    note: document.getElementById('nf-note').value.trim()
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Fornitore salvato ✓', 'success');
  hideAddFornitore();
  ['nf-nome','nf-piva','nf-cf','nf-email','nf-tel','nf-indirizzo','nf-note'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  await loadFornitoriCache();
  populateFornitoriSelects();
  loadFornitoriList();
}

async function loadFornitoriList() {
  if (!currentBusiness) return;
  const { data } = await db.from('fornitori').select('*')
    .eq('business_id', currentBusiness.id).order('ragione_sociale');
  const el = document.getElementById('fornitori-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun fornitore registrato</div>'; return; }

  // Carica fatture aperte e assegni emessi per tutti i fornitori in una volta
  const [{ data: fatture }, { data: assegni }] = await Promise.all([
    db.from('fatture_fornitori').select('fornitore_id, importo_totale, stato')
      .eq('business_id', currentBusiness.id)
      .in('stato', ['aperta', 'pagata_parziale']),
    db.from('assegni').select('fornitore_id, importo, stato')
      .eq('business_id', currentBusiness.id)
      .in('stato', ['emesso', 'da_addebitare'])
  ]);

  el.innerHTML = data.map(f => {
    const ftFornitore = (fatture||[]).filter(x => x.fornitore_id === f.id);
    const assFornitore = (assegni||[]).filter(x => x.fornitore_id === f.id);
    const totFatture = ftFornitore.reduce((s, x) => s + Number(x.importo_totale), 0);
    const totAssegni = assFornitore.reduce((s, x) => s + Number(x.importo), 0);
    const saldoNetto = totFatture - totAssegni;
    const haDebiti = totFatture > 0;

    return `
    <div class="fornitore-item ${haDebiti ? 'has-debiti' : ''}">
      <div class="fornitore-avatar">${f.ragione_sociale[0].toUpperCase()}</div>
      <div class="fornitore-info">
        <div class="fornitore-nome">${f.ragione_sociale}</div>
        <div class="fornitore-meta">
          ${f.piva ? 'P.IVA: ' + f.piva : ''}
          ${f.email ? ' · ' + f.email : ''}
          ${f.telefono ? ' · ' + f.telefono : ''}
        </div>
      </div>

      ${haDebiti ? `
      <div class="fornitore-esposizione">
        <div class="fe-col">
          <div class="fe-label">Fatture aperte</div>
          <div class="fe-val red">${formatEur(totFatture)}</div>
        </div>
        <div class="fe-col">
          <div class="fe-label">Assegni emessi</div>
          <div class="fe-val gold">${totAssegni > 0 ? '- ' + formatEur(totAssegni) : '—'}</div>
        </div>
        <div class="fe-col highlight">
          <div class="fe-label">Saldo netto</div>
          <div class="fe-val ${saldoNetto <= 0 ? 'green' : 'red'}">${formatEur(saldoNetto)}</div>
        </div>
      </div>` : `<div class="fe-col" style="text-align:center"><div class="fe-val green" style="font-size:13px">✓ Saldo zero</div></div>`}

      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-secondary sm" onclick="switchFornitoriTab('estratto');document.getElementById('ec-fornitore').value='${f.id}';loadEstratto()">Estratto</button>
        <button class="entry-del" onclick="deleteFornitore('${f.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteFornitore(id) {
  // Controlla se ci sono fatture registrate per questo fornitore
  const { count } = await db.from('fatture')
    .select('id', { count: 'exact', head: true })
    .eq('fornitore_id', id);

  if (count > 0) {
    // Ha fatture → solo disattiva (soft delete)
    if (!confirm(`Questo fornitore ha ${count} fattura/e registrata/e.\nVerrà disattivato ma non eliminato definitivamente.\nContinuare?`)) return;
    await db.from('fornitori').update({ attivo: false }).eq('id', id);
    showToast('Fornitore disattivato', 'success');
  } else {
    // Nessuna fattura → elimina definitivamente
    if (!confirm('Eliminare definitivamente questo fornitore?\nL\'operazione è irreversibile.')) return;
    const { error } = await db.from('fornitori').delete().eq('id', id);
    if (error) { showToast('Errore: ' + error.message, 'error'); return; }
    showToast('Fornitore eliminato', 'success');
  }

  await loadFornitoriCache();
  populateFornitoriSelects();
  loadFornitoriList();
}

// ── FATTURE ───────────────────────────────────────────────────────
function calcFattura() {
  const netto = parseFloat(document.getElementById('nft-netto').value) || 0;
  const iva = parseFloat(document.getElementById('nft-iva').value) || 0;
  const totEl = document.getElementById('nft-totale');
  if (totEl && (netto || iva)) totEl.value = (netto + iva).toFixed(2);
}

async function saveFattura() {
  if (!currentBusiness) return;
  const totale = parseFloat(document.getElementById('nft-totale').value);
  const fornitore = document.getElementById('nft-fornitore').value;
  if (!totale || totale <= 0) { showToast('Inserisci il totale fattura', 'error'); return; }
  const { error } = await db.from('fatture_fornitori').insert({
    business_id: currentBusiness.id,
    fornitore_id: fornitore || null,
    numero: document.getElementById('nft-numero').value.trim(),
    data_fattura: document.getElementById('nft-data').value,
    data_scadenza: document.getElementById('nft-scadenza').value || null,
    importo_netto: parseFloat(document.getElementById('nft-netto').value) || 0,
    importo_iva: parseFloat(document.getElementById('nft-iva').value) || 0,
    importo_totale: totale,
    metodo_pagamento: document.getElementById('nft-metodo').value || null,
    note: document.getElementById('nft-note').value,
    created_by: currentUser.id
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Fattura registrata ✓', 'success');
  ['nft-numero','nft-netto','nft-iva','nft-totale','nft-note'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  loadFatture();
}

async function loadFatture() {
  if (!currentBusiness) return;
  const stato = document.getElementById('ft-filter-stato')?.value;
  const fornitore = document.getElementById('ft-filter-fornitore')?.value;
  const today = new Date().toISOString().split('T')[0];
  const firstMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const firstYear = new Date().getFullYear() + '-01-01';

  let query = db.from('fatture_fornitori').select('*, fornitori(ragione_sociale)')
    .eq('business_id', currentBusiness.id).order('data_fattura', { ascending: false });
  if (stato) query = query.eq('stato', stato);
  if (fornitore) query = query.eq('fornitore_id', fornitore);

  const { data } = await query;
  const all = data || [];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split('T')[0];

  const aperte = all.filter(f => f.stato === 'aperta' || f.stato === 'pagata_parziale');
  const scad30 = aperte.filter(f => f.data_scadenza && f.data_scadenza <= in30str);
  const pagateMese = all.filter(f => f.stato === 'pagata' && f.data_fattura >= firstMonth);
  const annoAll = all.filter(f => f.data_fattura >= firstYear);

  document.getElementById('ft-aperte').textContent = formatEur(aperte.reduce((s,f)=>s+Number(f.importo_totale),0));
  document.getElementById('ft-aperte-n').textContent = aperte.length + ' fatture';
  document.getElementById('ft-scadenza').textContent = formatEur(scad30.reduce((s,f)=>s+Number(f.importo_totale),0));
  document.getElementById('ft-scadenza-n').textContent = scad30.length + ' fatture';
  document.getElementById('ft-pagate').textContent = formatEur(pagateMese.reduce((s,f)=>s+Number(f.importo_totale),0));
  document.getElementById('ft-pagate-n').textContent = pagateMese.length + ' fatture';
  document.getElementById('ft-anno').textContent = formatEur(annoAll.reduce((s,f)=>s+Number(f.importo_totale),0));

  const el = document.getElementById('fatture-list');
  if (!all.length) { el.innerHTML = '<div class="empty-state">Nessuna fattura registrata</div>'; return; }

  el.innerHTML = all.map(f => {
    const scaduta = f.stato !== 'pagata' && f.data_scadenza && f.data_scadenza < today;
    const statoEff = scaduta ? 'scaduta' : f.stato;
    const statoLabel = { aperta:'Aperta', pagata_parziale:'Parz. pagata', pagata:'Pagata', scaduta:'Scaduta' }[statoEff] || f.stato;
    return `<div class="fattura-item ${statoEff}">
      <div class="ft-info">
        <div class="ft-numero">${f.numero ? 'N° ' + f.numero : 'Senza numero'}</div>
        <div class="ft-fornitore">${f.fornitori?.ragione_sociale || 'Fornitore generico'}</div>
        <div class="ft-meta">
          Emessa: ${formatDate(f.data_fattura)}
          ${f.data_scadenza ? ' · Scadenza: ' + formatDate(f.data_scadenza) : ''}
          ${f.metodo_pagamento ? ' · ' + f.metodo_pagamento : ''}
        </div>
      </div>
      <span class="ft-badge ${statoEff}">${statoLabel}</span>
      <div class="ft-importo ${f.stato === 'pagata' ? 'pagata' : ''}">${formatEur(f.importo_totale)}</div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        ${f.stato !== 'pagata' ? `<button class="btn-secondary sm" onclick="pagaFattura('${f.id}')">Paga</button>` : ''}
        <button class="entry-del" onclick="deleteFattura('${f.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function pagaFattura(id) {
  await db.from('fatture_fornitori').update({ stato: 'pagata' }).eq('id', id);
  loadFatture();
  showToast('Fattura marcata come pagata ✓', 'success');
}

async function deleteFattura(id) {
  
  await db.from('fatture_fornitori').delete().eq('id', id);
  loadFatture();
  showToast('Fattura eliminata', 'success');
}

// ── ESTRATTO CONTO ────────────────────────────────────────────────
function initEstratto() {
  const today = new Date().toISOString().split('T')[0];
  const firstYear = new Date().getFullYear() + '-01-01';
  const ecFrom = document.getElementById('ec-from');
  const ecTo = document.getElementById('ec-to');
  if (ecFrom && !ecFrom.value) ecFrom.value = firstYear;
  if (ecTo && !ecTo.value) ecTo.value = today;
}


// ============================================
// MODALE PAGAMENTO ASSEGNO
// ============================================
let currentAssegnoId = null;
let currentAssegnoData = null;

function apriModalePagamento(id) {
  // Trova l'assegno dalla lista già caricata
  currentAssegnoId = id;
  openModalAssegno(id);
}

async function openModalAssegno(id) {
  const { data: ass } = await db.from('assegni').select('*, fornitori(ragione_sociale)')
    .eq('id', id).single();
  if (!ass) return;

  currentAssegnoData = ass;

  // Popola info box
  document.getElementById('modal-assegno-info').innerHTML = `
    <div class="mi-label">Assegno da pagare</div>
    <div class="mi-value">${formatEur(ass.importo)}</div>
    <div class="mi-meta">
      ${ass.beneficiario ? 'A: ' + ass.beneficiario : ''}
      ${ass.fornitori ? ' · ' + ass.fornitori.ragione_sociale : ''}
      ${ass.numero ? ' · N° ' + ass.numero : ''}
      · Scadenza: ${formatDate(ass.data_scadenza)}
    </div>
  `;

  // Data default = oggi
  document.getElementById('pag-data').value = new Date().toISOString().split('T')[0];

  // Popola select banca
  const bancaEl = document.getElementById('pag-banca');
  bancaEl.innerHTML = '<option value="">Seleziona banca</option>' +
    bancheCache.map(b => `<option value="${b.id}">${b.nome} — ${b.istituto || ''}</option>`).join('');
  if (ass.banca_id) bancaEl.value = ass.banca_id;

  document.getElementById('pag-note').value = '';
  document.getElementById('modal-paga-assegno').classList.remove('hidden');
}

function closeModalAssegno() {
  document.getElementById('modal-paga-assegno').classList.add('hidden');
  currentAssegnoId = null;
  currentAssegnoData = null;
}

async function confermaPagamentoAssegno() {
  if (!currentAssegnoId) return;
  const dataIncasso = document.getElementById('pag-data').value;
  const bancaId = document.getElementById('pag-banca').value;
  const note = document.getElementById('pag-note').value.trim();

  if (!dataIncasso) { showToast('Inserisci la data di pagamento', 'error'); return; }

  // Marca assegno come incassato
  await db.from('assegni').update({
    incassato: true,
    data_incasso: dataIncasso,
    note: note || currentAssegnoData.note
  }).eq('id', currentAssegnoId);

  // Registra movimento bancario in uscita se banca selezionata
  if (bancaId && currentAssegnoData) {
    await db.from('movimenti_banca').insert({
      business_id: currentBusiness.id,
      banca_id: bancaId,
      data: dataIncasso,
      segno: 'dare',
      tipo: 'assegno',
      descrizione: `Assegno ${currentAssegnoData.numero || ''} - ${currentAssegnoData.beneficiario || 'N/D'}`,
      importo: currentAssegnoData.importo
    });
  }

  closeModalAssegno();
  showToast('Pagamento registrato ✓', 'success');
  loadAssegni();
  loadOverview();
}

// ============================================
// ASSEGNI v2 — Logica postdatati
// ============================================

// Stati assegno:
// emesso      → assegno dato al fornitore, banca non ancora addebitata
// da_addebitare → scadenza passata, banca deve essere addebitata
// addebitato  → banca addebitata, tutto chiuso

async function loadAssegniV2(filter = null) {
  if (!currentBusiness) return;
  if (filter) currentAssegniFilter = filter;

  let query = db.from('assegni').select('*, fornitori(ragione_sociale)')
    .eq('business_id', currentBusiness.id)
    .order('data_scadenza');

  if (currentAssegniFilter === 'aperti') {
    query = query.in('stato', ['emesso', 'da_addebitare']);
  }

  const { data } = await query;
  const today = new Date().toISOString().split('T')[0];
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7str = in7.toISOString().split('T')[0];
  const el = document.getElementById('assegni-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun assegno</div>'; return; }

  el.innerHTML = data.map(a => {
    const banca = bancheCache.find(b => b.id === a.banca_id);
    const stato = a.stato || (a.incassato ? 'addebitato' : 'emesso');

    // Determina classe visiva e badge
    let cls, badge, badgeLabel;
    if (stato === 'addebitato') {
      cls = 'incassato'; badge = 'incassato'; badgeLabel = '✓ Addebitato';
    } else if (stato === 'da_addebitare' || (stato === 'emesso' && a.data_scadenza < today)) {
      cls = 'scaduto'; badge = 'scaduto'; badgeLabel = '⚠ Da addebitare';
    } else if (a.data_scadenza <= in7str) {
      cls = 'scadenza'; badge = 'scadenza'; badgeLabel = '⏰ In scadenza';
    } else {
      cls = 'aperto'; badge = 'aperto'; badgeLabel = '📝 Emesso';
    }

    const isPostdatato = a.data_emissione && a.data_scadenza > a.data_emissione;
    const giorniScadenza = Math.ceil((new Date(a.data_scadenza) - new Date()) / 86400000);

    return `<div class="assegno-item ${cls}">
      <div class="ass-info">
        <div class="ass-num">${a.numero ? 'N° ' + a.numero : ''}${isPostdatato ? ' <span style="font-size:10px;color:var(--gold-light);font-weight:600">POSTDATATO</span>' : ''}</div>
        <div class="ass-benef">${a.beneficiario || a.fornitori?.ragione_sociale || 'N/D'}</div>
        <div class="ass-meta">
          Emesso: ${formatDate(a.data_emissione)} · Scadenza: ${formatDate(a.data_scadenza)}
          ${banca ? ' · ' + banca.nome : ''}
          ${stato !== 'addebitato' && giorniScadenza > 0 ? ` · tra ${giorniScadenza} giorni` : ''}
          ${stato !== 'addebitato' && giorniScadenza <= 0 ? ` · scaduto ${Math.abs(giorniScadenza)} giorni fa` : ''}
        </div>
      </div>
      <span class="ass-badge ${badge}">${badgeLabel}</span>
      <div class="ass-importo ${stato === 'addebitato' ? 'incassato' : ''}">${formatEur(a.importo)}</div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        ${stato !== 'addebitato' ? `<button class="btn-secondary sm" onclick="apriModaleAddebito('${a.id}')">Registra addebito</button>` : ''}
        <button class="entry-del" onclick="deleteAssegno('${a.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

// Override loadAssegni
function loadAssegni(f) { loadAssegniV2(f); }

// ── MODALE ADDEBITO BANCA ─────────────────────────────────────────
async function apriModaleAddebito(id) {
  const { data: ass } = await db.from('assegni')
    .select('*, fornitori(ragione_sociale)').eq('id', id).single();
  if (!ass) return;

  currentAssegnoId = id;
  currentAssegnoData = ass;

  // Popola info box
  document.getElementById('modal-assegno-info').innerHTML = `
    <div class="mi-label">Assegno — Registra addebito banca</div>
    <div class="mi-value">${formatEur(ass.importo)}</div>
    <div class="mi-meta">
      ${ass.beneficiario || ass.fornitori?.ragione_sociale || 'N/D'}
      ${ass.numero ? ' · N° ' + ass.numero : ''}
      · Scadenza: ${formatDate(ass.data_scadenza)}
      ${ass.data_scadenza > new Date().toISOString().split('T')[0]
        ? ' <span style="color:var(--gold-light)">(postdatato)</span>'
        : ' <span style="color:var(--red-400)">(scaduto)</span>'}
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">
      Il fornitore ha già ricevuto questo assegno. Ora registri l'uscita effettiva dalla banca.
    </div>`;

  // Data default = data scadenza assegno
  document.getElementById('pag-data').value = ass.data_scadenza;

  // Popola banca
  const bancaEl = document.getElementById('pag-banca');
  bancaEl.innerHTML = '<option value="">Seleziona banca</option>' +
    bancheCache.map(b => `<option value="${b.id}">${b.nome}${b.istituto ? ' — ' + b.istituto : ''}</option>`).join('');
  if (ass.banca_id) bancaEl.value = ass.banca_id;

  document.getElementById('pag-note').value = '';
  document.getElementById('modal-paga-assegno').classList.remove('hidden');
}

async function confermaPagamentoAssegno() {
  if (!currentAssegnoId || !currentAssegnoData) return;

  const dataAddebito = document.getElementById('pag-data').value;
  const bancaId = document.getElementById('pag-banca').value;
  const note = document.getElementById('pag-note').value.trim();

  if (!dataAddebito) { showToast('Inserisci la data di addebito', 'error'); return; }
  if (!bancaId) { showToast('Seleziona la banca', 'error'); return; }

  // Aggiorna stato assegno → addebitato
  await db.from('assegni').update({
    stato: 'addebitato',
    incassato: true,
    data_incasso: dataAddebito,
    banca_id: bancaId,
    note: note || currentAssegnoData.note
  }).eq('id', currentAssegnoId);

  // Registra movimento banca in uscita
  await db.from('movimenti_banca').insert({
    business_id: currentBusiness.id,
    banca_id: bancaId,
    data: dataAddebito,
    segno: 'dare',
    tipo: 'assegno',
    descrizione: `Assegno ${currentAssegnoData.numero ? 'N° ' + currentAssegnoData.numero + ' ' : ''}— ${currentAssegnoData.beneficiario || 'N/D'}`,
    importo: currentAssegnoData.importo
  });

  // Se era collegato a una fattura fornitore → aggiorna stato fattura
  if (currentAssegnoData.fornitore_id) {
    // Controlla fatture aperte del fornitore
    const { data: fatture } = await db.from('fatture_fornitori')
      .select('*')
      .eq('business_id', currentBusiness.id)
      .eq('fornitore_id', currentAssegnoData.fornitore_id)
      .in('stato', ['aperta', 'pagata_parziale'])
      .order('data_scadenza');

    if (fatture?.length) {
      // Segna la prima fattura come pagata se importo corrisponde
      const fattura = fatture[0];
      if (Math.abs(Number(fattura.importo_totale) - Number(currentAssegnoData.importo)) < 0.01) {
        await db.from('fatture_fornitori').update({ stato: 'pagata' }).eq('id', fattura.id);
      }
    }
  }

  closeModalAssegno();
  showToast('Addebito banca registrato ✓', 'success');
  loadAssegniV2();
  loadOverview();
}

// ── ESTRATTO CONTO V2 — con esposizione finanziaria ──────────────
async function loadEstratto() {
  const fornitoreId = document.getElementById('ec-fornitore').value;
  if (!fornitoreId || !currentBusiness) {
    document.getElementById('estratto-list').innerHTML = '<div class="empty-state">Seleziona un fornitore</div>';
    return;
  }
  const from = document.getElementById('ec-from').value;
  const to = document.getElementById('ec-to').value;

  const [{ data: fatture }, { data: assegni }] = await Promise.all([
    db.from('fatture_fornitori').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('fornitore_id', fornitoreId)
      .gte('data_fattura', from).lte('data_fattura', to)
      .order('data_fattura'),
    db.from('assegni').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('fornitore_id', fornitoreId)
      .gte('data_emissione', from).lte('data_emissione', to)
      .order('data_emissione')
  ]);

  const totFatturato = (fatture||[]).reduce((s,f) => s + Number(f.importo_totale), 0);
  const assEmessi = (assegni||[]).filter(a => (a.stato||'emesso') !== 'addebitato');
  const assAddebitati = (assegni||[]).filter(a => (a.stato||'emesso') === 'addebitato');
  const totEmesso = assEmessi.reduce((s,a) => s + Number(a.importo), 0);
  const totAddebitato = assAddebitati.reduce((s,a) => s + Number(a.importo), 0);

  // Saldo contabile = fatturato - assegni emessi - addebitati
  const saldoContabileTot = totFatturato - totEmesso - totAddebitato;
  // Saldo effettivo = fatturato - solo addebitati (banca)
  const saldoEffettivoTot = totFatturato - totAddebitato;

  document.getElementById('ec-fatturato').textContent = formatEur(totFatturato);
  document.getElementById('ec-assegni').textContent = formatEur(totEmesso);
  const scopEl = document.getElementById('ec-scoperto');
  if (scopEl) scopEl.textContent = formatEur(Math.max(0, saldoContabileTot));
  const saldoEl = document.getElementById('ec-saldo');
  if (saldoEl) {
    saldoEl.textContent = formatEur(Math.max(0, saldoEffettivoTot));
    saldoEl.style.color = saldoEffettivoTot <= 0 ? 'var(--green-400)' : 'var(--red-400)';
  }

  const movimenti = [
    ...(fatture||[]).map(function(f) {
      return {
        sortData: f.data_fattura,
        tipo: 'fattura', icon: '🧾',
        desc: 'Fattura ' + (f.numero || ''),
        meta: 'Emessa: ' + formatDate(f.data_fattura) + (f.data_scadenza ? ' · Scad: ' + formatDate(f.data_scadenza) : '') + ' · ' + ({aperta:'Aperta',pagata:'Pagata',pagata_parziale:'Parz. pagata'}[f.stato]||f.stato),
        importo: Number(f.importo_totale),
        effetto: 'debito'
      };
    }),
    ...(assegni||[]).map(function(a) {
      const stato = a.stato || (a.incassato ? 'addebitato' : 'emesso');
      const isAd = stato === 'addebitato';
      const isPost = a.data_emissione !== a.data_scadenza;
      return {
        sortData: a.data_emissione,
        tipo: 'assegno', icon: isAd ? '✅' : '📝',
        desc: 'Assegno ' + (a.numero ? 'N° ' + a.numero + ' ' : '') + (isPost ? '— Postdatato' : '— A vista'),
        meta: isAd
          ? 'Emesso: ' + formatDate(a.data_emissione) + ' · Addebitato in banca: ' + formatDate(a.data_incasso||a.data_scadenza) + ' ✓'
          : 'Emesso: ' + formatDate(a.data_emissione) + ' · Addebito banca previsto: ' + formatDate(a.data_scadenza) + ' ⏳',
        importo: Number(a.importo),
        effetto: isAd ? 'pagato' : 'emesso'
      };
    })
  ].sort(function(a,b) { return new Date(a.sortData) - new Date(b.sortData); });

  const el = document.getElementById('estratto-list');
  if (!movimenti.length) { el.innerHTML = '<div class="empty-state">Nessun movimento nel periodo</div>'; return; }

  let saldoC = 0, saldoE = 0;
  var rows = movimenti.map(function(m) {
    if (m.effetto === 'debito') { saldoC += m.importo; saldoE += m.importo; }
    else if (m.effetto === 'emesso') { saldoC -= m.importo; }
    else if (m.effetto === 'pagato') { saldoE -= m.importo; }

    var importoColor = m.effetto === 'debito' ? 'dare' : 'avere';
    var opacity = m.effetto === 'emesso' ? 'opacity:0.85;' : '';
    var cColor = saldoC > 0 ? 'var(--gold-light)' : 'var(--green-400)';
    var eColor = saldoE > 0 ? 'var(--red-400)' : 'var(--green-400)';

    return '<div class="ec-item" style="' + opacity + '">'
      + '<div class="ec-tipo">' + m.icon + '</div>'
      + '<div class="ec-info"><div class="ec-desc">' + m.desc + '</div><div class="ec-meta">' + m.meta + '</div></div>'
      + '<div class="ec-val ' + importoColor + '" style="min-width:110px;text-align:right">' + (m.effetto === 'debito' ? '+' : '-') + formatEur(m.importo) + '</div>'
      + '<div style="min-width:130px;text-align:right;font-family:var(--font-mono);font-size:13px;font-weight:500;color:' + cColor + '">' + formatEur(saldoC) + '</div>'
      + '<div style="min-width:130px;text-align:right;font-family:var(--font-mono);font-size:13px;font-weight:500;color:' + eColor + '">' + formatEur(saldoE) + '</div>'
      + '</div>';
  });

  var header = '<div class="ec-header-row">'
    + '<span style="flex:0 0 28px"></span>'
    + '<span style="flex:1">Movimento</span>'
    + '<span style="min-width:110px;text-align:right;font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.06em">Importo</span>'
    + '<span style="min-width:130px;text-align:right;font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.06em">Saldo contabile</span>'
    + '<span style="min-width:130px;text-align:right;font-size:10px;color:var(--blue-300);text-transform:uppercase;letter-spacing:.06em">Saldo effettivo</span>'
    + '</div>';

  var footer = '<div class="ec-item" style="background:var(--navy-950);border:1px solid rgba(255,255,255,0.08);font-weight:700;margin-top:8px">'
    + '<div class="ec-tipo">📊</div>'
    + '<div class="ec-info"><div class="ec-desc" style="font-weight:700">TOTALE PERIODO</div></div>'
    + '<div style="min-width:110px;text-align:right;font-family:var(--font-mono);font-size:13px;color:var(--gray-400)">' + formatEur(totFatturato) + '</div>'
    + '<div style="min-width:130px;text-align:right;font-family:var(--font-mono);font-size:15px;font-weight:700;color:' + (saldoC > 0 ? 'var(--gold-light)' : 'var(--green-400)') + '">' + formatEur(saldoC) + '</div>'
    + '<div style="min-width:130px;text-align:right;font-family:var(--font-mono);font-size:15px;font-weight:700;color:' + (saldoE > 0 ? 'var(--red-400)' : 'var(--green-400)') + '">' + formatEur(saldoE) + '</div>'
    + '</div>';

  el.innerHTML = header + rows.join('') + footer;
}



// ============================================
// PRIMA NOTA — collegamento fornitori
// ============================================
function populatePNFornitoriSelects() {
  // Sostituisce i text input fdesc-N con select dall'anagrafica
  for (let i = 0; i < 10; i++) {
    const el = document.getElementById('fdesc-' + i);
    if (!el) break;

    // Se è già un select, aggiorna solo le opzioni
    if (el.tagName === 'SELECT') {
      const val = el.value;
      el.innerHTML = pnFornitoriOptsHtml();
      if (val) el.value = val;
      continue;
    }

    // Crea select
    const sel = document.createElement('select');
    sel.id = 'fdesc-' + i;
    sel.className = 'pn-desc-input';
    sel.innerHTML = pnFornitoriOptsHtml();

    // Copia valore testuale se c'era già qualcosa
    if (el.value) {
      // Cerca fornitore per nome
      const match = fornitoriCache.find(f =>
        f.ragione_sociale.toLowerCase() === el.value.toLowerCase()
      );
      if (match) sel.value = match.id;
    }

    el.parentNode.replaceChild(sel, el);
  }
}

function pnFornitoriOptsHtml() {
  return '<option value="">— Fornitore —</option>' +
    fornitoriCache.map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('') +
    '<option value="__libero__">✏ Descrizione libera...</option>';
}


// salvaNotaGiorno — versione con fornitore_id dal select
async function salvaNotaGiorno() {
  // Prima di salvare, aggiorna daily_note_rows con fornitore_id
  if (!currentBusiness) return;
  const data = document.getElementById('pn-data').value;
  if (!data) { showPNMsg('Inserisci la data', 'error'); return; }
  const locId = document.getElementById('pn-location').value || null;
  const fc = getV('pn-fc');

  // Calcola valori effettivi finali (eff3: S se compilato, else P, else M)
  function e3(idM, idP, idS) {
    const s = document.getElementById(idS), p = document.getElementById(idP), m = document.getElementById(idM);
    if (s && s.value.trim() !== '') return parseFloat(s.value)||0;
    if (p && p.value.trim() !== '') return parseFloat(p.value)||0;
    return parseFloat(m?.value)||0;
  }

  const payload = {
    business_id: currentBusiness.id, location_id: locId, data, fondo_cassa: fc,
    incasso_m: getV('incasso-m'), incasso_p: getV('incasso-p'), incasso_s: getV('incasso-s'),
    money_m: getV('money-m'), money_p: getV('money-p'), money_s: getV('money-s'),
    grattavinci_m: getV('grattavinci-m'), grattavinci_p: getV('grattavinci-p'), grattavinci_s: getV('grattavinci-s'),
    sisal_m: getV('sisal-m'), sisal_p: getV('sisal-p'), sisal_s: getV('sisal-s'),
    conto_bet_m: getV('conto-bet-m'), conto_bet_p: getV('conto-bet-p'), conto_bet_s: getV('conto-bet-s'),
    bet_banca_id: document.getElementById('pn-bet-banca')?.value || null,
    fatture_m: getV('fatture-m'), fatture_p: getV('fatture-p'), fatture_s: getV('fatture-s'),
    giornali_m: getV('giornali-m'), giornali_p: getV('giornali-p'), giornali_s: getV('giornali-s'),
    pos_m: getV('pos-m'), pos_p: getV('pos-p'), pos_s: getV('pos-s'),
    carte_m: getV('carte-m'), carte_p: getV('carte-p'), carte_s: getV('carte-s'),
    bonifici_m: getV('bonifici-m'), bonifici_p: getV('bonifici-p'), bonifici_s: getV('bonifici-s'),
    fondo_chiusura_m: getV('fc-usc-m'), fondo_chiusura_p: getV('fc-usc-p'), fondo_chiusura_s: getV('fc-usc-s'),
    compilatore_m: document.getElementById('cm').value,
    compilatore_p: document.getElementById('cp').value,
    compilatore_s: document.getElementById('cs').value,
    note: document.getElementById('pn-note').value,
    // Valori effettivi finali per conciliazione fiscale
    incasso_eff:     e3('incasso-m','incasso-p','incasso-s'),
    money_eff:       e3('money-m','money-p','money-s'),
    grattavinci_eff: e3('grattavinci-m','grattavinci-p','grattavinci-s'),
    sisal_eff:       e3('sisal-m','sisal-p','sisal-s'),
    conto_bet_eff:   e3('conto-bet-m','conto-bet-p','conto-bet-s'),
    created_by: currentUser.id, updated_at: new Date().toISOString()
  };

  // Cerca nota esistente per questo giorno/sede (gestisce anche location_id NULL)
  let existingQuery = db.from('daily_notes').select('id')
    .eq('business_id', currentBusiness.id).eq('data', data);
  if (locId) existingQuery = existingQuery.eq('location_id', locId);
  else existingQuery = existingQuery.is('location_id', null);
  const { data: existing } = await existingQuery.single();

  let saved, error;
  if (existing?.id) {
    // Aggiorna la nota esistente
    ({ data: saved, error } = await db.from('daily_notes')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id).select().single());
  } else {
    // Inserisce nuova nota
    ({ data: saved, error } = await db.from('daily_notes')
      .insert(payload).select().single());
  }
  if (error) { showPNMsg('Errore: ' + error.message, 'error'); return; }

  await db.from('daily_note_rows').delete().eq('daily_note_id', saved.id);
  const rows = [];

  for (let i = 0; i < pnFornitoriCount; i++) {
    const descEl = document.getElementById('fdesc-' + i);
    const m = getV('fm-' + i), p = getV('fp-' + i), s = getV('fs-' + i);
    if (!descEl && !m && !p && !s) continue;

    let descrizione = '';
    let fornitoreId = null;

    if (descEl?.tagName === 'SELECT') {
      const val = descEl.value;
      if (val && val !== '__libero__') {
        fornitoreId = val;
        const f = fornitoriCache.find(x => x.id === val);
        descrizione = f ? f.ragione_sociale : '';
      }
    } else if (descEl?.tagName === 'INPUT') {
      descrizione = descEl.value?.trim() || '';
    }

    if (m || p || s || descrizione || fornitoreId) {
      rows.push({
        daily_note_id: saved.id,
        business_id: currentBusiness.id,
        categoria: 'fornitore',
        descrizione,
        fornitore_id: fornitoreId,
        importo_m: m, importo_p: p, importo_s: s,
        ordine: i
      });
    }
  }

  for (let i = 0; i < pnPrelieviCount; i++) {
    const desc = document.getElementById('pdesc-' + i)?.value?.trim() || '';
    const m = getV('pm-' + i), p = getV('pp-' + i), s = getV('ps-' + i);
    if (m || p || s || desc) {
      rows.push({
        daily_note_id: saved.id,
        business_id: currentBusiness.id,
        categoria: 'prelievo',
        descrizione: desc,
        importo_m: m, importo_p: p, importo_s: s,
        ordine: i
      });
    }
  }

  if (rows.length) await db.from('daily_note_rows').insert(rows);

  const fcChiusura = getV('fc-usc-s') || getV('fc-usc-p') || getV('fc-usc-m');
  if (fcChiusura > 0) {
    const dom = new Date(data); dom.setDate(dom.getDate() + 1);
    await db.from('daily_notes').upsert({
      business_id: currentBusiness.id, location_id: locId,
      data: dom.toISOString().split('T')[0], fondo_cassa: fcChiusura
    }, { onConflict: 'business_id,location_id,data', ignoreDuplicates: true });
  }

  // Scala automaticamente le giocate dal conto bet
  const betBancaId = document.getElementById('pn-bet-banca')?.value || null;
  const totBet = getV('conto-bet-m') + getV('conto-bet-p') + getV('conto-bet-s');
  if (betBancaId && totBet > 0) await scalaCcontoBet(betBancaId, totBet, data);

  showPNMsg('Prima nota salvata ✓' + (fcChiusura > 0 ? ' — fondo cassa domani pre-compilato' : '') + (betBancaId && totBet > 0 ? ' · Conto bet aggiornato' : ''), 'success');
  await loadDashboard();
}

// ============================================
// MOVIMENTI BANCARI — elimina
// ============================================
async function deleteMovimentoBanca(id) {
  if (!confirm('Eliminare questo movimento bancario?')) return;
  await db.from('movimenti_banca').delete().eq('id', id);
  loadOverview();
  showToast('Movimento eliminato', 'success');
}

async function deleteAssegnoCompleto(id) {
  if (!confirm('Eliminare questo assegno? L\'operazione è irreversibile.')) return;
  await db.from('assegni').delete().eq('id', id);
  loadAssegniV2();
  loadOverview();
  showToast('Assegno eliminato', 'success');
}

// ============================================
// IMPOSTAZIONI
// ============================================
let currentCatFilter = 'tutte';

function switchSettingsTab(tab) {
  document.querySelectorAll('.banca-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.banca-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('stab-' + tab).classList.add('active');
  document.getElementById('spanel-' + tab).classList.add('active');
  if (tab === 'azienda') loadAzienda();
  if (tab === 'causali') loadCausaliLista();
}

async function initImpostazioni() {
  await loadCategorieLista();
  await loadCausaliCache();
  loadAzienda();
}

// ── CATEGORIE ─────────────────────────────────────────────────────
async function loadCategorieLista() {
  if (!currentBusiness) return;
  const { data } = await db.from('categories').select('*')
    .eq('business_id', currentBusiness.id)
    .eq('active', true)
    .order('type').order('name');

  window.allCategories = data || [];

  const entrate = (data||[]).filter(c => c.type === 'entrata');
  const uscite = (data||[]).filter(c => c.type === 'uscita');

  document.getElementById('cat-n-entrate').textContent = entrate.length;
  document.getElementById('cat-n-uscite').textContent = uscite.length;

  renderCategorieLista(data||[]);

  // Aggiorna anche i select nella form movimenti
  filterCategoriesByType('entrata');
}

function filterCategorie(tipo) {
  currentCatFilter = tipo;
  ['tutte','entrata','uscita'].forEach(t => {
    const btn = document.getElementById('cf-' + t);
    if (btn) btn.classList.toggle('active', t === tipo);
  });
  const filtered = tipo === 'tutte'
    ? (window.allCategories || [])
    : (window.allCategories || []).filter(c => c.type === tipo);
  renderCategorieLista(filtered);
}

function renderCategorieLista(cats) {
  const el = document.getElementById('categorie-list');
  if (!cats.length) { el.innerHTML = '<div class="empty-state">Nessuna categoria</div>'; return; }
  el.innerHTML = cats.map(c => `
    <div class="categoria-card" style="border-left-color:${c.color}">
      <div class="cat-icon">${c.icon || '📌'}</div>
      <div class="cat-info">
        <div class="cat-nome">${c.name}</div>
        <div class="cat-tipo ${c.type}">${c.type === 'entrata' ? 'Entrata' : 'Uscita'}</div>
      </div>
      <button class="entry-del" onclick="deleteCategoria('${c.id}')" title="Elimina">✕</button>
    </div>`).join('');
}

async function saveCategoria() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nc-nome').value.trim();
  const tipo = document.getElementById('nc-tipo').value;
  const icon = document.getElementById('nc-icon').value.trim() || '📌';
  const color = document.getElementById('nc-color').value;
  const msgEl = document.getElementById('nc-msg');

  if (!nome) { msgEl.textContent = 'Inserisci il nome'; msgEl.className = 'auth-message error'; return; }

  const { error } = await db.from('categories').insert({
    business_id: currentBusiness.id,
    name: nome,
    type: tipo,
    icon,
    color,
    active: true
  });

  if (error) { msgEl.textContent = 'Errore: ' + error.message; msgEl.className = 'auth-message error'; return; }

  msgEl.textContent = 'Categoria aggiunta ✓';
  msgEl.className = 'auth-message success';
  document.getElementById('nc-nome').value = '';
  document.getElementById('nc-icon').value = '';
  setTimeout(() => msgEl.textContent = '', 3000);
  await loadCategorieLista();
}

async function deleteCategoria(id) {
  const { error } = await db.from('categories').update({ active: false }).eq('id', id);
  if (error) { showToast('Errore eliminazione', 'error'); return; }
  showToast('Categoria eliminata ✓', 'success');
  await loadCategorieLista();
}

// ── AZIENDA ───────────────────────────────────────────────────────
async function loadAzienda() {
  if (!currentBusiness) return;
  document.getElementById('az-nome').value = currentBusiness.name || '';
  document.getElementById('az-email').value = currentBusiness.email || '';
  document.getElementById('az-piva').value = currentBusiness.vat_number || '';
  document.getElementById('az-tel').value = currentBusiness.phone || '';
}

async function saveAzienda() {
  if (!currentBusiness) return;
  const nome = document.getElementById('az-nome').value.trim();
  if (!nome) { showToast('Inserisci il nome attività', 'error'); return; }

  const { error } = await db.from('businesses').update({
    name: nome,
    email: document.getElementById('az-email').value.trim(),
    vat_number: document.getElementById('az-piva').value.trim(),
    phone: document.getElementById('az-tel').value.trim()
  }).eq('id', currentBusiness.id);

  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  currentBusiness.name = nome;
  document.getElementById('business-name-sidebar').textContent = nome;
  const msgEl = document.getElementById('az-msg');
  msgEl.textContent = 'Dati salvati ✓';
  msgEl.className = 'auth-message success';
  setTimeout(() => msgEl.textContent = '', 3000);
  showToast('Azienda aggiornata ✓', 'success');
}

// ============================================
// GESTIONE PERMESSI CASSIERE
// ============================================
let currentPermessiUserId = null;

async function apriModalPermessi(userId, userName, role) {
  if (role !== 'cashier') {
    showToast('I permessi si configurano solo per i cassieri', '');
    return;
  }

  currentPermessiUserId = userId;

  document.getElementById('modal-permessi-user').innerHTML = `
    <div class="mi-label">Configurazione permessi per</div>
    <div class="mi-value" style="font-size:16px">${userName}</div>
    <div class="mi-meta">Ruolo: Cassiere</div>`;

  // Carica permessi esistenti
  const { data: perms } = await db.from('user_permissions')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('user_id', userId)
    .maybeSingle();

  // Imposta checkbox
  document.getElementById('perm-movimenti').checked = perms?.can_view_movimenti ?? false;
  document.getElementById('perm-storico').checked = perms?.can_view_storico ?? false;
  document.getElementById('perm-report').checked = perms?.can_view_report ?? false;
  document.getElementById('perm-banca').checked = perms?.can_view_banca ?? false;
  document.getElementById('perm-fornitori').checked = perms?.can_view_fornitori ?? false;

  document.getElementById('modal-permessi').classList.remove('hidden');
}

function closeModalPermessi() {
  document.getElementById('modal-permessi').classList.add('hidden');
  currentPermessiUserId = null;
}

async function salvaPermessi() {
  if (!currentPermessiUserId || !currentBusiness) return;

  const payload = {
    business_id: currentBusiness.id,
    user_id: currentPermessiUserId,
    can_view_dashboard: true,
    can_view_primanota: true,
    can_view_movimenti: document.getElementById('perm-movimenti').checked,
    can_view_storico: document.getElementById('perm-storico').checked,
    can_view_report: document.getElementById('perm-report').checked,
    can_view_banca: document.getElementById('perm-banca').checked,
    can_view_fornitori: document.getElementById('perm-fornitori').checked
  };

  const { error } = await db.from('user_permissions')
    .upsert(payload, { onConflict: 'business_id,user_id' });

  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  closeModalPermessi();
  showToast('Permessi salvati ✓', 'success');
}

// Carica permessi per l'utente corrente e aggiorna il menu
async function loadCurrentUserPermissions() {
  if (!currentBusiness || currentRole !== 'cashier') return;

  const { data: perms } = await db.from('user_permissions')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  // Default cassiere: solo dashboard e primanota
  window.userPerms = {
    dashboard: true,
    primanota: true,
    movimenti: perms?.can_view_movimenti ?? false,
    storico: perms?.can_view_storico ?? false,
    report: perms?.can_view_report ?? false,
    banca: perms?.can_view_banca ?? false,
    fornitori: perms?.can_view_fornitori ?? false,
    sedi: true,
    team: false,
    impostazioni: false
  };
}

// ============================================
// FATTURE FORNITORE IN FORM ASSEGNO
// ============================================
let fattureAssegnoSelezionate = new Set();

async function loadFattureFornitoreAssegno() {
  const fornitoreId = document.getElementById('na-fornitore').value;
  const wrap = document.getElementById('na-fatture-wrap');
  const listEl = document.getElementById('na-fatture-list');

  fattureAssegnoSelezionate.clear();

  if (!fornitoreId || !currentBusiness) {
    wrap.style.display = 'none';
    return;
  }

  // Carica fatture aperte del fornitore
  const { data: fatture } = await db.from('fatture_fornitori')
    .select('*')
    .eq('business_id', currentBusiness.id)
    .eq('fornitore_id', fornitoreId)
    .in('stato', ['aperta', 'pagata_parziale'])
    .order('data_scadenza');

  if (!fatture?.length) {
    wrap.style.display = 'block';
    listEl.innerHTML = '<div class="empty-state" style="padding:12px">Nessuna fattura aperta per questo fornitore</div>';
    return;
  }

  wrap.style.display = 'block';
  listEl.innerHTML = fatture.map(f => `
    <div class="fattura-assegno-item" id="fai-${f.id}" onclick="toggleFatturaAssegno('${f.id}', ${f.importo_totale})">
      <input type="checkbox" id="chk-${f.id}" onclick="event.stopPropagation();toggleFatturaAssegno('${f.id}', ${f.importo_totale})" />
      <div class="fa-info">
        <div class="fa-numero">${f.numero ? 'N° ' + f.numero : 'Fattura'} · ${f.data_fattura ? formatDate(f.data_fattura) : ''}</div>
        <div class="fa-scadenza">Scadenza: ${f.data_scadenza ? formatDate(f.data_scadenza) : '—'}</div>
      </div>
      <div class="fa-importo">${formatEur(f.importo_totale)}</div>
    </div>`).join('') + '<div class="fatture-assegno-totale"><span class="fat-tot-label">Totale selezionato</span><span class="fat-tot-val" id="fat-tot-val">€ 0,00</span></div>';
}

function toggleFatturaAssegno(id, importo) {
  const item = document.getElementById('fai-' + id);
  const chk = document.getElementById('chk-' + id);

  if (fattureAssegnoSelezionate.has(id)) {
    fattureAssegnoSelezionate.delete(id);
    item.classList.remove('selected');
    chk.checked = false;
  } else {
    fattureAssegnoSelezionate.add(id);
    item.classList.add('selected');
    chk.checked = true;
  }

  // Aggiorna totale e auto-compila importo assegno
  updateTotaleSelezionato();
}

function updateTotaleSelezionato() {
  const totEl = document.getElementById('fat-tot-val');
  if (!totEl) return;

  // Somma importi dalle fatture selezionate
  let tot = 0;
  fattureAssegnoSelezionate.forEach(id => {
    const chk = document.getElementById('chk-' + id);
    if (chk) {
      // Leggi importo dal data attribute
      const item = document.getElementById('fai-' + id);
      const importoEl = item?.querySelector('.fa-importo');
      if (importoEl) {
        const txt = importoEl.textContent.replace('€','').replace('.','').replace(',','.').trim();
        tot += parseFloat(txt) || 0;
      }
    }
  });

  totEl.textContent = formatEur(tot);

  // Auto-compila importo assegno
  if (tot > 0) {
    const impEl = document.getElementById('na-importo');
    if (impEl && !impEl.value) impEl.value = tot.toFixed(2);
  }
}

// Override saveAssegno per collegare le fatture
const _origSaveAssegno = saveAssegno;
async function saveAssegno() {
  if (!currentBusiness) return;
  const importo = parseFloat(document.getElementById('na-importo').value);
  const scadenza = document.getElementById('na-scadenza').value;
  const fornitoreId = document.getElementById('na-fornitore')?.value || null;

  if (!importo || importo <= 0) { showToast('Inserisci un importo valido', 'error'); return; }
  if (!scadenza) { showToast('Inserisci la data di scadenza', 'error'); return; }

  let beneficiario = '';
  if (fornitoreId) { const f = fornitoriCache.find(x => x.id === fornitoreId); if (f) beneficiario = f.ragione_sociale; }

  const { data: assegno, error } = await db.from('assegni').insert({
    business_id: currentBusiness.id,
    banca_id: document.getElementById('na-banca').value || null,
    fornitore_id: fornitoreId,
    numero: document.getElementById('na-numero').value.trim(),
    beneficiario,
    importo,
    data_emissione: document.getElementById('na-emissione').value,
    data_scadenza: scadenza,
    stato: 'emesso',
    note: document.getElementById('na-note').value
  }).select().single();

  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  // Collega fatture selezionate e calcola giorni pagamento
  if (fattureAssegnoSelezionate.size > 0 && assegno) {
    const oggi = new Date().toISOString().split('T')[0];

    for (const fatturaId of fattureAssegnoSelezionate) {
      // Carica fattura per calcolare giorni
      const { data: fatt } = await db.from('fatture_fornitori')
        .select('data_fattura, data_scadenza, importo_totale')
        .eq('id', fatturaId).single();

      // Calcola giorni dalla data fattura all'emissione assegno
      let giorniPagamento = null;
      if (fatt?.data_fattura) {
        const diff = new Date(oggi) - new Date(fatt.data_fattura);
        giorniPagamento = Math.round(diff / 86400000);
      }

      // Aggiorna fattura come pagata
      await db.from('fatture_fornitori').update({
        stato: 'pagata',
        metodo_pagamento: 'assegno',
        note: (fatt?.note ? fatt.note + ' · ' : '') + 'Pagata con assegno N° ' + (document.getElementById('na-numero').value || assegno.id)
      }).eq('id', fatturaId);

      // Salva giorni pagamento per statistiche
      if (giorniPagamento !== null && fornitoreId) {
        await db.from('fornitori').update({
          note: `Tempo medio pagamento aggiornato: ${giorniPagamento} giorni`
        }).eq('id', fornitoreId);
      }
    }

    showToast(`Assegno registrato ✓ · ${fattureAssegnoSelezionate.size} fattura/e collegate`, 'success');
  } else {
    showToast('Assegno registrato ✓', 'success');
  }

  // Reset form
  ['na-numero','na-importo','na-note'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const naF = document.getElementById('na-fornitore'); if (naF) naF.value = '';
  const naFW = document.getElementById('na-fatture-wrap'); if (naFW) naFW.style.display = 'none';
  fattureAssegnoSelezionate.clear();

  loadAssegniV2();
  loadOverview();
}

// ============================================
// EXPORT PDF ESTRATTO CONTO FORNITORE
// ============================================
async function exportEstrattoPDF() {
  const fornitoreId = document.getElementById('ec-fornitore').value;
  if (!fornitoreId || !currentBusiness) {
    showToast('Seleziona prima un fornitore', 'error'); return;
  }

  const from = document.getElementById('ec-from').value;
  const to = document.getElementById('ec-to').value;
  const fornitore = fornitoriCache.find(f => f.id === fornitoreId);
  const fornitoreNome = fornitore?.ragione_sociale || 'Fornitore';

  showToast('Generazione PDF...', '');

  const [{ data: fatture }, { data: assegni }] = await Promise.all([
    db.from('fatture_fornitori').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('fornitore_id', fornitoreId)
      .gte('data_fattura', from).lte('data_fattura', to)
      .order('data_fattura'),
    db.from('assegni').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('fornitore_id', fornitoreId)
      .gte('data_emissione', from).lte('data_emissione', to)
      .order('data_emissione')
  ]);

  const totFatturato = (fatture||[]).reduce((s,f) => s + Number(f.importo_totale), 0);
  const assEmessi = (assegni||[]).filter(a => (a.stato||'emesso') !== 'addebitato');
  const assAddebitati = (assegni||[]).filter(a => (a.stato||'emesso') === 'addebitato');
  const totEmesso = assEmessi.reduce((s,a) => s + Number(a.importo), 0);
  const totAddebitato = assAddebitati.reduce((s,a) => s + Number(a.importo), 0);
  const saldoContabile = totFatturato - totEmesso - totAddebitato;
  const saldoEffettivo = totFatturato - totAddebitato;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 16;
  let y = 0;

  // ── HEADER ──
  doc.setFillColor(10, 15, 30);
  doc.rect(0, 0, W, 38, 'F');
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(margin, 10, 16, 16, 2, 2, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text('K', margin + 8, 21, { align: 'center' });
  doc.setFontSize(18); doc.text('KONTRO', margin + 20, 21);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.setTextColor(156,163,175);
  doc.text('Generato il ' + new Date().toLocaleDateString('it-IT'), W - margin, 21, { align: 'right' });
  y = 46;

  // ── TITOLO ──
  doc.setTextColor(10,15,30);
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('Estratto Conto Fornitore', margin, y);
  y += 7;
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.setTextColor(37,99,235);
  doc.text(fornitoreNome, margin, y);
  y += 5;
  doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text('Periodo: ' + formatDate(from) + ' — ' + formatDate(to), margin, y);
  doc.text(currentBusiness?.name || '', W - margin, y, { align: 'right' });
  y += 10;

  // ── KPI BOX ──
  const kpiW = (W - margin * 2 - 12) / 4;
  const kpis = [
    { label: 'Fatturato', val: formatEur(totFatturato), color: [239,68,68] },
    { label: 'Assegni emessi', val: formatEur(totEmesso), color: [245,158,11] },
    { label: 'Saldo contabile', val: formatEur(saldoContabile), color: [245,158,11] },
    { label: 'Saldo effettivo', val: formatEur(saldoEffettivo), color: saldoEffettivo > 0 ? [239,68,68] : [16,185,129] }
  ];

  kpis.forEach((k, i) => {
    const x = margin + i * (kpiW + 4);
    doc.setFillColor(248,250,252);
    doc.roundedRect(x, y, kpiW, 16, 2, 2, 'F');
    doc.setDrawColor(...k.color);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, kpiW, 16, 2, 2, 'S');
    doc.setFontSize(7); doc.setFont('helvetica','bold');
    doc.setTextColor(107,114,128);
    doc.text(k.label.toUpperCase(), x + 4, y + 5.5);
    doc.setFontSize(10); doc.setTextColor(...k.color);
    doc.text(k.val, x + 4, y + 12);
  });
  y += 22;

  // ── TABELLA MOVIMENTI ──
  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.setTextColor(10,15,30);
  doc.text('Dettaglio movimenti', margin, y);
  y += 6;

  // Header tabella
  doc.setFillColor(10,15,30);
  doc.rect(margin, y, W - margin*2, 7, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text('DATA', margin+2, y+5);
  doc.text('TIPO', margin+24, y+5);
  doc.text('DESCRIZIONE', margin+44, y+5);
  doc.text('IMPORTO', margin+120, y+5);
  doc.text('S. CONTABILE', margin+145, y+5);
  doc.text('S. EFFETTIVO', W-margin-2, y+5, { align:'right' });
  y += 9;

  // Righe movimenti
  const movimenti = [
    ...(fatture||[]).map(f => ({
      data: f.data_fattura, tipo: 'Fattura',
      desc: (f.numero ? 'N° '+f.numero : '') + (f.data_scadenza ? ' scad.'+formatDate(f.data_scadenza) : ''),
      importo: Number(f.importo_totale), effetto: 'debito'
    })),
    ...(assegni||[]).map(a => {
      const isAd = (a.stato||'emesso') === 'addebitato';
      return {
        data: a.data_emissione, tipo: isAd ? 'Ass. addebitato' : 'Ass. emesso',
        desc: (a.numero ? 'N° '+a.numero+' ' : '') + 'scad.'+formatDate(a.data_scadenza),
        importo: Number(a.importo), effetto: isAd ? 'pagato' : 'emesso'
      };
    })
  ].sort((a,b) => new Date(a.data) - new Date(b.data));

  let sC = 0, sE = 0;
  doc.setFont('helvetica','normal');
  movimenti.forEach((m, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    if (m.effetto === 'debito') { sC += m.importo; sE += m.importo; }
    else if (m.effetto === 'emesso') { sC -= m.importo; }
    else if (m.effetto === 'pagato') { sE -= m.importo; }

    if (i % 2 === 0) { doc.setFillColor(248,250,252); doc.rect(margin, y-3, W-margin*2, 7, 'F'); }

    doc.setTextColor(107,114,128); doc.setFontSize(7.5);
    doc.text(formatDate(m.data), margin+2, y+2);
    doc.setTextColor(10,15,30);
    doc.text(m.tipo, margin+24, y+2);
    doc.text(m.desc.substring(0,28), margin+44, y+2);
    m.effetto === 'debito' ? doc.setTextColor(239,68,68) : doc.setTextColor(16,185,129);
    doc.setFont('helvetica','bold');
    doc.text((m.effetto==='debito'?'+':'-')+formatEur(m.importo), margin+120, y+2);
    sC >= 0 ? doc.setTextColor(245,158,11) : doc.setTextColor(16,185,129);
    doc.text(formatEur(sC), margin+145, y+2);
    sE >= 0 ? doc.setTextColor(239,68,68) : doc.setTextColor(16,185,129);
    doc.text(formatEur(sE), W-margin-2, y+2, { align:'right' });
    doc.setFont('helvetica','normal');
    y += 7;
  });

  // Riga totale
  y += 2;
  doc.setDrawColor(10,15,30); doc.setLineWidth(0.3);
  doc.line(margin, y, W-margin, y); y += 4;
  doc.setFillColor(10,15,30); doc.rect(margin, y, W-margin*2, 8, 'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text('TOTALE PERIODO', margin+2, y+5.5);
  doc.text(formatEur(totFatturato), margin+120, y+5.5);
  saldoContabile >= 0 ? doc.setTextColor(245,158,11) : doc.setTextColor(52,211,153);
  doc.text(formatEur(saldoContabile), margin+145, y+5.5);
  saldoEffettivo >= 0 ? doc.setTextColor(248,113,113) : doc.setTextColor(52,211,153);
  doc.text(formatEur(saldoEffettivo), W-margin-2, y+5.5, { align:'right' });

  // Footer
  doc.setPage(1);
  doc.setFontSize(7); doc.setTextColor(156,163,175); doc.setFont('helvetica','normal');
  doc.text('KONTRO — Prima nota digitale · www.kontro.cloud', margin, 290);

  const filename = 'KONTRO_Estratto_' + fornitoreNome.replace(/\s/g,'_') + '_' + from + '_' + to + '.pdf';
  doc.save(filename);
  showToast('PDF scaricato ✓', 'success');
}

// ============================================
// ESTRATTO CONTO BANCA
// ============================================
async function initEstrattoBanca() {
  const today = new Date().toISOString().split('T')[0];
  const firstMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const ebFrom = document.getElementById('eb-from');
  const ebTo = document.getElementById('eb-to');
  if (ebFrom && !ebFrom.value) ebFrom.value = firstMonth;
  if (ebTo && !ebTo.value) ebTo.value = today;

  // Popola select banca
  const sel = document.getElementById('eb-banca');
  if (sel) {
    sel.innerHTML = '<option value="">Seleziona banca</option>' +
      bancheCache.map(b => `<option value="${b.id}">${b.nome}${b.istituto ? ' — ' + b.istituto : ''}</option>`).join('');
  }
}

async function loadEstrattoBanca() {
  const bancaId = document.getElementById('eb-banca').value;
  const from = document.getElementById('eb-from').value;
  const to = document.getElementById('eb-to').value;
  const el = document.getElementById('estratto-banca-list');

  if (!bancaId || !currentBusiness) {
    el.innerHTML = '<div class="empty-state">Seleziona una banca</div>';
    return;
  }

  const banca = bancheCache.find(b => b.id === bancaId);

  // Carica tutti i movimenti della banca nel periodo
  const [{ data: versamenti }, { data: movimenti }, { data: assegniAd }] = await Promise.all([
    // Versamenti (entrate)
    db.from('versamenti').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('banca_id', bancaId)
      .gte('data_versamento', from).lte('data_versamento', to)
      .order('data_versamento'),
    // Movimenti manuali
    db.from('movimenti_banca').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('banca_id', bancaId)
      .gte('data', from).lte('data', to)
      .order('data'),
    // Assegni addebitati
    db.from('assegni').select('*')
      .eq('business_id', currentBusiness.id)
      .eq('banca_id', bancaId)
      .eq('stato', 'addebitato')
      .gte('data_incasso', from).lte('data_incasso', to)
      .order('data_incasso')
  ]);

  // Merge tutti i movimenti
  const allMov = [
    ...(versamenti||[]).map(v => ({
      data: v.data_versamento,
      tipo: '💵 Versamento',
      desc: 'Versamento cassa',
      importo: Number(v.importo_contante||0) + Number(v.importo_pos||0),
      segno: 'avere',
      dettaglio: `Contante: ${formatEur(v.importo_contante)} · POS: ${formatEur(v.importo_pos)}`
    })),
    ...(movimenti||[]).map(m => ({
      data: m.data,
      tipo: m.segno === 'avere' ? '↑ Entrata' : '↓ Uscita',
      desc: m.descrizione || m.tipo || '—',
      importo: Number(m.importo),
      segno: m.segno,
      dettaglio: m.tipo || ''
    })),
    ...(assegniAd||[]).map(a => ({
      data: a.data_incasso || a.data_scadenza,
      tipo: '📝 Assegno',
      desc: `Assegno ${a.numero ? 'N° '+a.numero : ''} — ${a.beneficiario || 'N/D'}`,
      importo: Number(a.importo),
      segno: 'dare',
      dettaglio: `Scadenza: ${formatDate(a.data_scadenza)}`
    }))
  ].sort((a, b) => new Date(a.data) - new Date(b.data));

  // Calcola totali
  const totEntrate = allMov.filter(m => m.segno === 'avere').reduce((s,m) => s + m.importo, 0);
  const totUscite = allMov.filter(m => m.segno === 'dare').reduce((s,m) => s + m.importo, 0);
  const saldoIniziale = Number(banca?.saldo_iniziale || 0);
  const saldoFinale = saldoIniziale + totEntrate - totUscite;

  document.getElementById('eb-saldo-iniziale').textContent = formatEur(saldoIniziale);
  document.getElementById('eb-tot-entrate').textContent = formatEur(totEntrate);
  document.getElementById('eb-tot-uscite').textContent = formatEur(totUscite);
  document.getElementById('eb-saldo-finale').textContent = formatEur(saldoFinale);
  document.getElementById('eb-saldo-finale').style.color = saldoFinale >= 0 ? 'var(--green-400)' : 'var(--red-400)';
  document.getElementById('eb-count').textContent = allMov.length + ' movimenti';

  if (!allMov.length) {
    el.innerHTML = '<div class="empty-state">Nessun movimento nel periodo</div>';
    return;
  }

  // Render con saldo progressivo
  let saldo = saldoIniziale;
  const header = '<div class="ec-header-row">'
    + '<span style="flex:0 0 28px"></span>'
    + '<span style="flex:1">Movimento</span>'
    + '<span style="min-width:110px;text-align:right;font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.06em">Importo</span>'
    + '<span style="min-width:120px;text-align:right;font-size:10px;color:var(--blue-300);text-transform:uppercase;letter-spacing:.06em">Saldo</span>'
    + '</div>';

  const rows = allMov.map((m, i) => {
    saldo += m.segno === 'avere' ? m.importo : -m.importo;
    const bg = i % 2 === 0 ? '' : 'background:rgba(255,255,255,0.015);';
    return '<div class="ec-item" style="' + bg + '">'
      + '<div class="ec-tipo" style="font-size:14px">' + m.tipo.split(' ')[0] + '</div>'
      + '<div class="ec-info">'
      + '<div class="ec-desc">' + (m.tipo.split(' ').slice(1).join(' ') || '') + ' — ' + m.desc + '</div>'
      + '<div class="ec-meta">' + formatDate(m.data) + (m.dettaglio ? ' · ' + m.dettaglio : '') + '</div>'
      + '</div>'
      + '<div class="ec-val ' + (m.segno === 'avere' ? 'avere' : 'dare') + '" style="min-width:110px;text-align:right">'
      + (m.segno === 'avere' ? '+' : '-') + formatEur(m.importo)
      + '</div>'
      + '<div style="min-width:120px;text-align:right;font-family:var(--font-mono);font-size:13px;font-weight:500;color:' + (saldo >= 0 ? 'var(--blue-300)' : 'var(--red-400)') + '">'
      + formatEur(saldo)
      + '</div>'
      + '</div>';
  });

  const footer = '<div class="ec-item" style="background:var(--navy-950);border:1px solid rgba(255,255,255,0.08);font-weight:700;margin-top:8px">'
    + '<div class="ec-tipo">📊</div>'
    + '<div class="ec-info"><div class="ec-desc" style="font-weight:700">SALDO FINALE</div></div>'
    + '<div style="min-width:110px"></div>'
    + '<div style="min-width:120px;text-align:right;font-family:var(--font-mono);font-size:15px;font-weight:700;color:' + (saldo >= 0 ? 'var(--green-400)' : 'var(--red-400)') + '">'
    + formatEur(saldo) + '</div></div>';

  el.innerHTML = header + rows.join('') + footer;

  // Salva dati per PDF
  window._estrattoBancaData = { banca, from, to, allMov, saldoIniziale, totEntrate, totUscite, saldoFinale };
}

async function exportEstrattoBancaPDF() {
  const d = window._estrattoBancaData;
  if (!d) { showToast('Carica prima l\'estratto conto', 'error'); return; }

  showToast('Generazione PDF...', '');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 16;
  let y = 0;

  // Header
  doc.setFillColor(10,15,30); doc.rect(0,0,W,38,'F');
  doc.setFillColor(37,99,235); doc.roundedRect(margin,10,16,16,2,2,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text('K', margin+8, 21, {align:'center'});
  doc.setFontSize(18); doc.text('KONTRO', margin+20, 21);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.setTextColor(156,163,175);
  doc.text('Generato il ' + new Date().toLocaleDateString('it-IT'), W-margin, 21, {align:'right'});
  y = 46;

  // Titolo
  doc.setTextColor(10,15,30); doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('Estratto Conto Bancario', margin, y); y += 7;
  doc.setFontSize(11); doc.setTextColor(37,99,235);
  doc.text(d.banca?.nome + (d.banca?.istituto ? ' — ' + d.banca.istituto : ''), margin, y); y += 5;
  doc.setFontSize(9); doc.setTextColor(107,114,128);
  doc.text('Periodo: ' + formatDate(d.from) + ' — ' + formatDate(d.to), margin, y);
  doc.text(currentBusiness?.name || '', W-margin, y, {align:'right'}); y += 10;

  // KPI
  const kpiW = (W - margin*2 - 12)/4;
  const kpis = [
    {label:'Saldo iniziale', val:formatEur(d.saldoIniziale), color:[37,99,235]},
    {label:'Entrate', val:formatEur(d.totEntrate), color:[16,185,129]},
    {label:'Uscite', val:formatEur(d.totUscite), color:[239,68,68]},
    {label:'Saldo finale', val:formatEur(d.saldoFinale), color:d.saldoFinale>=0?[16,185,129]:[239,68,68]}
  ];
  kpis.forEach((k,i) => {
    const x = margin + i*(kpiW+4);
    doc.setFillColor(248,250,252); doc.roundedRect(x,y,kpiW,16,2,2,'F');
    doc.setDrawColor(...k.color); doc.setLineWidth(0.8); doc.roundedRect(x,y,kpiW,16,2,2,'S');
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(107,114,128);
    doc.text(k.label.toUpperCase(), x+4, y+5.5);
    doc.setFontSize(10); doc.setTextColor(...k.color);
    doc.text(k.val, x+4, y+12);
  });
  y += 22;

  // Tabella
  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,15,30);
  doc.text('Dettaglio movimenti', margin, y); y += 6;
  doc.setFillColor(10,15,30); doc.rect(margin,y,W-margin*2,7,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text('DATA', margin+2, y+5);
  doc.text('TIPO', margin+24, y+5);
  doc.text('DESCRIZIONE', margin+50, y+5);
  doc.text('IMPORTO', margin+130, y+5);
  doc.text('SALDO', W-margin-2, y+5, {align:'right'});
  y += 9;

  let saldo = d.saldoIniziale;
  d.allMov.forEach((m, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    saldo += m.segno === 'avere' ? m.importo : -m.importo;
    if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(margin,y-3,W-margin*2,7,'F'); }
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.setTextColor(107,114,128); doc.text(formatDate(m.data), margin+2, y+2);
    doc.setTextColor(10,15,30); doc.text(m.tipo.replace(/[^\x00-\x7F]/g,'').trim(), margin+24, y+2);
    doc.text(m.desc.substring(0,35), margin+50, y+2);
    m.segno==='avere' ? doc.setTextColor(16,185,129) : doc.setTextColor(239,68,68);
    doc.setFont('helvetica','bold');
    doc.text((m.segno==='avere'?'+':'-')+formatEur(m.importo), margin+130, y+2);
    saldo>=0 ? doc.setTextColor(37,99,235) : doc.setTextColor(239,68,68);
    doc.text(formatEur(saldo), W-margin-2, y+2, {align:'right'});
    doc.setFont('helvetica','normal');
    y += 7;
  });

  // Totale
  y += 2;
  doc.setDrawColor(10,15,30); doc.setLineWidth(0.3); doc.line(margin,y,W-margin,y); y += 4;
  doc.setFillColor(10,15,30); doc.rect(margin,y,W-margin*2,8,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text('SALDO FINALE', margin+2, y+5.5);
  d.saldoFinale>=0 ? doc.setTextColor(52,211,153) : doc.setTextColor(248,113,113);
  doc.text(formatEur(d.saldoFinale), W-margin-2, y+5.5, {align:'right'});

  doc.setPage(1); doc.setFontSize(7); doc.setTextColor(156,163,175); doc.setFont('helvetica','normal');
  doc.text('KONTRO — Prima nota digitale · www.kontro.cloud', margin, 290);

  const filename = 'KONTRO_Banca_' + (d.banca?.nome||'').replace(/\s/g,'_') + '_' + d.from + '_' + d.to + '.pdf';
  doc.save(filename);
  showToast('PDF scaricato ✓', 'success');
}

// ============================================
// PREVISIONI DASHBOARD
// ============================================

async function loadPrevisioni() {
  if (!currentBusiness) return;
  await Promise.all([
    buildPrevisioneIncasso(),
    buildFabbisognoFinanziario()
  ]);
}

// ── PREVISIONE INCASSO ─────────────────────────────────────────────
async function buildPrevisioneIncasso() {
  const el = document.getElementById('prev-incasso-content');
  if (!el) return;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Prendo storico ultimi 8 settimane dalla prima nota
  const otto = new Date(today); otto.setDate(otto.getDate() - 56);
  const ottoStr = otto.toISOString().split('T')[0];

  const { data: note } = await db.from('daily_notes')
    .select('data, incasso_giornaliero, incasso_m, incasso_p, incasso_s')
    .eq('business_id', currentBusiness.id)
    .gte('data', ottoStr)
    .order('data');

  const storici = note || [];

  // Calcolo media per giorno della settimana (0=dom, 1=lun, ...)
  const mediaDow = Array(7).fill(0).map(() => ({ tot: 0, n: 0 }));
  storici.forEach(n => {
    const dow = new Date(n.data + 'T12:00:00').getDay();
    const inc = Number(n.incasso_giornaliero || 0);
    if (inc > 0) {
      mediaDow[dow].tot += inc;
      mediaDow[dow].n++;
    }
  });

  const mediaGiorno = mediaDow.map(d => d.n > 0 ? d.tot / d.n : 0);
  const dowLabels = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

  // Prossimi 7 giorni
  const giorni = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const dStr = d.toISOString().split('T')[0];
    const dow = d.getDay();
    const previsto = mediaGiorno[dow];

    // Cerca dato reale se già registrato
    const reale = storici.find(n => n.data === dStr);
    const incReale = reale ? Number(reale.incasso_giornaliero || 0) : null;

    giorni.push({
      data: dStr,
      label: i === 0 ? 'Oggi' : i === 1 ? 'Domani' : dowLabels[dow] + ' ' + d.getDate() + '/' + (d.getMonth()+1),
      previsto,
      reale: incReale,
      isOggi: i === 0,
      dow
    });
  }

  const maxVal = Math.max(...giorni.map(g => Math.max(g.previsto, g.reale || 0)), 1);

  // Accuracy badge
  const accuracy = storici.length;
  const badge = document.getElementById('prev-accuracy');
  if (badge) {
    if (accuracy >= 14) { badge.textContent = 'Alta precisione (' + accuracy + ' giorni)'; badge.className = 'prev-badge ok'; }
    else if (accuracy >= 7) { badge.textContent = 'Media precisione (' + accuracy + ' giorni)'; badge.className = 'prev-badge warning'; }
    else { badge.textContent = 'Dati insufficienti'; badge.className = 'prev-badge'; }
  }

  el.innerHTML = '<div class="prev-incasso-list">'
    + giorni.map(g => {
      const val = g.reale !== null ? g.reale : g.previsto;
      const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      const isReale = g.reale !== null;
      const barClass = g.isOggi ? 'og-bar' : isReale ? 'storico' : '';
      const valClass = g.isOggi ? 'oggi-val' : isReale ? 'storico' : '';

      return '<div class="prev-giorno' + (g.isOggi ? ' oggi' : '') + '">'
        + '<div class="pg-data">' + g.label + '</div>'
        + '<div class="pg-bar-wrap"><div class="pg-bar ' + barClass + '" style="width:' + pct + '%"></div></div>'
        + '<div class="pg-val ' + valClass + '">'
        + (isReale ? '' : '~') + formatEur(val)
        + (isReale ? ' ✓' : '')
        + '</div>'
        + '</div>';
    }).join('')
    + '</div>'
    + '<div style="margin-top:10px;font-size:11px;font-family:var(--font-mono);color:var(--gray-500)">'
    + '✓ = dato reale · ~ = previsione basata su media storica per giorno settimana'
    + '</div>';
}

// ── FABBISOGNO FINANZIARIO ─────────────────────────────────────────
async function buildFabbisognoFinanziario() {
  const el = document.getElementById('prev-fabbisogno-content');
  if (!el) return;

  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split('T')[0];

  // Dati finanziari
  const [{ data: vers }, { data: movUsc }, { data: assegni }, { data: rid }, { data: fatture }, { data: noteStorico }] = await Promise.all([
    db.from('versamenti').select('importo_contante,importo_pos').eq('business_id', currentBusiness.id),
    db.from('movimenti_banca').select('importo').eq('business_id', currentBusiness.id).eq('segno','dare'),
    db.from('assegni').select('importo,data_scadenza,beneficiario,stato').eq('business_id', currentBusiness.id).eq('stato','emesso').lte('data_scadenza', in30str),
    db.from('rid_bancari').select('*').eq('business_id', currentBusiness.id).eq('attivo', true).lte('prossimo_addebito', in30str),
    db.from('fatture_fornitori').select('importo_totale,data_scadenza,fornitori(ragione_sociale)').eq('business_id', currentBusiness.id).in('stato',['aperta','pagata_parziale']).lte('data_scadenza', in30str),
    db.from('daily_notes').select('data,incasso_giornaliero').eq('business_id', currentBusiness.id).gte('data', new Date(new Date().setDate(new Date().getDate()-28)).toISOString().split('T')[0]).order('data')
  ]);

  // Saldo banche attuale
  let saldoBanche = bancheCache.reduce((s,b) => s + Number(b.saldo_iniziale||0), 0);
  saldoBanche += (vers||[]).reduce((s,v) => s + Number(v.importo_contante||0) + Number(v.importo_pos||0), 0);
  saldoBanche -= (movUsc||[]).reduce((s,m) => s + Number(m.importo||0), 0);

  // Previsione incasso prossimi 30 giorni (basata su media settimanale)
  const noteArr = noteStorico || [];
  const mediaDow2 = Array(7).fill(0).map(() => ({ tot:0, n:0 }));
  noteArr.forEach(n => {
    const dow = new Date(n.data + 'T12:00:00').getDay();
    const inc = Number(n.incasso_giornaliero||0);
    if (inc > 0) { mediaDow2[dow].tot += inc; mediaDow2[dow].n++; }
  });
  const mediaG2 = mediaDow2.map(d => d.n > 0 ? d.tot/d.n : 0);

  let prevIncasso30 = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    prevIncasso30 += mediaG2[d.getDay()];
  }

  // Costruisci eventi futuri
  const eventi = [];

  (assegni||[]).forEach(a => {
    if (a.data_scadenza >= today) {
      eventi.push({ data: a.data_scadenza, desc: 'Assegno — ' + (a.beneficiario||'N/D'), importo: -Number(a.importo), tipo: 'assegno' });
    }
  });

  (rid||[]).forEach(r => {
    if (r.prossimo_addebito && r.prossimo_addebito >= today) {
      eventi.push({ data: r.prossimo_addebito, desc: 'RID — ' + r.nome, importo: -Number(r.importo), tipo: 'rid' });
    }
  });

  (fatture||[]).forEach(f => {
    if (f.data_scadenza && f.data_scadenza >= today) {
      eventi.push({ data: f.data_scadenza, desc: 'Fattura — ' + (f.fornitori?.ragione_sociale||'N/D'), importo: -Number(f.importo_totale), tipo: 'fattura' });
    }
  });

  eventi.sort((a,b) => new Date(a.data) - new Date(b.data));

  const totUscite30 = eventi.reduce((s,e) => s + Math.abs(e.importo), 0);
  const dispFinale = saldoBanche + prevIncasso30 - totUscite30;

  // Status badge
  const badge = document.getElementById('fab-status');
  if (badge) {
    if (dispFinale < 0) { badge.textContent = '⚠ Deficit previsto'; badge.className = 'prev-badge danger'; }
    else if (dispFinale < totUscite30 * 0.2) { badge.textContent = '⚡ Attenzione liquidità'; badge.className = 'prev-badge warning'; }
    else { badge.textContent = '✓ Situazione equilibrata'; badge.className = 'prev-badge ok'; }
  }

  // Saldo progressivo
  let saldo = saldoBanche;
  const eventiRows = eventi.slice(0, 10).map(e => {
    saldo += e.importo;
    const cls = saldo < 0 ? 'negativo' : Math.abs(e.importo) > saldoBanche * 0.2 ? 'warning' : 'ok';
    return '<div class="fab-evento ' + cls + '">'
      + '<span class="fe-data">' + formatDate(e.data) + '</span>'
      + '<span class="fe-desc">' + e.desc + '</span>'
      + '<span class="fe-importo" style="color:var(--red-400)">' + formatEur(Math.abs(e.importo)) + '</span>'
      + '<span class="fe-saldo" style="color:' + (saldo >= 0 ? 'var(--blue-300)' : 'var(--red-400)') + '">' + formatEur(saldo) + '</span>'
      + '</div>';
  }).join('');

  el.innerHTML = '<div class="fab-summary">'
    + '<div class="fab-kpi"><div class="fab-kpi-label">Saldo banche oggi</div><div class="fab-kpi-val ' + (saldoBanche>=0?'blue':'red') + '">' + formatEur(saldoBanche) + '</div></div>'
    + '<div class="fab-kpi"><div class="fab-kpi-label">Incasso previsto 30gg</div><div class="fab-kpi-val green">' + formatEur(prevIncasso30) + '</div></div>'
    + '<div class="fab-kpi"><div class="fab-kpi-label">Uscite previste 30gg</div><div class="fab-kpi-val red">' + formatEur(totUscite30) + '</div></div>'
    + '<div class="fab-kpi"><div class="fab-kpi-label">Disponibilità finale</div><div class="fab-kpi-val ' + (dispFinale>=0?'green':'red') + '">' + formatEur(dispFinale) + '</div></div>'
    + '</div>'
    + (eventi.length > 0
      ? '<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-500);padding:0 4px;margin-bottom:6px">'
        + '<span>Evento</span><span>Importo</span><span>Saldo prev.</span></div>'
        + '<div class="fab-eventi">' + eventiRows + '</div>'
      : '<div class="empty-state">Nessuna uscita prevista nei prossimi 30 giorni 🎉</div>');

  // Aggiungi conciliazione fiscale
  await buildConciliazioneFiscale();
}

// ============================================
// CONCILIAZIONE FISCALE
// ============================================
async function buildConciliazioneFiscale(periodo) {
  const el = document.getElementById('dash-conciliazione');
  if (!el) return;

  // Periodo selezionato
  const selEl = document.getElementById('cf-periodo');
  const per = periodo || selEl?.value || 'mese';
  const now = new Date();
  let dataFrom;
  if (per === 'settimana') { const d = new Date(now); d.setDate(d.getDate()-d.getDay()+1); dataFrom = d.toISOString().split('T')[0]; }
  else if (per === 'anno') dataFrom = now.getFullYear() + '-01-01';
  else if (per === 'tutto') dataFrom = '2020-01-01';
  else dataFrom = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';

  const [{ data: note }, { data: vers }] = await Promise.all([
    db.from('daily_notes')
      .select('incasso_eff,money_eff,grattavinci_eff,sisal_eff,conto_bet_eff,incasso_m,incasso_p,incasso_s,money_m,money_p,money_s,grattavinci_m,grattavinci_p,grattavinci_s,sisal_m,sisal_p,sisal_s,conto_bet_m,conto_bet_p,conto_bet_s,carte_m,carte_p,carte_s,bonifici_m,bonifici_p,bonifici_s')
      .eq('business_id', currentBusiness.id).gte('data', dataFrom),
    db.from('versamenti').select('importo_contante,importo_pos')
      .eq('business_id', currentBusiness.id).gte('data_versamento', dataFrom)
  ]);

  // Calcola totali fiscali dalle note
  // Se _eff è salvato usa quello, altrimenti calcola da M/P/S
  function effNote(n, campo) {
    if (n[campo+'_eff'] > 0) return Number(n[campo+'_eff']||0);
    const s = Number(n[campo+'_s']||0), p = Number(n[campo+'_p']||0), m = Number(n[campo+'_m']||0);
    if (s > 0) return s;
    if (p > 0) return p;
    return m;
  }

  const totIncasso     = (note||[]).reduce((a,n) => a + effNote(n,'incasso'), 0);
  const totMoney       = (note||[]).reduce((a,n) => a + effNote(n,'money'), 0);
  const totGrattavinci = (note||[]).reduce((a,n) => a + effNote(n,'grattavinci'), 0);
  const totSisal       = (note||[]).reduce((a,n) => a + effNote(n,'sisal'), 0);
  const totContoBet    = (note||[]).reduce((a,n) => a + effNote(n,'conto_bet'), 0);
  const totCarte       = (note||[]).reduce((a,n) => a + effNote(n,'carte'), 0);
  const totBonifici    = (note||[]).reduce((a,n) => a + effNote(n,'bonifici'), 0);

  // Totale fiscale = solo Incasso Cassa
  const totFiscale = totIncasso;
  // Totale cash gestito = tutte le voci
  const totCash = totIncasso + totMoney + totGrattavinci + totSisal + totContoBet;

  // Versamenti in banca = contante+POS versati + carte + bonifici (già in banca)
  const totContante = (vers||[]).reduce((a,v) => a + Number(v.importo_contante||0), 0);
  const totPOS      = (vers||[]).reduce((a,v) => a + Number(v.importo_pos||0), 0);
  const totVersato  = totContante + totPOS + totCarte + totBonifici;

  // Delta fiscale vs versato
  const delta = totFiscale - totVersato;
  const isAlert = delta < 0; // versato > fiscale = problema!

  const labels = { mese: 'Mese corrente', settimana: 'Settimana corrente', anno: "Quest'anno", tutto: 'Tutto' };
  const fmtE = v => '€ ' + Math.abs(v).toFixed(2).replace('.',',');
  const fmtS = v => (v >= 0 ? '+ ' : '- ') + fmtE(v);
  const clr  = v => v >= 0 ? 'var(--green-400)' : 'var(--red-400)';

  el.innerHTML = `
    <div class="section-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h2>⚖️ Conciliazione fiscale — ${labels[per]||per}</h2>
        <select id="cf-periodo" class="pn-desc-input" style="width:auto;font-size:12px" onchange="buildConciliazioneFiscale(this.value)">
          <option value="settimana" ${per==='settimana'?'selected':''}>Settimana</option>
          <option value="mese" ${per==='mese'?'selected':''}>Mese corrente</option>
          <option value="anno" ${per==='anno'?'selected':''}>Quest'anno</option>
          <option value="tutto" ${per==='tutto'?'selected':''}>Tutto</option>
        </select>
      </div>

      ${isAlert ? `<div class="pn-allarme" style="display:flex;margin-bottom:16px">
        ⚠️ ATTENZIONE: hai versato in banca <strong>${fmtE(totVersato)}</strong> ma il fiscale dichiarato è solo <strong>${fmtE(totFiscale)}</strong>. Differenza: ${fmtE(Math.abs(delta))} in eccesso.
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">

        <div class="section-card" style="margin:0">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--gray-400);margin-bottom:10px">📊 Cash gestito</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Incasso cassa <span style="font-size:10px;color:var(--blue-400)">(fiscale)</span></span>
            <strong style="color:var(--green-400)">${fmtE(totIncasso)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Ricariche / Pagamenti</span>
            <span>${fmtE(totMoney)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Gratta e Vinci</span>
            <span>${fmtE(totGrattavinci)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Sisal</span>
            <span>${fmtE(totSisal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Scommesse / Bet</span>
            <span>${fmtE(totContoBet)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 0">
            <strong>Totale cash gestito</strong>
            <strong style="color:var(--blue-300)">${fmtE(totCash)}</strong>
          </div>
        </div>

        <div class="section-card" style="margin:0">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--gray-400);margin-bottom:10px">🏦 Versato in banca</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Contante versato</span>
            <span>${fmtE(totContante)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">POS versato</span>
            <span>${fmtE(totPOS)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Carte di credito</span>
            <span>${fmtE(totCarte)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">Bonifici bancari</span>
            <span>${fmtE(totBonifici)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 0">
            <strong>Totale versato</strong>
            <strong style="color:var(--blue-300)">${fmtE(totVersato)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:8px;border-top:2px solid var(--border)">
            <strong>Fiscale vs Versato</strong>
            <strong style="color:${clr(delta)}">${fmtS(delta)}</strong>
          </div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:4px">
            ${delta >= 0 ? '✓ Differenza gestita internamente (fondo cassa, spese cash)' : '⚠️ Versato supera il fiscale dichiarato — verificare'}
          </div>
        </div>

      </div>
    </div>`;
}

// ============================================
// CONTO BET — Prima Nota
// ============================================

function populatePNBetSelect() {
  const sel = document.getElementById('pn-bet-banca');
  if (!sel) return;
  const betBanche = bancheCache.filter(b => b.tipo === 'bet');
  sel.innerHTML = '<option value="">— Seleziona conto bet —</option>' +
    betBanche.map(b => `<option value="${b.id}">${b.nome}</option>`).join('');
}

// populatePNBetSelect chiamata direttamente da showView



// Aggiorna salvaNotaGiorno per scalare automaticamente dal conto bet
async function scalaCcontoBet(betBancaId, totBet, data) {
  if (!betBancaId || !totBet || totBet <= 0 || !currentBusiness) return;

  // Registra movimento dare (uscita) sul conto bet
  await db.from('movimenti_banca').insert({
    business_id: currentBusiness.id,
    banca_id: betBancaId,
    data: data,
    segno: 'dare',
    tipo: 'bet',
    descrizione: 'Giocate giornaliere — Prima Nota ' + formatDate(data),
    importo: totBet
  });
}

// ============================================
// HR — DIPENDENTI
// ============================================
let dipendentiCache = [];

function switchHRTab(tab) {
  document.querySelectorAll('.banca-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.banca-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('hrtab-' + tab).classList.add('active');
  document.getElementById('hrpanel-' + tab).classList.add('active');
  if (tab === 'organico') initOrganico();
  if (tab === 'turni') initTurni();
  if (tab === 'presenze') initPresenze();
  if (tab === 'acconti') initAcconti();
  if (tab === 'export') initExportHR();
}

async function initHR() {
  await loadDipendentiCache();
  loadDipendentiList();
}

async function loadDipendentiCache() {
  if (!currentBusiness) return;
  const { data } = await db.from('dipendenti').select('*')
    .eq('business_id', currentBusiness.id)
    .eq('attivo', true).order('cognome');
  dipendentiCache = data || [];
}

function populateDipendentiSelects() {
  const opts = '<option value="">Seleziona dipendente</option>' +
    dipendentiCache.map(d => `<option value="${d.id}">${d.nome} ${d.cognome}</option>`).join('');
  ['pres-dipendente','acc-dipendente','exp-dipendente','acc-filter-dip'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const first = id === 'acc-filter-dip' ? '<option value="">Tutti i dipendenti</option>'
      : id === 'exp-dipendente' ? '<option value="">Tutti</option>'
      : '<option value="">Seleziona dipendente</option>';
    el.innerHTML = first + dipendentiCache.map(d =>
      `<option value="${d.id}">${d.nome} ${d.cognome}</option>`).join('');
  });
}

// ── ANAGRAFICA ────────────────────────────────────────────────────
function showAddDipendente() { document.getElementById('add-dipendente-form').classList.remove('hidden'); populateSedeDipendente(); }
function hideAddDipendente() { document.getElementById('add-dipendente-form').classList.add('hidden'); }

async function saveDipendente() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nd-nome').value.trim();
  const cognome = document.getElementById('nd-cognome').value.trim();
  if (!nome || !cognome) { showToast('Inserisci nome e cognome', 'error'); return; }
  const { error } = await db.from('dipendenti').insert({
    business_id: currentBusiness.id,
    nome, cognome,
    ruolo: document.getElementById('nd-ruolo').value.trim(),
    location_id: document.getElementById('nd-sede').value || null,
    data_assunzione: document.getElementById('nd-assunzione').value || null,
    note: document.getElementById('nd-note').value.trim(),
    telefono: document.getElementById('nd-telefono').value.trim(),
    colore: document.getElementById('nd-colore')?.value || '#3b82f6'
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Dipendente salvato ✓', 'success');
  hideAddDipendente();
  ['nd-nome','nd-cognome','nd-ruolo','nd-note','nd-telefono'].forEach(id => document.getElementById(id).value = '');
  await loadDipendentiCache();
  populateDipendentiSelects();
  loadDipendentiList();
}

async function loadDipendentiList() {
  if (!currentBusiness) return;
  const { data } = await db.from('dipendenti').select('*, locations(name)')
    .eq('business_id', currentBusiness.id).order('cognome');
  const el = document.getElementById('dipendenti-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun dipendente registrato</div>'; return; }

  // Raggruppa per sede
  const bySede = {};
  data.forEach(d => {
    const sedeNome = d.locations?.name || 'Sede principale';
    if (!bySede[sedeNome]) bySede[sedeNome] = [];
    bySede[sedeNome].push(d);
  });

  el.innerHTML = Object.entries(bySede).map(([sede, dips]) => `
    <div class="sede-gruppo">
      <div class="sede-gruppo-label">📍 ${sede}</div>
      ${dips.map(d => `
        <div class="dipendente-item">
          <div class="dip-avatar">${d.nome[0]}${d.cognome[0]}</div>
          <div class="dip-info">
            <div class="dip-nome">${d.nome} ${d.cognome}</div>
            <div class="dip-ruolo">${d.ruolo || '—'}${d.data_assunzione ? ' · dal ' + formatDate(d.data_assunzione) : ''}${d.telefono ? ' · 📞 ' + d.telefono : ''}</div>
          </div>
          <button class="btn-secondary sm" onclick="switchHRTab('presenze');document.getElementById('pres-dipendente').value='${d.id}';loadPresenzeMese()">Presenze</button>
          <button class="btn-secondary sm" onclick="switchHRTab('acconti');document.getElementById('acc-dipendente').value='${d.id}'">Acconti</button>
          <button class="entry-del" onclick="deleteDipendente('${d.id}')">✕</button>
        </div>`).join('')}
    </div>`).join('');
}

async function deleteDipendente(id) {
  // Conta dati storici collegati
  const [{ count: cPresenze }, { count: cAcconti }, { count: cTurni }] = await Promise.all([
    db.from('presenze').select('id', { count: 'exact', head: true }).eq('dipendente_id', id),
    db.from('acconti_stipendio').select('id', { count: 'exact', head: true }).eq('dipendente_id', id),
    db.from('turni_dipendenti').select('id', { count: 'exact', head: true }).eq('dipendente_id', id)
  ]);

  const totale = (cPresenze||0) + (cAcconti||0) + (cTurni||0);

  if (totale > 0) {
    const dettaglio = [
      cPresenze > 0 ? `${cPresenze} presenze` : '',
      cAcconti  > 0 ? `${cAcconti} acconti` : '',
      cTurni    > 0 ? `${cTurni} turni` : ''
    ].filter(Boolean).join(', ');

    if (!confirm(`Questo dipendente ha dati storici (${dettaglio}).\nVerrà disattivato ma non eliminato per conservare lo storico.\nContinuare?`)) return;
    const { error } = await db.from('dipendenti').update({ attivo: false }).eq('id', id);
    if (error) { showToast('Errore: ' + error.message, 'error'); return; }
    showToast('Dipendente disattivato', 'success');
  } else {
    if (!confirm('Eliminare definitivamente questo dipendente?\nL\'operazione è irreversibile.')) return;
    const { error } = await db.from('dipendenti').delete().eq('id', id);
    if (error) { showToast('Errore eliminazione: ' + error.message, 'error'); return; }
    showToast('Dipendente eliminato', 'success');
  }

  await loadDipendentiCache();
  populateDipendentiSelects();
  loadDipendentiList();
}

// ── PRESENZE ──────────────────────────────────────────────────────
function initPresenze() {
  populateDipendentiSelects();
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const meseEl = document.getElementById('pres-mese');
  const annoEl = document.getElementById('pres-anno');
  if (meseEl && !meseEl.options.length) {
    months.forEach((m,i) => {
      const o = document.createElement('option');
      o.value = i+1; o.textContent = m;
      if (i === new Date().getMonth()) o.selected = true;
      meseEl.appendChild(o);
    });
  }
  if (annoEl && !annoEl.options.length) {
    for (let y = new Date().getFullYear(); y >= 2023; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      if (y === new Date().getFullYear()) o.selected = true;
      annoEl.appendChild(o);
    }
  }
  const npData = document.getElementById('np-data');
  if (npData && !npData.value) npData.value = new Date().toISOString().split('T')[0];
}

function showAddPresenza() { document.getElementById('add-presenza-form').classList.remove('hidden'); }
function hideAddPresenza() { document.getElementById('add-presenza-form').classList.add('hidden'); }

async function savePresenza() {
  const dipId = document.getElementById('pres-dipendente').value;
  const data = document.getElementById('np-data').value;
  const tipo = document.getElementById('np-tipo').value;
  if (!dipId) { showToast('Seleziona dipendente', 'error'); return; }
  if (!data) { showToast('Inserisci la data', 'error'); return; }
  const { error } = await db.from('presenze').upsert({
    business_id: currentBusiness.id,
    dipendente_id: dipId,
    data, tipo,
    ore: parseFloat(document.getElementById('np-ore').value) || 0,
    motivazione: document.getElementById('np-motivazione').value.trim()
  }, { onConflict: 'dipendente_id,data,tipo' });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Presenza salvata ✓', 'success');
  hideAddPresenza();
  loadPresenzeMese();
}

async function loadPresenzeMese() {
  const dipId = document.getElementById('pres-dipendente').value;
  const mese = parseInt(document.getElementById('pres-mese')?.value);
  const anno = parseInt(document.getElementById('pres-anno')?.value);
  const el = document.getElementById('presenze-list');
  if (!dipId) { el.innerHTML = '<div class="empty-state">Seleziona dipendente e mese</div>'; return; }

  const from = `${anno}-${String(mese).padStart(2,'0')}-01`;
  const lastDay = new Date(anno, mese, 0).getDate();
  const to = `${anno}-${String(mese).padStart(2,'0')}-${lastDay}`;

  const { data } = await db.from('presenze').select('*')
    .eq('dipendente_id', dipId).gte('data', from).lte('data', to).order('data');

  const presenze = data || [];
  const tipoLabels = { assenza:'Assenza', ferie:'Ferie', permesso:'Permesso', straordinario:'Straordinario', festivo:'Festivo' };

  // KPI
  document.getElementById('pr-lavoro').textContent = presenze.filter(p => p.tipo === 'lavoro').length || '—';
  document.getElementById('pr-assenze').textContent = presenze.filter(p => p.tipo === 'assenza').length;
  document.getElementById('pr-ferie').textContent = presenze.filter(p => ['ferie','permesso'].includes(p.tipo)).length;
  const straOre = presenze.filter(p => ['straordinario','festivo'].includes(p.tipo)).reduce((s,p) => s + Number(p.ore||0), 0);
  document.getElementById('pr-straordinari').textContent = straOre + 'h';

  if (!presenze.length) { el.innerHTML = '<div class="empty-state">Nessuna assenza/straordinario registrato</div>'; return; }

  el.innerHTML = presenze.map(p => `
    <div class="presenza-card ${p.tipo}">
      <button class="pc-del" onclick="deletePresenza('${p.id}')">✕</button>
      <div class="pc-data">${formatDate(p.data)}</div>
      <div class="pc-tipo ${p.tipo}">${tipoLabels[p.tipo] || p.tipo}${p.ore ? ' · ' + p.ore + 'h' : ''}</div>
      ${p.motivazione ? `<div class="pc-note">${p.motivazione}</div>` : ''}
    </div>`).join('');
}

async function deletePresenza(id) {
  await db.from('presenze').delete().eq('id', id);
  loadPresenzeMese();
  showToast('Presenza eliminata', 'success');
}

// ── ACCONTI ───────────────────────────────────────────────────────
function initAcconti() {
  populateDipendentiSelects();
  const accData = document.getElementById('acc-data');
  if (accData && !accData.value) accData.value = new Date().toISOString().split('T')[0];
  const accBanca = document.getElementById('acc-banca');
  if (accBanca) {
    accBanca.innerHTML = '<option value="">Seleziona banca</option>' +
      bancheCache.filter(b => b.tipo !== 'bet').map(b => `<option value="${b.id}">${b.nome}</option>`).join('');
  }
  loadAcconti();
}

function toggleAccBanca() {
  const tipo = document.getElementById('acc-tipo').value;
  const wrap = document.getElementById('acc-banca-wrap');
  if (wrap) wrap.style.display = tipo === 'bonifico' ? 'block' : 'none';
}

async function saveAcconto() {
  if (!currentBusiness) return;
  const dipId = document.getElementById('acc-dipendente').value;
  const importo = parseFloat(document.getElementById('acc-importo').value);
  const tipo = document.getElementById('acc-tipo').value;
  const data = document.getElementById('acc-data').value;
  if (!dipId) { showToast('Seleziona dipendente', 'error'); return; }
  if (!importo || importo <= 0) { showToast('Inserisci importo', 'error'); return; }

  const { error } = await db.from('acconti_stipendio').insert({
    business_id: currentBusiness.id,
    dipendente_id: dipId,
    data, importo, tipo,
    banca_id: document.getElementById('acc-banca').value || null,
    note: document.getElementById('acc-note').value.trim(),
    created_by: currentUser.id
  });
  if (error) { showToast('Errore: ' + error.message, 'error'); return; }

  // Collegamento automatico
  const dip = dipendentiCache.find(d => d.id === dipId);
  const dipNome = dip ? dip.nome + ' ' + dip.cognome : 'Dipendente';

  if (tipo === 'contanti_cassa') {
    // Registra uscita in cash_entries
    await db.from('cash_entries').insert({
      business_id: currentBusiness.id,
      user_id: currentUser.id,
      type: 'uscita', amount: importo,
      description: 'Acconto stipendio — ' + dipNome,
      payment_method: 'contanti', entry_date: data
    });
  } else if (tipo === 'bonifico') {
    const bancaId = document.getElementById('acc-banca').value;
    if (bancaId) {
      await db.from('movimenti_banca').insert({
        business_id: currentBusiness.id,
        banca_id: bancaId, data,
        segno: 'dare', tipo: 'bonifico',
        descrizione: 'Acconto stipendio — ' + dipNome,
        importo
      });
    }
  }

  showToast('Acconto registrato ✓', 'success');
  ['acc-importo','acc-note'].forEach(id => document.getElementById(id).value = '');
  loadAcconti();
}

async function loadAcconti() {
  if (!currentBusiness) return;
  const dipFilter = document.getElementById('acc-filter-dip')?.value;
  let query = db.from('acconti_stipendio')
    .select('*, dipendenti(nome,cognome)')
    .eq('business_id', currentBusiness.id)
    .order('data', { ascending: false }).limit(30);
  if (dipFilter) query = query.eq('dipendente_id', dipFilter);
  const { data } = await query;
  const el = document.getElementById('acconti-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state">Nessun acconto registrato</div>'; return; }

  const tipoLabel = { contanti_cassa:'💵 Cassa', contanti_extra:'💰 Extra', bonifico:'🏦 Bonifico', fuori_busta:'🤫 Fuori busta' };

  el.innerHTML = data.map(a => `
    <div class="acconto-item">
      <div class="entry-dot uscita"></div>
      <div class="entry-info">
        <div class="entry-desc">${a.dipendenti?.nome || ''} ${a.dipendenti?.cognome || ''}</div>
        <div class="entry-meta">${formatDate(a.data)}${a.note ? ' · ' + a.note : ''}</div>
      </div>
      <span class="acc-tipo-badge ${a.tipo}">${tipoLabel[a.tipo] || a.tipo}</span>
      <div class="entry-amount uscita">- ${formatEur(a.importo)}</div>
      <button class="entry-del" onclick="deleteAcconto('${a.id}')">✕</button>
    </div>`).join('');
}

async function deleteAcconto(id) {
  await db.from('acconti_stipendio').delete().eq('id', id);
  loadAcconti();
  showToast('Acconto eliminato', 'success');
}

// ── EXPORT CONSULENTE ─────────────────────────────────────────────
function initExportHR() {
  populateDipendentiSelects();
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  ['exp-mese'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.options.length) {
      months.forEach((m,i) => {
        const o = document.createElement('option');
        o.value = i+1; o.textContent = m;
        if (i === new Date().getMonth()) o.selected = true;
        el.appendChild(o);
      });
    }
  });
  ['exp-anno'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.options.length) {
      for (let y = new Date().getFullYear(); y >= 2023; y--) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === new Date().getFullYear()) o.selected = true;
        el.appendChild(o);
      }
    }
  });
}

async function exportHRPDF() {
  const mese = parseInt(document.getElementById('exp-mese').value);
  const anno = parseInt(document.getElementById('exp-anno').value);
  const dipId = document.getElementById('exp-dipendente').value;
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const from = `${anno}-${String(mese).padStart(2,'0')}-01`;
  const lastDay = new Date(anno, mese, 0).getDate();
  const to = `${anno}-${String(mese).padStart(2,'0')}-${lastDay}`;

  const dipList = dipId ? dipendentiCache.filter(d => d.id === dipId) : dipendentiCache;
  if (!dipList.length) { showToast('Nessun dipendente', 'error'); return; }

  showToast('Generazione PDF...', '');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 16;

  for (let di = 0; di < dipList.length; di++) {
    const dip = dipList[di];
    if (di > 0) doc.addPage();
    let y = 0;

    // Header
    doc.setFillColor(10,15,30); doc.rect(0,0,W,38,'F');
    doc.setFillColor(37,99,235); doc.roundedRect(margin,10,16,16,2,2,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text('K', margin+8, 21, {align:'center'});
    doc.setFontSize(18); doc.text('KONTRO', margin+20, 21);
    doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.setTextColor(156,163,175);
    doc.text('Riepilogo per consulente paghe', W-margin, 21, {align:'right'});
    y = 46;

    // Titolo
    doc.setTextColor(10,15,30); doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(dip.nome + ' ' + dip.cognome, margin, y); y += 7;
    doc.setFontSize(10); doc.setTextColor(107,114,128); doc.setFont('helvetica','normal');
    doc.text((dip.ruolo||'—') + ' · ' + months[mese-1] + ' ' + anno, margin, y);
    doc.text(currentBusiness?.name || '', W-margin, y, {align:'right'}); y += 10;

    // Carica dati
    const [{ data: presenze }, { data: acconti }] = await Promise.all([
      db.from('presenze').select('*').eq('dipendente_id', dip.id).gte('data', from).lte('data', to).order('data'),
      db.from('acconti_stipendio').select('*').eq('dipendente_id', dip.id).gte('data', from).lte('data', to)
    ]);

    const assenze = (presenze||[]).filter(p => p.tipo === 'assenza');
    const ferie = (presenze||[]).filter(p => p.tipo === 'ferie');
    const permessi = (presenze||[]).filter(p => p.tipo === 'permesso');
    const straordinari = (presenze||[]).filter(p => p.tipo === 'straordinario');
    const festivi = (presenze||[]).filter(p => p.tipo === 'festivo');
    const straOre = [...straordinari, ...festivi].reduce((s,p) => s + Number(p.ore||0), 0);

    // KPI box
    const kpiW = (W - margin*2 - 12) / 4;
    const kpis = [
      { label:'Assenze', val: assenze.length + ' gg', color:[239,68,68] },
      { label:'Ferie godute', val: ferie.length + ' gg', color:[245,158,11] },
      { label:'Permessi', val: permessi.length + ' gg', color:[139,92,246] },
      { label:'Straordinari', val: straOre + 'h', color:[37,99,235] }
    ];
    kpis.forEach((k,i) => {
      const x = margin + i*(kpiW+4);
      doc.setFillColor(248,250,252); doc.roundedRect(x,y,kpiW,16,2,2,'F');
      doc.setDrawColor(...k.color); doc.setLineWidth(0.8); doc.roundedRect(x,y,kpiW,16,2,2,'S');
      doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(107,114,128);
      doc.text(k.label.toUpperCase(), x+4, y+5.5);
      doc.setFontSize(12); doc.setTextColor(...k.color);
      doc.text(k.val, x+4, y+13);
    });
    y += 22;

    // Dettaglio assenze/straordinari
    if (presenze?.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,15,30);
      doc.text('Dettaglio presenze da segnalare', margin, y); y += 6;
      doc.setFillColor(10,15,30); doc.rect(margin,y,W-margin*2,7,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text('DATA', margin+2, y+5); doc.text('TIPO', margin+30, y+5);
      doc.text('ORE', margin+80, y+5); doc.text('MOTIVAZIONE', margin+100, y+5);
      y += 9;
      presenze.forEach((p,i) => {
        if (y > 265) { doc.addPage(); y = 20; }
        if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(margin,y-3,W-margin*2,7,'F'); }
        const tipoLabel = {assenza:'Assenza',ferie:'Ferie',permesso:'Permesso',straordinario:'Straordinario',festivo:'Festivo lavorato'}[p.tipo]||p.tipo;
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(10,15,30);
        doc.text(formatDate(p.data), margin+2, y+2);
        doc.text(tipoLabel, margin+30, y+2);
        doc.text(p.ore ? p.ore+'h' : '—', margin+80, y+2);
        doc.text((p.motivazione||'—').substring(0,40), margin+100, y+2);
        y += 7;
      });
      y += 4;
    }

    // Acconti (escludi fuori busta)
    const accontiVisibili = (acconti||[]).filter(a => a.tipo !== 'fuori_busta');
    if (accontiVisibili.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,15,30);
      doc.text('Acconti da scalare dalla busta paga', margin, y); y += 6;
      doc.setFillColor(10,15,30); doc.rect(margin,y,W-margin*2,7,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text('DATA', margin+2, y+5); doc.text('TIPO', margin+30, y+5); doc.text('IMPORTO', W-margin-2, y+5, {align:'right'});
      y += 9;
      const tipoAccLabel = {contanti_cassa:'Contanti cassa',contanti_extra:'Contanti extra',bonifico:'Bonifico'};
      let totAcc = 0;
      accontiVisibili.forEach((a,i) => {
        if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(margin,y-3,W-margin*2,7,'F'); }
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(10,15,30);
        doc.text(formatDate(a.data), margin+2, y+2);
        doc.text(tipoAccLabel[a.tipo]||a.tipo, margin+30, y+2);
        doc.setTextColor(239,68,68); doc.setFont('helvetica','bold');
        doc.text(formatEur(a.importo), W-margin-2, y+2, {align:'right'});
        totAcc += Number(a.importo); y += 7;
      });
      y += 2;
      doc.setFillColor(10,15,30); doc.rect(margin,y,W-margin*2,8,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text('TOTALE ACCONTI DA SCALARE', margin+2, y+5.5);
      doc.setTextColor(248,113,113);
      doc.text(formatEur(totAcc), W-margin-2, y+5.5, {align:'right'});
    }

    // Footer
    doc.setFontSize(7); doc.setTextColor(156,163,175); doc.setFont('helvetica','normal');
    doc.text('KONTRO — Riepilogo generato il ' + new Date().toLocaleDateString('it-IT') + ' · Documento riservato', margin, 290);
  }

  const filename = 'KONTRO_HR_' + months[mese-1] + '_' + anno + '.pdf';
  doc.save(filename);
  showToast('PDF consulente scaricato ✓', 'success');
}

async function exportHRCSV() {
  const mese = parseInt(document.getElementById('exp-mese').value);
  const anno = parseInt(document.getElementById('exp-anno').value);
  const dipId = document.getElementById('exp-dipendente').value;
  const from = `${anno}-${String(mese).padStart(2,'0')}-01`;
  const lastDay = new Date(anno, mese, 0).getDate();
  const to = `${anno}-${String(mese).padStart(2,'0')}-${lastDay}`;

  const dipList = dipId ? dipendentiCache.filter(d => d.id === dipId) : dipendentiCache;
  const rows = [['Dipendente','Ruolo','Tipo','Data','Ore','Motivazione','Importo acconto','Tipo acconto']];

  for (const dip of dipList) {
    const [{ data: presenze }, { data: acconti }] = await Promise.all([
      db.from('presenze').select('*').eq('dipendente_id', dip.id).gte('data', from).lte('data', to).order('data'),
      db.from('acconti_stipendio').select('*').eq('dipendente_id', dip.id).gte('data', from).lte('data', to).neq('tipo', 'fuori_busta')
    ]);
    const nome = dip.nome + ' ' + dip.cognome;
    (presenze||[]).forEach(p => rows.push([nome, dip.ruolo||'', p.tipo, p.data, p.ore||'', p.motivazione||'', '', '']));
    (acconti||[]).forEach(a => rows.push([nome, dip.ruolo||'', 'acconto', a.data, '', a.note||'', a.importo, a.tipo]));
  }

  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `KONTRO_HR_${anno}_${String(mese).padStart(2,'0')}.csv`;
  a.click();
  showToast('CSV scaricato ✓', 'success');
}

// Popola select sede nel form dipendente
function populateSedeDipendente() {
  const sel = document.getElementById('nd-sede');
  if (!sel) return;
  sel.innerHTML = '<option value="">Sede principale</option>' +
    currentLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
}

// ============================================
// ORGANICO & TURNI
// ============================================
// ORGANICO & TURNI — Stile Excel (Planning settimanale)
// ============================================

async function initOrganico() {
  await loadDipendentiCache();
  buildOggiList();
  buildOrganicoBySede();
}

async function initTurni() {
  await loadDipendentiCache();
  const sel = document.getElementById('turni-sede-filter');
  if (sel) {
    sel.innerHTML = '<option value="">Tutte le sedi</option>' +
      currentLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  }
  const nav = document.getElementById('planning-data-nav');
  if (nav && !nav.value) nav.value = new Date().toISOString().split('T')[0];
  await loadPlanningSettimanale();
}

function getSettimanaKontro(dataRef) {
  const d = dataRef ? new Date(dataRef + 'T12:00:00') : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const lun = new Date(d); lun.setDate(diff);
  const giorni = [];
  for (let i = 0; i < 7; i++) { const g = new Date(lun); g.setDate(lun.getDate() + i); giorni.push(g.toISOString().split('T')[0]); }
  return giorni;
}

function navSettimana(dir) {
  const el = document.getElementById('planning-data-nav');
  const d = new Date((el.value || new Date().toISOString().split('T')[0]) + 'T12:00:00');
  d.setDate(d.getDate() + dir * 7);
  el.value = d.toISOString().split('T')[0];
  loadPlanningSettimanale();
}

function navSettimanaOggi() {
  document.getElementById('planning-data-nav').value = new Date().toISOString().split('T')[0];
  loadPlanningSettimanale();
}

function dipBadgeHTML(dip, size) {
  if (!dip) return '';
  const fs = size === 'sm' ? '10px' : '11px';
  const pad = size === 'sm' ? '3px 7px' : '4px 9px';
  const nome = dip.nome.split(' ')[0];
  return `<span style="background:${dip.colore||'#3b82f6'};color:white;border-radius:5px;padding:${pad};font-size:${fs};font-weight:700;display:inline-block;white-space:nowrap;cursor:pointer">${nome}</span>`;
}

async function loadPlanningSettimanale() {
  const el = document.getElementById('turni-grid'); if (!el) return;
  const dataNav = document.getElementById('planning-data-nav')?.value || new Date().toISOString().split('T')[0];
  const sedeFilter = document.getElementById('turni-sede-filter')?.value || '';
  const giorni = getSettimanaKontro(dataNav);
  const giorniNomi = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
  const oggi = new Date().toISOString().split('T')[0];
  const fmt = d => `${new Date(d+'T12:00:00').getDate()}/${new Date(d+'T12:00:00').getMonth()+1}`;
  const anno = new Date(giorni[0]+'T12:00:00').getFullYear();

  // Carica turni dal DB (basati su data, non giorno_settimana)
  const { data: turni } = await db.from('turni_dipendenti')
    .select('*, dipendenti(id,nome,cognome,colore,location_id)')
    .eq('business_id', currentBusiness.id)
    .gte('data', giorni[0]).lte('data', giorni[6]);

  const tMap = {}, rMap = {};
  (turni||[]).forEach(t => {
    tMap[`${t.dipendente_id}_${t.data}_${t.location_id}_${t.turno}`] = t;
    if (t.turno === 'riposo') {
      rMap[`${t.dipendente_id}_${t.data}_${t.location_id}`] = t;
      rMap[`${t.dipendente_id}_${t.data}_any`] = t;
    }
  });

  // Sedi da mostrare
  const sedi = sedeFilter
    ? currentLocations.filter(l => l.id === sedeFilter)
    : currentLocations;

  if (!sedi.length) { el.innerHTML = '<div class="empty-state">Nessuna sede configurata</div>'; return; }

  function getLavoratori(locId, data, turno) {
    return dipendentiCache.filter(d => {
      if (d.location_id && d.location_id !== locId) return false;
      if (rMap[`${d.id}_${data}_any`]) return false;
      return tMap[`${d.id}_${data}_${locId}_${turno}`];
    });
  }
  function getRiposi(locId, data) {
    return dipendentiCache.filter(d =>
      (!d.location_id || d.location_id === locId) && rMap[`${d.id}_${data}_${locId}`]
    );
  }

  // Calcola max lavoratori per sede
  const maxPerSede = {};
  sedi.forEach(loc => {
    let m = 2;
    giorni.forEach(g => {
      ['mattina','pomeriggio'].forEach(t => {
        m = Math.max(m, getLavoratori(loc.id, g, t).length + 1);
      });
    });
    maxPerSede[loc.id] = Math.min(m, 4);
  });

  // Colori sedi (cicla su palette)
  const sedePalette = [
    { hdr:'#7C3AED', sub:'#8B5CF6', rip:'#DDD6FE', ripTxt:'#5B21B6', ser:'#EDE9FE', ripBg:'#FAF5FF' },
    { hdr:'#059669', sub:'#10B981', rip:'#A7F3D0', ripTxt:'#065F46', ser:'#D1FAE5', ripBg:'#ECFDF5' },
    { hdr:'#1D4ED8', sub:'#3B82F6', rip:'#BFDBFE', ripTxt:'#1E40AF', ser:'#DBEAFE', ripBg:'#EFF6FF' },
    { hdr:'#B45309', sub:'#D97706', rip:'#FDE68A', ripTxt:'#92400E', ser:'#FEF3C7', ripBg:'#FFFBEB' }
  ];

  let html = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table style="border-collapse:collapse;font-size:12px;min-width:600px;width:100%">
      <thead>
        <tr>
          <th colspan="2" style="background:white;border:none"></th>`;

  sedi.forEach((loc, si) => {
    const pal = sedePalette[si % sedePalette.length];
    const cols = maxPerSede[loc.id];
    html += `<th colspan="${cols}" style="background:${pal.hdr};color:white;padding:7px 10px;text-align:center;font-size:11px;letter-spacing:.06em;text-transform:uppercase">📍 ${loc.name}</th>
             <th style="background:${pal.rip};color:${pal.ripTxt};padding:7px 6px;font-size:10px;text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Riposi</th>`;
  });

  html += `</tr><tr>
    <th style="padding:5px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748B;text-align:center;background:#EEF2FF">GIORNO</th>
    <th style="padding:5px 4px;font-size:9px;font-weight:700;text-transform:uppercase;color:#64748B;text-align:center;background:#EEF2FF">T.</th>`;

  sedi.forEach((loc, si) => {
    const pal = sedePalette[si % sedePalette.length];
    const cols = maxPerSede[loc.id];
    for (let c = 0; c < cols; c++) {
      html += `<th style="padding:5px 6px;font-size:9px;font-weight:700;color:white;text-align:center;background:${pal.sub};text-transform:uppercase;letter-spacing:.04em">IN SERVIZIO</th>`;
    }
    html += `<th style="padding:5px 4px;font-size:9px;font-weight:700;text-transform:uppercase;color:${pal.ripTxt};text-align:center;background:${pal.rip}">😴 RIPOSI</th>`;
  });

  html += `</tr></thead><tbody>`;

  giorni.forEach((g, gi) => {
    const isOggi = g === oggi;
    const rowBg = isOggi ? '#EFF6FF' : (gi % 2 === 0 ? 'white' : '#F8FAFC');

    ['mattina','pomeriggio'].forEach((turno, ti) => {
      const turnoLabel = turno === 'mattina' ? 'MAT' : 'POM';
      html += `<tr style="background:${rowBg}">`;

      if (ti === 0) {
        html += `<td rowspan="2" style="padding:8px 10px;border-left:${isOggi?'3px solid #2563EB':'1px solid #E2EAF8'};border-bottom:2px solid #E2EAF8;font-weight:700;color:${isOggi?'#2563EB':'#0F1E3C'};font-size:12px;white-space:nowrap;vertical-align:middle;min-width:80px">
          ${giorniNomi[gi]}<br><span style="font-size:16px;font-weight:800">${fmt(g)}</span>
        </td>`;
      }

      html += `<td style="padding:5px 8px;border-left:1px solid #E2EAF8;border-bottom:1px solid #F1F5F9;font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;min-width:45px;text-align:center">${turnoLabel}</td>`;

      sedi.forEach((loc, si) => {
        const pal = sedePalette[si % sedePalette.length];
        const cols = maxPerSede[loc.id];
        const lavoratori = getLavoratori(loc.id, g, turno);
        const riposi = getRiposi(loc.id, g);

        for (let c = 0; c < cols; c++) {
          const dip = lavoratori[c];
          html += `<td style="padding:4px 5px;border-left:1px solid ${pal.ser};border-bottom:1px solid #F1F5F9;text-align:center;min-width:70px">
            ${dip
              ? `<button onclick="rimuoviTurnoKontro('${dip.id}','${g}','${loc.id}','${turno}')" style="background:none;border:none;cursor:pointer;padding:0">${dipBadgeHTML(dip)}</button>`
              : `<button onclick="aggiungiTurnoKontro('${g}','${loc.id}','${turno}')" style="background:none;border:1px dashed ${pal.rip};color:${pal.sub};border-radius:5px;padding:4px 10px;cursor:pointer;font-size:13px;width:100%">+</button>`
            }
          </td>`;
        }

        if (ti === 0) {
          html += `<td rowspan="2" style="padding:5px 6px;border-left:2px solid ${pal.rip};border-bottom:2px solid #E2EAF8;text-align:center;background:${pal.ripBg};vertical-align:middle;min-width:80px">
            ${riposi.map(d => `<button onclick="rimuoviRiposoKontro('${d.id}','${g}','${loc.id}')" style="background:none;border:none;cursor:pointer;display:block;margin:2px auto">${dipBadgeHTML(d,'sm')}</button>`).join('')}
            <button onclick="aggiungiRiposoKontro('${g}','${loc.id}')" style="background:none;border:1px dashed ${pal.rip};color:${pal.sub};border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;margin-top:2px">+R</button>
          </td>`;
        }
      });

      html += `</tr>`;
    });

    html += `<tr><td colspan="${2 + sedi.reduce((s,l) => s + maxPerSede[l.id] + 1, 0)}" style="padding:0;height:3px;background:#E2EAF8"></td></tr>`;
  });

  html += `</tbody></table></div>
    <div style="margin-top:10px;font-size:11px;color:#64748B">
      Clicca <b>+</b> per aggiungere un turno · <b>+R</b> per aggiungere riposo · clicca su un nome per rimuoverlo
    </div>`;

  el.innerHTML = html;
}

// ── AZIONI PLANNING ───────────────────────────────────────────────────────────
async function aggiungiTurnoKontro(data, locId, turno) {
  const dipSede = dipendentiCache.filter(d => !d.location_id || d.location_id === locId);
  if (!dipSede.length) { showToast('Nessun dipendente per questa sede', 'error'); return; }

  const { data: existing } = await db.from('turni_dipendenti')
    .select('dipendente_id').eq('data', data).eq('location_id', locId).eq('turno', turno);
  const assegnatiIds = (existing||[]).map(t => t.dipendente_id);
  const disponibili = dipSede.filter(d => !assegnatiIds.includes(d.id) && !assegnatiIds.includes(d.id));

  // Escludi chi è in riposo quel giorno
  const { data: riposi } = await db.from('turni_dipendenti')
    .select('dipendente_id').eq('data', data).eq('turno', 'riposo');
  const inRiposo = (riposi||[]).map(t => t.dipendente_id);
  const final = disponibili.filter(d => !inRiposo.includes(d.id));

  if (!final.length) { showToast('Tutti i dipendenti sono già assegnati o in riposo', ''); return; }

  const lista = final.map((d,i) => `${i+1} = ${d.nome} ${d.cognome}`).join('\n');
  const scelta = prompt(`Chi aggiungere al turno ${turno === 'mattina' ? 'mattina' : 'pomeriggio'}?\n\n${lista}`, '1');
  if (!scelta) return;
  const idx = parseInt(scelta.trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= final.length) return;
  const dip = final[idx];

  await db.from('turni_dipendenti').insert({
    business_id: currentBusiness.id,
    dipendente_id: dip.id,
    location_id: locId,
    data, turno,
    giorno_settimana: new Date(data + 'T12:00:00').getDay()
  });
  loadPlanningSettimanale();
}

async function rimuoviTurnoKontro(dipId, data, locId, turno) {
  await db.from('turni_dipendenti').delete()
    .eq('dipendente_id', dipId).eq('data', data).eq('location_id', locId).eq('turno', turno);
  loadPlanningSettimanale();
}

async function aggiungiRiposoKontro(data, locId) {
  const dipSede = dipendentiCache.filter(d => !d.location_id || d.location_id === locId);
  const { data: existing } = await db.from('turni_dipendenti')
    .select('dipendente_id').eq('data', data).eq('turno', 'riposo');
  const giàInRiposo = (existing||[]).map(t => t.dipendente_id);
  const disponibili = dipSede.filter(d => !giàInRiposo.includes(d.id));
  if (!disponibili.length) { showToast('Nessun dipendente disponibile', ''); return; }

  const lista = disponibili.map((d,i) => `${i+1} = ${d.nome} ${d.cognome}`).join('\n');
  const scelta = prompt(`Chi è in riposo?\n\n${lista}`, '1');
  if (!scelta) return;
  const idx = parseInt(scelta.trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= disponibili.length) return;
  const dip = disponibili[idx];

  await db.from('turni_dipendenti').insert({
    business_id: currentBusiness.id,
    dipendente_id: dip.id,
    location_id: locId,
    data, turno: 'riposo',
    giorno_settimana: new Date(data + 'T12:00:00').getDay()
  });
  loadPlanningSettimanale();
}

async function rimuoviRiposoKontro(dipId, data, locId) {
  await db.from('turni_dipendenti').delete()
    .eq('dipendente_id', dipId).eq('data', data).eq('location_id', locId).eq('turno', 'riposo');
  loadPlanningSettimanale();
}

// ── EXPORT PDF PLANNING ───────────────────────────────────────────────────────
async function exportTurniPDF() {
  const dataNav = document.getElementById('planning-data-nav')?.value || new Date().toISOString().split('T')[0];
  const giorni = getSettimanaKontro(dataNav);
  const giorniNomi = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
  const fmt = d => `${new Date(d+'T12:00:00').getDate()}/${new Date(d+'T12:00:00').getMonth()+1}`;
  const anno = new Date(giorni[0]+'T12:00:00').getFullYear();

  const { data: turni } = await db.from('turni_dipendenti')
    .select('*, dipendenti(id,nome,cognome,colore,location_id)')
    .eq('business_id', currentBusiness.id)
    .gte('data', giorni[0]).lte('data', giorni[6]);

  const tMap = {}, rMap = {};
  (turni||[]).forEach(t => {
    tMap[`${t.dipendente_id}_${t.data}_${t.location_id}_${t.turno}`] = t;
    if (t.turno === 'riposo') {
      rMap[`${t.dipendente_id}_${t.data}_${t.location_id}`] = t;
      rMap[`${t.dipendente_id}_${t.data}_any`] = t;
    }
  });

  const sedi = currentLocations;
  const getLav = (locId, data, turno) => dipendentiCache.filter(d =>
    (!d.location_id || d.location_id === locId) && !rMap[`${d.id}_${data}_any`] && tMap[`${d.id}_${data}_${locId}_${turno}`]
  );
  const getRip = (locId, data) => dipendentiCache.filter(d =>
    (!d.location_id || d.location_id === locId) && rMap[`${d.id}_${data}_${locId}`]
  );

  const sedePalette = [
    { hdr:'#7C3AED', rip:'#DDD6FE', ripTxt:'#5B21B6', ripBg:'#FAF5FF' },
    { hdr:'#059669', rip:'#A7F3D0', ripTxt:'#065F46', ripBg:'#ECFDF5' },
    { hdr:'#1D4ED8', rip:'#BFDBFE', ripTxt:'#1E40AF', ripBg:'#EFF6FF' },
    { hdr:'#B45309', rip:'#FDE68A', ripTxt:'#92400E', ripBg:'#FFFBEB' }
  ];

  const bpdf = dip => dip
    ? `<span style="background:${dip.colore||'#3b82f6'};color:#fff;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700;display:inline-block;margin:1px;white-space:nowrap">${dip.nome.split(' ')[0]}</span>`
    : '';

  let thSedi = '', rows = '';

  thSedi = sedi.map((loc, si) => {
    const pal = sedePalette[si % sedePalette.length];
    return `<th class="th-bar" style="background:${pal.hdr}">📍 ${loc.name}</th>
            <th class="th-rbar" style="background:${pal.rip};color:${pal.ripTxt};width:65px">😴 Riposi</th>`;
  }).join('');

  giorni.forEach((g, gi) => {
    const bg = gi % 2 === 0 ? '#fff' : '#F7F9FF';
    ['mattina','pomeriggio'].forEach((t, ti) => {
      rows += `<tr style="background:${bg}">`;
      if (ti === 0) rows += `<td rowspan="2" class="cg">${giorniNomi[gi]}<br><b>${fmt(g)}</b></td>`;
      rows += `<td class="ct">${t==='mattina'?'MAT':'POM'}</td>`;
      sedi.forEach((loc, si) => {
        const pal = sedePalette[si % sedePalette.length];
        const lb = getLav(loc.id, g, t);
        const rb = getRip(loc.id, g);
        rows += `<td class="cn" style="border-left:2px solid ${pal.rip}">${lb.map(bpdf).join('')}&nbsp;</td>`;
        if (ti === 0) rows += `<td rowspan="2" class="cr" style="background:${pal.ripBg};border-left:2px solid ${pal.rip}">${rb.map(bpdf).join('<br>')}&nbsp;</td>`;
      });
      rows += `</tr>`;
    });
  });

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<title>Planning ${currentBusiness?.name} — ${fmt(giorni[0])}–${fmt(giorni[6])}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{padding:8px 10px}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;border-bottom:2px solid #0F1E3C;margin-bottom:6px}
.logo{font-size:13px;font-weight:800}.logo b{color:#2563EB}
.sett{font-size:10px;color:#4A6490}
table{width:100%;border-collapse:collapse;table-layout:fixed}
.th-bar{color:white;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:5px 4px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.th-rbar{font-size:8px;font-weight:700;text-align:center;padding:5px 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.th-empty{background:#E2EAF8;color:#475569;font-size:8px;font-weight:700;text-transform:uppercase;padding:5px 4px;text-align:center}
.cg{padding:4px 5px;font-weight:800;font-size:9px;color:#0F1E3C;vertical-align:middle;border-bottom:2px solid #E2EAF8;border-left:2px solid #E2EAF8;width:55px}
.ct{padding:2px 3px;font-size:7px;color:#94A3B8;font-weight:700;text-transform:uppercase;text-align:center;vertical-align:middle;border-left:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9;width:25px}
.cn{padding:3px 4px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
.cr{padding:4px 3px;text-align:center;vertical-align:middle;border-bottom:2px solid #E2EAF8;width:65px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ftr{margin-top:5px;font-size:7px;color:#94A3B8;text-align:right}
.no-print{padding:8px 12px;background:#EEF2FF;display:flex;gap:8px;align-items:center}
.btn-print{background:#2563EB;color:white;border:none;border-radius:6px;padding:7px 16px;font-size:12px;cursor:pointer}
.btn-close{background:#E2EAF8;color:#0F1E3C;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer}
.hint{font-size:11px;color:#4A6490}
@page{size:A4 landscape;margin:0}
@media print{.no-print{display:none!important}html,body{width:297mm;height:210mm;overflow:hidden}.page{padding:5mm 6mm;height:210mm;display:flex;flex-direction:column}table{flex:1}}
</style></head><body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨️ Stampa / Salva PDF</button>
  <button class="btn-close" onclick="window.close()">✕</button>
  <span class="hint">Seleziona <b>Salva come PDF</b> · layout <b>Orizzontale</b> · margini <b>Nessuno</b></span>
</div>
<div class="page">
  <div class="hdr">
    <div class="logo">KONTRO — <b>${currentBusiness?.name}</b> · Planning Staff</div>
    <div class="sett">Settimana ${fmt(giorni[0])} — ${fmt(giorni[6])} ${anno}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="th-empty" style="width:55px">Giorno</th>
        <th class="th-empty" style="width:25px">T.</th>
        ${thSedi}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="ftr">KONTRO — www.kontro.cloud · ${new Date().toLocaleDateString('it-IT')}</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planning_${giorni[0]}.html`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showToast('File scaricato — aprilo, si avvia la stampa automaticamente ✓', 'success');
}

// ── EXPORT PNG WHATSAPP ───────────────────────────────────────────────────────
async function condividiPlanningWhatsApp() {
  const dataNav = document.getElementById('planning-data-nav')?.value || new Date().toISOString().split('T')[0];
  const giorni = getSettimanaKontro(dataNav);
  const giorniNomi = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
  const fmt = d => `${new Date(d+'T12:00:00').getDate()}/${new Date(d+'T12:00:00').getMonth()+1}`;
  const oggi = new Date().toISOString().split('T')[0];
  const anno = new Date(giorni[0]+'T12:00:00').getFullYear();

  const { data: turni } = await db.from('turni_dipendenti')
    .select('*, dipendenti(id,nome,cognome,colore,location_id)')
    .eq('business_id', currentBusiness.id)
    .gte('data', giorni[0]).lte('data', giorni[6]);

  const tMap = {}, rMap = {};
  (turni||[]).forEach(t => {
    tMap[`${t.dipendente_id}_${t.data}_${t.location_id}_${t.turno}`] = t;
    if (t.turno === 'riposo') {
      rMap[`${t.dipendente_id}_${t.data}_${t.location_id}`] = t;
      rMap[`${t.dipendente_id}_${t.data}_any`] = t;
    }
  });

  const sedi = currentLocations.slice(0, 2); // max 2 sedi per leggibilità
  const getLav = (locId, data, turno) => dipendentiCache.filter(d =>
    (!d.location_id || d.location_id === locId) && !rMap[`${d.id}_${data}_any`] && tMap[`${d.id}_${data}_${locId}_${turno}`]
  );
  const getRip = (locId, data) => dipendentiCache.filter(d =>
    (!d.location_id || d.location_id === locId) && rMap[`${d.id}_${data}_${locId}`]
  );

  const sedePalette = [
    { hdr:'#7C3AED', sub:'#8B5CF6', rip:'#DDD6FE', ripTxt:'#5B21B6', ripBg:'#FAF5FF' },
    { hdr:'#059669', sub:'#10B981', rip:'#A7F3D0', ripTxt:'#065F46', ripBg:'#ECFDF5' }
  ];

  const S = 2, W = 900;
  const nSedi = sedi.length;
  const xG = 0, wG = 80, xT = 80, wT = 48;
  const areaW = W - wG - wT;
  const sedeW = Math.floor(areaW / nSedi);
  const isW = Math.floor(sedeW * 0.72);
  const ripW = sedeW - isW;

  const ROW = 32, SEP = 4, hHDR = 46, hTH1 = 26, hTH2 = 22;
  const TOTAL = hHDR + hTH1 + hTH2 + 7 * (ROW * 2 + SEP) + 16;

  const canvas = document.createElement('canvas');
  canvas.width = W * S; canvas.height = TOTAL * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);

  const fill = (x,y,w,h,c) => { ctx.fillStyle=c; ctx.fillRect(x,y,w,h); };
  const line = (x,y1,y2,c='#E2EAF8') => {
    ctx.strokeStyle=c; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,y1); ctx.lineTo(x,y2); ctx.stroke();
  };
  const txt = (t,x,y,font,color,align='left',base='middle') => {
    ctx.font=font; ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline=base; ctx.fillText(t,x,y);
  };
  const badge = (x,y,w,h,r,bg,label,fs) => {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
    ctx.fillStyle=bg; ctx.fill();
    txt(label, x+w/2, y+h/2, `700 ${fs}px 'Helvetica Neue',Arial,sans-serif`, 'white', 'center');
  };

  fill(0, 0, W, TOTAL, '#F1F5F9');
  fill(0, 0, W, hHDR, '#0F1E3C');
  txt('KONTRO — Planning Staff', 16, hHDR/2, "800 14px 'Helvetica Neue',Arial,sans-serif", 'white');
  txt(`Sett. ${fmt(giorni[0])} – ${fmt(giorni[6])} ${anno}`, W-14, hHDR/2, "400 11px 'Helvetica Neue',Arial,sans-serif", 'rgba(255,255,255,.5)', 'right');

  let ty = hHDR;
  fill(0, ty, wG+wT, hTH1, '#E2EAF8');
  sedi.forEach((loc, si) => {
    const pal = sedePalette[si];
    const xBase = wG + wT + si * sedeW;
    fill(xBase, ty, isW + ripW, hTH1, pal.hdr);
    txt('📍 ' + loc.name, xBase + sedeW/2, ty+hTH1/2, "700 10px 'Helvetica Neue',Arial,sans-serif", 'white', 'center');
  });
  ty += hTH1;

  fill(xG, ty, wG, hTH2, '#EEF2FF');
  fill(xT, ty, wT, hTH2, '#EEF2FF');
  sedi.forEach((loc, si) => {
    const pal = sedePalette[si];
    const xBase = wG + wT + si * sedeW;
    fill(xBase, ty, isW, hTH2, pal.sub);
    fill(xBase+isW, ty, ripW, hTH2, pal.rip);
    txt('IN SERVIZIO', xBase+isW/2, ty+hTH2/2, "600 8px 'Helvetica Neue',Arial,sans-serif", 'white', 'center');
    txt('😴 RIPOSI', xBase+isW+ripW/2, ty+hTH2/2, "700 8px 'Helvetica Neue',Arial,sans-serif", pal.ripTxt, 'center');
  });
  txt('GIORNO', xG+wG/2, ty+hTH2/2, "600 8px 'Helvetica Neue',Arial,sans-serif", '#64748B', 'center');
  txt('T.', xT+wT/2, ty+hTH2/2, "600 8px 'Helvetica Neue',Arial,sans-serif", '#64748B', 'center');
  ty += hTH2;

  let y = ty;
  const fDip = "700 10px 'Helvetica Neue',Arial,sans-serif";
  const fDipS = "700 9px 'Helvetica Neue',Arial,sans-serif";
  const fTurno = "600 7px 'Helvetica Neue',Arial,sans-serif";

  giorni.forEach((g, gi) => {
    const isOggi = g === oggi;
    const bg = gi%2===0 ? '#FFFFFF' : '#F8FAFC';
    const dayH = ROW * 2;

    fill(0, y, W, dayH, bg);
    if (isOggi) { fill(0, y, W, dayH, 'rgba(37,99,235,.05)'); fill(0, y, 3, dayH, '#2563EB'); }

    sedi.forEach((loc, si) => {
      const pal = sedePalette[si];
      const xBase = wG + wT + si * sedeW;
      fill(xBase+isW, y, ripW, dayH, pal.ripBg + '88');
    });

    const gc = isOggi ? '#2563EB' : '#0F1E3C';
    txt(giorniNomi[gi], xG+6, y+7, "600 10px 'Helvetica Neue',Arial,sans-serif", gc, 'left', 'top');
    txt(fmt(g), xG+6, y+19, "800 14px 'Helvetica Neue',Arial,sans-serif", gc, 'left', 'top');

    ['mattina','pomeriggio'].forEach((turno, ti) => {
      const ry = y + ti * ROW;
      if (ti === 1) { ctx.strokeStyle='#EEEEEE'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(xT, ry); ctx.lineTo(W, ry); ctx.stroke(); }
      txt(turno==='mattina'?'MAT':'POM', xT+wT/2, ry+ROW/2, fTurno, '#94A3B8', 'center');

      sedi.forEach((loc, si) => {
        const xBase = wG + wT + si * sedeW;
        const lav = getLav(loc.id, g, turno);
        let bx = xBase + 5;
        lav.forEach(dip => {
          const nome = dip.nome.split(' ')[0];
          ctx.font = fDip;
          const tw = ctx.measureText(nome).width;
          const bw = tw + 12, bh = 19, by = ry + (ROW-bh)/2;
          if (bx + bw < xBase + isW - 4) { badge(bx, by, bw, bh, 4, dip.colore||'#3b82f6', nome, 10); bx += bw+4; }
        });
      });
    });

    sedi.forEach((loc, si) => {
      const pal = sedePalette[si];
      const xBase = wG + wT + si * sedeW;
      const rip = getRip(loc.id, g);
      let ry2 = y + 5;
      rip.forEach(dip => {
        const nome = dip.nome.split(' ')[0];
        ctx.font = fDipS;
        const tw = ctx.measureText(nome).width;
        const bw = Math.min(tw+10, ripW-10), bh = 17;
        const bx = xBase + isW + (ripW-bw)/2;
        badge(bx, ry2, bw, bh, 3, dip.colore||'#3b82f6', nome, 9);
        ry2 += bh+3;
      });
    });

    // linee verticali
    [xT].forEach(lx => line(lx, y, y+dayH));
    sedi.forEach((loc, si) => {
      const xBase = wG + wT + si * sedeW;
      line(xBase, y, y+dayH);
      line(xBase+isW, y, y+dayH, '#CBD5E1');
    });

    y += dayH;
    fill(0, y, W, SEP, '#CBD5E1');
    y += SEP;
  });

  txt(`KONTRO · www.kontro.cloud · ${new Date().toLocaleDateString('it-IT')}`, W-12, y+9, "400 8px 'Helvetica Neue',Arial,sans-serif", '#94A3B8', 'right');

  canvas.toBlob(async (blob) => {
    const fileName = `planning_${giorni[0]}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Planning ${fmt(giorni[0])}–${fmt(giorni[6])}`, text: '📋 Planning settimanale KONTRO' });
        showToast('Condiviso ✓', 'success'); return;
      } catch(e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      window.open('https://web.whatsapp.com/', '_blank');
      showToast('Immagine copiata! Incolla su WhatsApp Web con Ctrl+V / Cmd+V', 'success');
    } catch(e) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast('Immagine scaricata — condividila su WhatsApp', 'success');
    }
  }, 'image/png', 1.0);
}

// ── ORGANICO ─────────────────────────────────────────────────────────────────
async function buildOrganicoBySede() {
  const { data: dips } = await db.from('dipendenti')
    .select('*, locations(name)').eq('business_id', currentBusiness.id).eq('attivo', true);
  const el = document.getElementById('org-sedi-grid');
  if (!dips?.length) { el.innerHTML = '<div class="empty-state">Nessun dipendente</div>'; return; }

  const oggi = new Date().toISOString().split('T')[0];
  const todayDow = new Date().getDay();
  const { data: turni } = await db.from('turni_dipendenti')
    .select('dipendente_id,turno,ora_inizio,ora_fine').eq('business_id', currentBusiness.id).eq('data', oggi);

  const bySede = {};
  dips.forEach(d => {
    const k = d.locations?.name || 'Sede principale';
    if (!bySede[k]) bySede[k] = [];
    bySede[k].push(d);
  });

  el.innerHTML = Object.entries(bySede).map(([sede, dipList]) => `
    <div class="org-sede-card">
      <div class="org-sede-header">
        <span class="org-sede-nome">📍 ${sede}</span>
        <span class="org-sede-count">${dipList.length} dipendenti</span>
      </div>
      <div class="org-sede-body">
        ${dipList.map(d => {
          const turno = (turni||[]).find(t => t.dipendente_id === d.id && t.turno !== 'riposo');
          const riposo = (turni||[]).find(t => t.dipendente_id === d.id && t.turno === 'riposo');
          return `<div class="org-dip-row">
            <div class="org-dip-avatar" style="background:${d.colore||'#3b82f6'}22;color:${d.colore||'#3b82f6'}">${d.nome[0]}${d.cognome[0]}</div>
            <div style="flex:1">
              <div class="org-dip-nome">${d.nome} ${d.cognome}</div>
              <div class="org-dip-ruolo">${d.ruolo||'—'}${d.telefono ? ' · ' + d.telefono : ''}</div>
            </div>
            <span class="org-oggi-badge ${turno?'lavora':riposo?'riposo':''}">
              ${turno ? (turno.turno==='mattina'?'Mattina':'Pomeriggio') : riposo ? 'Riposo' : 'N/D'}
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

async function buildOggiList() {
  const oggi = new Date().toISOString().split('T')[0];
  const todayStr = new Date().toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'long' });
  const oggiEl = document.getElementById('org-oggi-data');
  if (oggiEl) oggiEl.textContent = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);

  const { data: turni } = await db.from('turni_dipendenti')
    .select('*, dipendenti(nome,cognome,ruolo,colore)')
    .eq('business_id', currentBusiness.id).eq('data', oggi)
    .neq('turno', 'riposo');

  const el = document.getElementById('org-oggi-list');
  if (!turni?.length) { el.innerHTML = '<div class="empty-state">Nessun turno configurato per oggi</div>'; return; }

  el.innerHTML = turni.map(t => `
    <div class="entry-item">
      <div class="entry-dot entrata" style="background:${t.dipendenti?.colore||'#3b82f6'}"></div>
      <div class="entry-info">
        <div class="entry-desc">${t.dipendenti?.nome} ${t.dipendenti?.cognome}</div>
        <div class="entry-meta">${t.dipendenti?.ruolo||'—'} · ${t.turno === 'mattina' ? 'Turno mattina' : 'Turno pomeriggio'}</div>
      </div>
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--green-400);font-weight:600;text-transform:uppercase">
        ${t.turno}
      </div>
    </div>`).join('');
}

// MOBILE MENU
// ============================================
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const btn = document.getElementById('hamburger-btn');
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeMobileMenu();
  } else {
    sidebar.classList.add('open');
    overlay.classList.remove('hidden');
    btn.classList.add('open');
  }
}

function closeMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const btn = document.getElementById('hamburger-btn');
  sidebar.classList.remove('open');
  overlay.classList.add('hidden');
  btn.classList.remove('open');
}

// Chiudi menu quando si clicca una voce
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMobileMenu();
    });
  });
});

// ============================================
// CAUSALI PRELIEVI
// ============================================
let causaliCache = [];

async function loadCausaliCache() {
  if (!currentBusiness) return;
  const { data } = await db.from('causali_prelievo').select('*')
    .eq('business_id', currentBusiness.id).eq('attivo', true).order('nome');
  causaliCache = data || [];
}

function buildPNPrelievoSelects() {
  const optsHtml = '<option value="">— Causale —</option>' +
    causaliCache.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
  for (let i = 0; i < 10; i++) {
    const el = document.getElementById('pdesc-' + i);
    if (!el) break;
    if (el.tagName === 'SELECT') {
      const val = el.value;
      el.innerHTML = optsHtml;
      if (val) el.value = val;
    } else if (el.tagName === 'INPUT') {
      const sel = document.createElement('select');
      sel.id = 'pdesc-' + i;
      sel.className = 'pn-desc-input';
      sel.innerHTML = optsHtml;
      if (el.value) sel.value = el.value;
      el.parentNode.replaceChild(sel, el);
    }
  }
}

async function loadCausaliLista() {
  if (!currentBusiness) return;
  await loadCausaliCache();
  const el = document.getElementById('causali-list');
  if (!causaliCache.length) {
    el.innerHTML = '<div class="empty-state">Nessuna causale configurata</div>';
    return;
  }
  el.innerHTML = causaliCache.map(c => `
    <div class="entry-item">
      <div class="entry-dot uscita"></div>
      <div class="entry-info">
        <div class="entry-desc">💸 ${c.nome}</div>
      </div>
      <button class="entry-del" onclick="deleteCausalePrelievo('${c.id}')">✕</button>
    </div>`).join('');
}

async function saveCausalePrelievo() {
  if (!currentBusiness) return;
  const nome = document.getElementById('nc-causale-nome').value.trim();
  const msgEl = document.getElementById('nc-causale-msg');
  if (!nome) { msgEl.textContent = 'Inserisci il nome'; msgEl.className = 'auth-message error'; return; }

  const { error } = await db.from('causali_prelievo').insert({
    business_id: currentBusiness.id, nome, attivo: true
  });
  if (error) { msgEl.textContent = 'Errore: ' + error.message; msgEl.className = 'auth-message error'; return; }

  msgEl.textContent = 'Causale aggiunta ✓';
  msgEl.className = 'auth-message success';
  document.getElementById('nc-causale-nome').value = '';
  setTimeout(() => msgEl.textContent = '', 3000);
  await loadCausaliLista();
  buildPNPrelievoSelects(); // aggiorna subito i select in prima nota
}

async function deleteCausalePrelievo(id) {
  await db.from('causali_prelievo').update({ attivo: false }).eq('id', id);
  showToast('Causale eliminata', 'success');
  await loadCausaliLista();
  buildPNPrelievoSelects();
}

// ============================================
// RESET DATI CONTABILI
// ============================================
function showResetModal() {
  if (currentRole !== 'owner') { showToast('Solo il proprietario può eseguire il reset', 'error'); return; }
  document.getElementById('reset-password').value = '';
  document.getElementById('reset-confirm-text').value = '';
  document.getElementById('reset-msg').textContent = '';
  document.getElementById('reset-msg').className = 'auth-message';
  document.getElementById('reset-modal').style.display = 'flex';
}

function hideResetModal() {
  document.getElementById('reset-modal').style.display = 'none';
}

async function eseguiReset() {
  const pwd = document.getElementById('reset-password').value;
  const confirmText = document.getElementById('reset-confirm-text').value.trim();
  const msgEl = document.getElementById('reset-msg');

  if (confirmText !== 'RESET') {
    msgEl.textContent = 'Scrivi esattamente RESET per confermare';
    msgEl.className = 'auth-message error';
    return;
  }
  if (!pwd) {
    msgEl.textContent = 'Inserisci la password';
    msgEl.className = 'auth-message error';
    return;
  }

  msgEl.textContent = 'Verifica password...';
  msgEl.className = 'auth-message';

  const { error: authError } = await db.auth.signInWithPassword({
    email: currentUser.email, password: pwd
  });
  if (authError) {
    msgEl.textContent = 'Password errata';
    msgEl.className = 'auth-message error';
    return;
  }

  msgEl.textContent = 'Reset in corso...';
  const bid = currentBusiness.id;

  // Cancella prima le tabelle figlie (FK), poi le madri
  const steps = [
    // Figlie
    () => db.from('daily_note_rows').delete().eq('business_id', bid),
    () => db.from('acconti_stipendio').delete().eq('business_id', bid),
    () => db.from('presenze').delete().eq('business_id', bid),
    () => db.from('turni_dipendenti').delete().eq('business_id', bid),
    // Madri
    () => db.from('daily_notes').delete().eq('business_id', bid),
    () => db.from('fatture_fornitori').delete().eq('business_id', bid),
    () => db.from('assegni').delete().eq('business_id', bid),
    () => db.from('versamenti').delete().eq('business_id', bid),
    () => db.from('movimenti_banca').delete().eq('business_id', bid),
    () => db.from('rid_bancari').delete().eq('business_id', bid),
    () => db.from('cash_entries').delete().eq('business_id', bid),
  ];

  for (const step of steps) {
    const { error } = await step();
    if (error) console.warn('Reset errore:', error.message);
  }

  hideResetModal();
  showToast('✅ Reset completato — dati contabili eliminati', 'success');
  // Ricarica tutto
  await loadDashboard();
  showView('dashboard');
}
