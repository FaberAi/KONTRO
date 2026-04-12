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

function showView(name) {
  // Controllo accessi
  const ownerOnly = ['impostazioni', 'team'];
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
  if (name === 'primanota') initPrimaNota();
  if (name === 'storico') initStorico();
  if (name === 'banca') initBanca();
  if (name === 'fornitori') initFornitori();
  if (name === 'impostazioni') initImpostazioni();
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
    doc.text('KONTRO — Prima nota digitale · kontro.vercel.app', margin, 290);
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
function calcPN() {
  const fc = getPN('pn-fc');
  const voci = ['incasso','money','sisal','fatture','giornali'];
  const uscVoci = ['pos','carte','bonifici'];

  // Totali per voce
  voci.forEach(k => {
    const tot = sumTurni(k);
    setPN('tot-'+k, tot);
  });
  uscVoci.forEach(k => {
    const tot = sumTurni(k);
    setPN('tot-'+k, tot);
  });

  // Totali fornitori per turno
  let fM=0, fP=0, fS=0;
  pnFornitoriRows.forEach(r => {
    fM += parseFloat(r.im.value)||0;
    fP += parseFloat(r.ip.value)||0;
    fS += parseFloat(r.is.value)||0;
  });

  // Totali prelievi per turno
  let pM=0, pP=0, pS=0;
  pnPrelieviRows.forEach(r => {
    pM += parseFloat(r.im.value)||0;
    pP += parseFloat(r.ip.value)||0;
    pS += parseFloat(r.is.value)||0;
  });

  // Fondo chiusura
  const fcUscM = getPN('fc-usc-m'), fcUscP = getPN('fc-usc-p'), fcUscS = getPN('fc-usc-s');
  setPN('tot-fc-usc', fcUscM + fcUscP + fcUscS);

  // Totali entrate per turno (fc solo in totale, non per turno)
  const entM = voci.reduce((s,k) => s + getPN(k+'-m'), 0);
  const entP = voci.reduce((s,k) => s + getPN(k+'-p'), 0);
  const entS = voci.reduce((s,k) => s + getPN(k+'-s'), 0);
  const entTot = fc + entM + entP + entS;

  setPN('tot-ent-m', entM); setPN('tot-ent-p', entP);
  setPN('tot-ent-s', entS); setPN('tot-ent', entTot);

  // Totali uscite per turno
  const uscM = uscVoci.reduce((s,k) => s + getPN(k+'-m'), 0) + fM + pM + fcUscM;
  const uscP = uscVoci.reduce((s,k) => s + getPN(k+'-p'), 0) + fP + pP + fcUscP;
  const uscS = uscVoci.reduce((s,k) => s + getPN(k+'-s'), 0) + fS + pS + fcUscS;
  const uscTot = uscM + uscP + uscS;

  setPN('tot-usc-m', uscM); setPN('tot-usc-p', uscP);
  setPN('tot-usc-s', uscS); setPN('tot-usc', uscTot);

  // Differenze per turno
  const diffM = entM - uscM;
  const diffP = entP - uscP;
  const diffS = entS - uscS;
  const diffTot = entTot - uscTot;

  ['m','p','s'].forEach((t, i) => {
    const d = [diffM, diffP, diffS][i];
    const el = document.getElementById('diff-'+t);
    if (el) {
      el.textContent = (d >= 0 ? '+ ' : '- ') + fmtPN(d);
      el.className = 'td-tot' + (d > 0 ? ' alarm' : '');
    }
  });
  const dtEl = document.getElementById('diff-tot');
  if (dtEl) {
    dtEl.textContent = (diffTot >= 0 ? '+ ' : '- ') + fmtPN(diffTot);
    dtEl.className = 'td-tot' + (diffTot > 0 ? ' alarm' : '');
  }

  // Incasso per turno = incasso dichiarato + |differenza turno|
  const incM = getPN('incasso-m') + Math.abs(diffM);
  const incP = getPN('incasso-p') + Math.abs(diffP);
  const incS = getPN('incasso-s') + Math.abs(diffS);
  const incTot = incM + incP + incS;

  setPN('r-inc-m', incM);
  setPN('r-inc-p', incP);
  setPN('r-inc-s', incS);
  setPN('r-inc-tot', incTot);

  // Allarme
  const allarme = document.getElementById('pn-allarme');
  if (allarme) allarme.classList.toggle('hidden', diffTot <= 0);
}

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
    'sisal-m','sisal-p','sisal-s','fatture-m','fatture-p','fatture-s','giornali-m','giornali-p','giornali-s',
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
  // Popola i select fornitori nelle righe statiche
  _buildPNFornitoriSelects();
  calcPN2();
  loadNotaGiorno2();
}

