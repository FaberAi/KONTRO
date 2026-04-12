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
  await loadDashboard();
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
async function loadBusiness() {
  const { data } = await db
    .from('user_roles')
    .select('business_id, role, businesses(*)')
    .eq('user_id', currentUser.id)
    .single();

  if (data) currentBusiness = data.businesses;
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
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === name);
  });
  const titles = { dashboard: 'Dashboard', nuovo: 'Nuovo movimento', movimenti: 'Movimenti', report: 'Report', sedi: 'Sedi', team: 'Team' };
  document.getElementById('page-title').textContent = titles[name] || name;

  if (name === 'movimenti') loadMovimenti();
  if (name === 'report') loadReport();
  if (name === 'sedi') renderLocationsList();
  if (name === 'team') loadTeam();
}

function updateUserUI() {
  const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '?';
  const initial = name[0].toUpperCase();
  document.getElementById('user-avatar').textContent = initial;
  document.getElementById('user-name-sidebar').textContent = name;
  document.getElementById('business-name-sidebar').textContent = currentBusiness?.name || '—';
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
  if (!confirm('Eliminare questo movimento?')) return;
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
      return `
        <div class="member-item">
          <div class="member-avatar">${initial}</div>
          <div class="member-info">
            <div class="member-name">${p?.full_name || '—'}</div>
            <div class="member-email">${p?.email || '—'}</div>
          </div>
          <span class="role-badge ${r.role}">${roleLabel(r.role)}</span>
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