function _buildPNFornitoriSelects() {
  if (!fornitoriCache || fornitoriCache.length === 0) return;
  const optsHtml = '<option value="">— Fornitore —</option>' +
    fornitoriCache.map(f => `<option value="${f.id}">${f.ragione_sociale}</option>`).join('');
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
  const voci = ['incasso','money','sisal','fatture','giornali'];
  const uscVoci = ['pos','carte','bonifici'];

  // Totali voci entrata
  voci.forEach(k => {
    const tot = getV(k+'-m') + getV(k+'-p') + getV(k+'-s');
    const el = document.getElementById('tot-'+k);
    if (el) el.textContent = fmtPN(tot);
  });

  // Totali voci uscita fisse
  uscVoci.forEach(k => {
    const tot = getV(k+'-m') + getV(k+'-p') + getV(k+'-s');
    const el = document.getElementById('tot-'+k);
    if (el) el.textContent = fmtPN(tot);
  });

  // Totali fornitori per turno + aggiorna tot per riga
  let fM=0, fP=0, fS=0;
  for (let i = 0; i < pnFornitoriCount; i++) {
    const m = getV('fm-'+i), p = getV('fp-'+i), s = getV('fs-'+i);
    fM += m; fP += p; fS += s;
    const totEl = document.getElementById('ftot-'+i);
    if (totEl) totEl.textContent = fmtPN(m+p+s);
  }

  // Totali prelievi per turno + aggiorna tot per riga
  let pM=0, pP=0, pS=0;
  for (let i = 0; i < pnPrelieviCount; i++) {
    const m = getV('pm-'+i), p = getV('pp-'+i), s = getV('ps-'+i);
    pM += m; pP += p; pS += s;
    const totEl = document.getElementById('ptot-'+i);
    if (totEl) totEl.textContent = fmtPN(m+p+s);
  }

  // Fondo chiusura
  const fcUscM = getV('fc-usc-m'), fcUscP = getV('fc-usc-p'), fcUscS = getV('fc-usc-s');
  const fcUscEl = document.getElementById('tot-fc-usc');
  if (fcUscEl) fcUscEl.textContent = fmtPN(fcUscM+fcUscP+fcUscS);

  // Totali entrate per turno
  const entM = voci.reduce((s,k) => s + getV(k+'-m'), 0);
  const entP = voci.reduce((s,k) => s + getV(k+'-p'), 0);
  const entS = voci.reduce((s,k) => s + getV(k+'-s'), 0);
  const entTot = fc + entM + entP + entS;

  const setT = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = fmtPN(v); };
  setT('tot-ent-m', entM); setT('tot-ent-p', entP);
  setT('tot-ent-s', entS); setT('tot-ent', entTot);

  // Totali uscite per turno
  const uscM = uscVoci.reduce((s,k)=>s+getV(k+'-m'),0) + fM + pM + fcUscM;
  const uscP = uscVoci.reduce((s,k)=>s+getV(k+'-p'),0) + fP + pP + fcUscP;
  const uscS = uscVoci.reduce((s,k)=>s+getV(k+'-s'),0) + fS + pS + fcUscS;
  const uscTot = uscM + uscP + uscS;

  setT('tot-usc-m', uscM); setT('tot-usc-p', uscP);
  setT('tot-usc-s', uscS); setT('tot-usc', uscTot);

  // Differenze
  const dM = entM-uscM, dP = entP-uscP, dS = entS-uscS, dTot = entTot-uscTot;
  [['diff-m',dM],['diff-p',dP],['diff-s',dS],['diff-tot',dTot]].forEach(([id,d]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = (d>=0?'+ ':'- ') + fmtPN(d);
      el.className = 'td-tot' + (d>0?' alarm':'');
    }
  });

  // Incasso per turno
  const incM = getV('incasso-m') + Math.abs(dM);
  const incP = getV('incasso-p') + Math.abs(dP);
  const incS = getV('incasso-s') + Math.abs(dS);
  setT('r-inc-m', incM); setT('r-inc-p', incP);
  setT('r-inc-s', incS); setT('r-inc-tot', incM+incP+incS);

  const allarme = document.getElementById('pn-allarme');
  if (allarme) allarme.classList.toggle('hidden', dTot <= 0);
}

// Override calcPN con la v2
function calcPN() { calcPN2(); }

function addFornitoreRow() {
  const idx = pnFornitoriCount;
  const tbody = document.getElementById('pn-tbody');
  const chiusura = document.querySelector('.pn-section-row.chiusura');
  const tr = document.createElement('tr');
  tr.className = 'pn-dyn-row' + (idx%2===0?' pn-row-even':'');
  tr.id = 'fornitori-r'+idx;
  tr.innerHTML = `
    <td class="td-desc" style="display:flex;align-items:center;gap:4px">
      <input type="text" placeholder="Fornitore..." class="pn-desc-input" id="fdesc-${idx}"/>
      <button class="pn-remove-btn" onclick="removeRow(this,'f',${idx})">×</button>
    </td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fm-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fp-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="fs-${idx}" oninput="calcPN()"/></td>
    <td class="td-tot" id="ftot-${idx}">€ 0,00</td>`;
  tbody.insertBefore(tr, chiusura);
  pnFornitoriCount++;
}

function addPrelievRow() {
  const idx = pnPrelieviCount;
  const tbody = document.getElementById('pn-tbody');
  const chiusura = document.querySelector('.pn-section-row.chiusura');
  const tr = document.createElement('tr');
  tr.className = 'pn-dyn-row' + (idx%2===0?' pn-row-even':'');
  tr.id = 'prelievi-r'+idx;
  tr.innerHTML = `
    <td class="td-desc" style="display:flex;align-items:center;gap:4px">
      <input type="text" placeholder="Causale..." class="pn-desc-input" id="pdesc-${idx}"/>
      <button class="pn-remove-btn" onclick="removeRow(this,'p',${idx})">×</button>
    </td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="pm-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="pp-${idx}" oninput="calcPN()"/></td>
    <td><input type="number" step="0.01" placeholder="—" class="pn-input" id="ps-${idx}" oninput="calcPN()"/></td>
    <td class="td-tot" id="ptot-${idx}">€ 0,00</td>`;
  tbody.insertBefore(tr, chiusura);
  pnPrelieviCount++;
}

function removeRow(btn, tipo, idx) {
  btn.closest('tr').remove();
  calcPN();
}

function resetPN() {
  const campi = ['pn-fc','incasso-m','incasso-p','incasso-s','money-m','money-p','money-s',
    'sisal-m','sisal-p','sisal-s','fatture-m','fatture-p','fatture-s','giornali-m','giornali-p','giornali-s',
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
    ['incasso','incasso'],['money','money'],['sisal','sisal'],
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
}

// Override loadNotaGiorno
function loadNotaGiorno() { loadNotaGiorno2(); }


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
  let beneficiario = document.getElementById('na-beneficiario').value.trim();
  if (!beneficiario && fornitoreId) {
    const f = fornitoriCache.find(x => x.id === fornitoreId);
    if (f) beneficiario = f.ragione_sociale;
  }

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
  ['na-numero','na-beneficiario','na-importo','na-note'].forEach(id => document.getElementById(id).value = '');
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
  
  await db.from('fornitori').update({ attivo: false }).eq('id', id);
  await loadFornitoriCache();
  populateFornitoriSelects();
  loadFornitoriList();
  showToast('Fornitore eliminato', 'success');
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

  const payload = {
    business_id: currentBusiness.id, location_id: locId, data, fondo_cassa: fc,
    incasso_m: getV('incasso-m'), incasso_p: getV('incasso-p'), incasso_s: getV('incasso-s'),
    money_m: getV('money-m'), money_p: getV('money-p'), money_s: getV('money-s'),
    sisal_m: getV('sisal-m'), sisal_p: getV('sisal-p'), sisal_s: getV('sisal-s'),
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
    created_by: currentUser.id, updated_at: new Date().toISOString()
  };

  const { data: saved, error } = await db.from('daily_notes')
    .upsert(payload, { onConflict: 'business_id,location_id,data' })
    .select().single();
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

  showPNMsg('Prima nota salvata ✓' + (fcChiusura > 0 ? ' — fondo cassa domani pre-compilato' : ''), 'success');
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
}

async function initImpostazioni() {
  await loadCategorieLista();
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
