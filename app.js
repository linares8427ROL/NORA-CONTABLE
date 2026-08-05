const CATEGORY_ICONS = {
  alimentacion: 'icons/cat-alimentacion.svg',
  transporte: 'icons/cat-transporte.svg',
  entretenimiento: 'icons/cat-entretenimiento.svg',
  salud: 'icons/cat-salud.svg',
  servicios: 'icons/cat-servicios.svg',
  ropa: 'icons/cat-ropa.svg',
  general: 'icons/cat-general.svg',
  otro: 'icons/cat-otro.svg'
};

const CATEGORY_COLORS = {
  alimentacion: '#27ae60',
  transporte: '#3498db',
  entretenimiento: '#9b59b6',
  salud: '#e74c3c',
  servicios: '#f39c12',
  ropa: '#1abc9c',
  general: '#95a5a6',
  otro: '#7f8c8d'
};

let currentScreen = 'home';
let expenses = [];
let cards = [];
let cutoffDay = 15;
let editingExpenseId = null;
let editingCardId = null;

// Init
async function init() {
  try {
    await db.init();
    cutoffDay = (await db.getSetting('cutoffDay')) || 15;
    await loadTheme();
    await loadData();
    initSimpleSync();
    setupEventListeners();
    renderHome();
  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('homeEmpty').style.display = 'block';
    document.getElementById('homeDashboard').style.display = 'none';
    try { setupEventListeners(); } catch (_) {}
  }
}

async function loadTheme() {
  const theme = await db.getSetting('theme') || 'auto';
  applyTheme(theme);
  document.getElementById('themeSelect').value = theme;
  updateThemeIcons(theme);
}

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function updateThemeIcons(theme) {
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('iconSun').style.display = isDark ? 'none' : 'block';
  document.getElementById('iconMoon').style.display = isDark ? 'block' : 'none';
}

async function saveTheme() {
  const theme = document.getElementById('themeSelect').value;
  await db.setSetting('theme', theme);
  applyTheme(theme);
  updateThemeIcons(theme);
  showToast('Tema guardado');
}

function cycleTheme() {
  const select = document.getElementById('themeSelect');
  const themes = ['dark', 'light', 'auto'];
  const idx = themes.indexOf(select.value);
  const next = themes[(idx + 1) % themes.length];
  select.value = next;
  applyTheme(next);
  updateThemeIcons(next);
  db.setSetting('theme', next);
}

async function loadData() {
  expenses = (await db.getExpenses()).map(normalizeExpense);
  cards = await db.getCards();
}

// Credit card logic (all derived from movements, nothing manual)
function getCardCutoff(cardId) {
  if (cardId && cardId !== 'all') {
    const card = cards.find(c => c.id == cardId);
    if (card && card.cutoffDay) return parseInt(card.cutoffDay);
  }
  return cutoffDay;
}

function getNextDueDate(cardId) {
  const card = cards.find(c => c.id == cardId);
  const due = (card && card.dueDay) ? parseInt(card.dueDay) : null;
  if (!due) return null;
  const now = new Date();
  let dueDate = new Date(now.getFullYear(), now.getMonth(), due);
  if (dueDate < now) {
    dueDate = new Date(now.getFullYear(), now.getMonth() + 1, due);
  }
  return dueDate;
}

function normalizeExpense(e) {
  if (!e.type) e.type = 'normal';
  if (e.paid === undefined) e.paid = false;
  if (e.paidInstallments === undefined) e.paidInstallments = 0;
  return e;
}

function msiMonthly(e) {
  return e.installments > 0 ? e.amount / e.installments : 0;
}

function msiRemaining(e) {
  return Math.max(0, (e.installments || 0) - (e.paidInstallments || 0));
}

function isNormalPending(e) {
  return e.type !== 'msi' && !e.paid;
}

function isMsiActive(e) {
  return e.type === 'msi' && msiRemaining(e) > 0;
}

function cardStats(cardId) {
  const list = cardId === 'all' ? expenses : expenses.filter(e => e.cardId == cardId);
  const normalPending = list.filter(isNormalPending);
  const msiActive = list.filter(isMsiActive);
  const usedNormal = normalPending.reduce((s, e) => s + parseFloat(e.amount), 0);
  const usedMsi = msiActive.reduce((s, e) => s + (parseFloat(e.amount) - (e.paidInstallments || 0) * msiMonthly(e)), 0);
  const used = usedNormal + usedMsi;
  const limit = cardId === 'all'
    ? cards.reduce((s, c) => s + (parseFloat(c.creditLimit) || 0), 0)
    : (parseFloat(cards.find(c => c.id == cardId)?.creditLimit) || 0);
  const available = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const cycleDates = getCycleDates(cardId);
  const cycleExpenses = list.filter(e => {
    const d = parseDate(e.date);
    return d >= cycleDates.start && d <= cycleDates.end;
  });
  const normalCycleTotal = cycleExpenses
    .filter(e => e.type !== 'msi' && !e.paid)
    .reduce((s, e) => s + parseFloat(e.amount), 0);
  const msiCycleTotal = msiActive.reduce((s, e) => s + msiMonthly(e), 0);
  const totalCycle = normalCycleTotal + msiCycleTotal;
  return { used, limit, available, pct, normalPending, msiActive, usedNormal, usedMsi, cycleTotal: totalCycle, cycleDates };
}

function getCycleDates(cardId) {
  const card = cardId === 'all' ? null : cards.find(c => c.id == cardId);
  const cutoff = card && card.cutoffDay ? parseInt(card.cutoffDay) : cutoffDay;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  let start, end;
  if (day <= cutoff) {
    start = new Date(year, month - 1, cutoff + 1);
    end = new Date(year, month, cutoff);
  } else {
    start = new Date(year, month, cutoff + 1);
    end = new Date(year, month + 1, cutoff);
  }
  return { start, end };
}

function parseDate(dateStr) {
  const parts = dateStr.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatCurrency(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// Navigation
function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen + 'Screen').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`[data-screen="${screen}"]`);
  if (navBtn) navBtn.classList.add('active');
  currentScreen = screen;

  if (screen === 'home') renderHome();
  else if (screen === 'history') renderHistory();
  else if (screen === 'cards') renderCards();
  else if (screen === 'settings') renderSettings();
}

// Render Home
function renderHome() {
  const filter = document.getElementById('cardFilter');
  const currentVal = filter.value;
  filter.innerHTML = '<option value="all">Todas las tarjetas</option>';
  cards.forEach(c => {
    filter.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}${c.lastDigits ? ' •••• ' + c.lastDigits : ''}</option>`;
  });
  filter.value = cards.some(c => c.id == currentVal) ? currentVal : (cards.length === 1 ? String(cards[0].id) : 'all');

  const homeEmpty = document.getElementById('homeEmpty');
  const dashboard = document.getElementById('homeDashboard');
  if (cards.length === 0) {
    homeEmpty.style.display = 'block';
    dashboard.style.display = 'none';
    return;
  }
  homeEmpty.style.display = 'none';
  dashboard.style.display = 'block';

  const cardId = filter.value || 'all';
  const stats = cardStats(cardId);

  document.getElementById('usedAmount').textContent = formatCurrency(stats.used);
  document.getElementById('totalToPay').textContent = formatCurrency(stats.cycleTotal);
  document.getElementById('limitAmount').textContent = formatCurrency(stats.limit);
  const availEl = document.getElementById('availableAmount');
  availEl.textContent = formatCurrency(stats.available);
  availEl.classList.toggle('low', stats.pct >= 80);
  const bar = document.getElementById('utilizationBar');
  bar.style.width = stats.pct + '%';
  bar.classList.toggle('danger', stats.pct >= 90);

  const dates = [];
  const cut = getCardCutoff(cardId);
  if (cut) dates.push(`Corte: día ${cut}`);
  const due = getNextDueDate(cardId);
  if (due) dates.push(`Límite de pago: ${due.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`);
  if (stats.cycleDates) {
    const s = stats.cycleDates.start;
    const e = stats.cycleDates.end;
    dates.push(`${formatDate(s.toISOString().split('T')[0])} - ${formatDate(e.toISOString().split('T')[0])}`);
  }
  document.getElementById('datesInfo').textContent = dates.join('  ·  ');

  const pendingSection = document.getElementById('pendingSection');
  const pendingList = document.getElementById('pendingList');
  if (stats.normalPending.length === 0) {
    pendingSection.style.display = 'none';
  } else {
    pendingSection.style.display = 'block';
    pendingList.innerHTML = stats.normalPending
      .sort((a, b) => parseDate(b.date) - parseDate(a.date))
      .map(e => pendingItemHTML(e)).join('');
  }

  const msiSection = document.getElementById('msiSection');
  const msiList = document.getElementById('msiList');
  if (stats.msiActive.length === 0) {
    msiSection.style.display = 'none';
  } else {
    msiSection.style.display = 'block';
    msiList.innerHTML = stats.msiActive
      .sort((a, b) => parseDate(b.date) - parseDate(a.date))
      .map(e => msiItemHTML(e)).join('');
  }
}

function pendingItemHTML(e) {
  const card = cards.find(c => c.id == e.cardId);
  const icon = CATEGORY_ICONS[e.category] || CATEGORY_ICONS.general;
  const catColor = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.general;
  const cardName = card ? card.name : 'N/A';
  return `
    <div class="expense-item pending-item" style="border-left-color: ${card ? card.color : '#0A2540'}">
      <div class="expense-icon" style="background: ${catColor}20; border: 1.5px solid ${catColor}">
        <img src="${icon}" width="18" height="18" style="filter: brightness(0) invert(1)">
      </div>
      <div class="expense-details">
        <div class="expense-desc">${escapeHtml(e.description)}</div>
        <div class="expense-meta">${escapeHtml(cardName)} · ${formatDate(e.date)}${e.merchant ? ' · ' + escapeHtml(e.merchant) : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <span class="expense-amount">${formatCurrency(parseFloat(e.amount))}</span>
        <button class="btn-pay" onclick="markPurchasePaid(${e.id})">Pagar</button>
      </div>
    </div>`;
}

function msiItemHTML(e) {
  const card = cards.find(c => c.id == e.cardId);
  const cardName = card ? card.name : 'N/A';
  const monthly = msiMonthly(e);
  const paid = e.paidInstallments || 0;
  const remaining = msiRemaining(e);
  const pct = Math.min(100, (paid / e.installments) * 100);
  const due = getNextDueDate(e.cardId);
  const nextLabel = due ? due.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—';
  return `
    <div class="msi-item" style="border-left-color: ${card ? card.color : '#0A2540'}">
      <div class="msi-header">
        <div class="msi-desc">${escapeHtml(e.description)}<span class="badge msi-badge">MSI ${e.installments}</span></div>
        <div class="msi-meta">${escapeHtml(cardName)} · ${formatDate(e.date)}${e.merchant ? ' · ' + escapeHtml(e.merchant) : ''}</div>
      </div>
      <div class="msi-info-grid">
        <div><span>Monto original</span><b>${formatCurrency(parseFloat(e.amount))}</b></div>
        <div><span>Mensualidad</span><b>${formatCurrency(monthly)}</b></div>
        <div><span>Meses pagados</span><b>${paid} / ${e.installments}</b></div>
        <div><span>Faltan</span><b>${remaining}</b></div>
      </div>
      <div class="msi-progress"><div class="msi-progress-fill" style="width:${pct}%"></div></div>
      <div class="msi-footer">
        <span class="msi-next">Próximo pago: ${nextLabel}</span>
        <button class="btn-pay" onclick="payMsiInstallment(${e.id})">Pagar mensualidad</button>
      </div>
    </div>`;
}

function historyItemHTML(e) {
  const card = cards.find(c => c.id == e.cardId);
  const icon = CATEGORY_ICONS[e.category] || CATEGORY_ICONS.general;
  const catColor = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.general;
  const isMsi = e.type === 'msi';
  const paid = isMsi ? (e.paidInstallments || 0) >= (e.installments || 0) : e.paid;
  const badge = isMsi
    ? `<span class="badge msi-badge">MSI · ${e.paidInstallments || 0}/${e.installments}</span>`
    : `<span class="badge ${paid ? 'paid-badge' : 'pending-badge'}">${paid ? 'Pagada' : 'Pendiente'}</span>`;
  const metaParts = [card ? card.name : 'N/A', formatDate(e.date)];
  if (e.merchant) metaParts.push(e.merchant);
  const sub = e.notes ? `<div class="expense-notes">${escapeHtml(e.notes)}</div>` : '';
  return `
    <div class="expense-item" style="border-left-color: ${card ? card.color : '#0A2540'}">
      <div class="expense-icon" style="background: ${catColor}20; border: 1.5px solid ${catColor}">
        <img src="${icon}" width="18" height="18" style="filter: brightness(0) invert(1)">
      </div>
      <div class="expense-details">
        <div class="expense-desc">${escapeHtml(e.description)} ${badge}</div>
        <div class="expense-meta">${escapeHtml(metaParts.join(' · '))}</div>
        ${sub}
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <span class="expense-amount">${isMsi ? formatCurrency(msiMonthly(e)) + '<small class="amount-unit">/mes</small>' : formatCurrency(parseFloat(e.amount))}</span>
        <div class="expense-actions">
          <button class="btn-icon" onclick="editExpense(${e.id})"><img src="icons/edit.svg" width="18" height="18"></button>
          <button class="btn-icon delete" onclick="deleteExpense(${e.id})"><img src="icons/trash.svg" width="18" height="18"></button>
        </div>
      </div>
    </div>`;
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Render History
function renderHistory() {
  const container = document.getElementById('historyList');
  const search = document.getElementById('searchInput').value.toLowerCase();
  const month = document.getElementById('filterMonth').value;
  const category = document.getElementById('filterCategory').value;

  let filtered = [...expenses];

  if (search) {
    filtered = filtered.filter(e => 
      e.description.toLowerCase().includes(search) ||
      (e.merchant || '').toLowerCase().includes(search) ||
      (cards.find(c => c.id == e.cardId)?.name || '').toLowerCase().includes(search)
    );
  }

  if (month !== 'all') {
    filtered = filtered.filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      return d.getMonth() == month;
    });
  }

  if (category !== 'all') {
    filtered = filtered.filter(e => e.category === category);
  }

  filtered.sort((a, b) => parseDate(b.date) - parseDate(a.date));

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">No se encontraron gastos</p>';
    return;
  }

  // Group by month
  const grouped = {};
  filtered.forEach(e => {
    const d = new Date(e.date + 'T00:00:00');
    const key = d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long' });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  });

  let html = '';
  for (const [groupKey, items] of Object.entries(grouped)) {
    const monthTotal = items.reduce((s, e) => s + parseFloat(e.amount), 0);
    html += `<div class="month-group">
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;color:var(--text-secondary);font-size:0.85rem">
        <span>${groupKey}</span>
        <span>${formatCurrency(monthTotal)}</span>
      </div>`;
    items.forEach(e => { html += historyItemHTML(e); });
    html += '</div>';
  }

  container.innerHTML = html;

  // Populate month filter
  const monthFilter = document.getElementById('filterMonth');
  const currentMonth = monthFilter.value;
  const months = [...new Set(expenses.map(e => new Date(e.date + 'T00:00:00').getMonth()))];
  monthFilter.innerHTML = '<option value="all">Todos los meses</option>';
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  months.sort((a,b) => b - a).forEach(m => {
    monthFilter.innerHTML += `<option value="${m}">${monthNames[m]}</option>`;
  });
  monthFilter.value = currentMonth || 'all';
}

// Render Cards
function renderCards() {
  const container = document.getElementById('cardsList');
  if (cards.length === 0) {
    container.innerHTML = '<p class="empty-state">Sin tarjetas registradas</p>';
    return;
  }

  container.innerHTML = cards.map(c => {
    const stats = cardStats(c.id);
    const limitInfo = c.creditLimit ? `<span class="card-limit">Límite: ${formatCurrency(parseFloat(c.creditLimit))}</span>` : '';
    const cutInfo = c.cutoffDay ? ` · Corte: ${c.cutoffDay}` : '';
    const dueInfo = c.dueDay ? ` · Pago: ${c.dueDay}` : '';
    const saldoInfo = `<div class="card-saldo">
      <span>Usado: ${formatCurrency(stats.used)}</span>
      <span>Disponible: ${formatCurrency(stats.available)}</span>
    </div>`;
    return `
    <div class="card-item">
      <div class="card-color" style="background:${c.color}"></div>
      <div class="card-info">
        <h4>${escapeHtml(c.name)}</h4>
        <p>${c.lastDigits ? '•••• ' + c.lastDigits : 'Sin número'}${cutInfo}${dueInfo}</p>
        ${limitInfo}
        ${saldoInfo}
      </div>
      <div class="card-actions">
        <button class="btn-icon" onclick="editCard(${c.id})"><img src="icons/edit.svg" width="18" height="18"></button>
        <button class="btn-icon delete" onclick="deleteCard(${c.id})"><img src="icons/trash.svg" width="18" height="18"></button>
      </div>
    </div>
  `;
  }).join('');
}

// Render Settings
function renderSettings() {
  document.getElementById('cutoffDay').value = cutoffDay;
}

// Expense CRUD
function syncExpenseFormType() {
  const isMsi = document.getElementById('expenseType').value === 'msi';
  document.getElementById('installmentsGroup').style.display = isMsi ? 'block' : 'none';
  document.getElementById('expensePaidGroup').style.display = isMsi ? 'none' : 'block';
  document.getElementById('installmentsPaidGroup').style.display = isMsi ? 'block' : 'none';
  document.getElementById('expenseInstallments').required = isMsi;
}

function openExpenseForm(expense = null) {
  editingExpenseId = expense ? expense.id : null;
  document.getElementById('expenseId').value = expense ? expense.id : '';
  document.getElementById('expenseDesc').value = expense ? expense.description : '';
  document.getElementById('expenseMerchant').value = expense ? (expense.merchant || '') : '';
  document.getElementById('expenseAmount').value = expense ? expense.amount : '';
  document.getElementById('expenseDate').value = expense ? expense.date : new Date().toISOString().split('T')[0];
  document.getElementById('expenseCategory').value = expense ? expense.category : 'general';
  document.getElementById('expenseNotes').value = expense ? (expense.notes || '') : '';

  const type = expense && expense.type === 'msi' ? 'msi' : 'normal';
  document.getElementById('expenseType').value = type;
  document.getElementById('expenseInstallments').value = expense && expense.installments ? String(expense.installments) : '3';
  document.getElementById('expenseInstallmentsPaid').value = expense ? (expense.paidInstallments || 0) : 0;
  document.getElementById('expensePaid').checked = expense ? !!expense.paid : false;
  syncExpenseFormType();

  // Populate cards
  const select = document.getElementById('expenseCard');
  select.innerHTML = '<option value="">Seleccionar tarjeta</option>';
  cards.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}${c.lastDigits ? ' •••• ' + c.lastDigits : ''}</option>`;
  });
  select.value = expense ? expense.cardId : (cards.length === 1 ? cards[0].id : '');

  navigateTo('expense');
}

async function saveExpense(e) {
  e.preventDefault();
  try {
    const type = document.getElementById('expenseType').value;
    const data = {
      description: document.getElementById('expenseDesc').value.trim(),
      merchant: document.getElementById('expenseMerchant').value.trim(),
      amount: parseFloat(document.getElementById('expenseAmount').value),
      cardId: document.getElementById('expenseCard').value ? parseInt(document.getElementById('expenseCard').value) : null,
      date: document.getElementById('expenseDate').value,
      category: document.getElementById('expenseCategory').value,
      notes: document.getElementById('expenseNotes').value.trim(),
      type
    };

    if (!data.description || isNaN(data.amount) || data.amount <= 0 || !data.cardId) {
      showToast('Completa todos los campos obligatorios');
      return;
    }

    if (type === 'msi') {
      data.installments = parseInt(document.getElementById('expenseInstallments').value);
      data.paidInstallments = Math.min(
        parseInt(document.getElementById('expenseInstallmentsPaid').value) || 0,
        data.installments
      );
      data.paid = data.paidInstallments >= data.installments;
    } else {
      const wasPaid = editingExpenseId ? (expenses.find(x => x.id === editingExpenseId)?.paid || false) : false;
      data.paid = document.getElementById('expensePaid').checked;
      data.paidDate = data.paid ? (wasPaid ? (expenses.find(x => x.id === editingExpenseId)?.paidDate || null) : new Date().toISOString().split('T')[0]) : null;
      data.installments = null;
    }

    if (editingExpenseId) {
      data.id = editingExpenseId;
      await db.updateExpense(data);
      showToast('Compra actualizada');
    } else {
      await db.addExpense(data);
      showToast(type === 'msi' ? 'MSI registrado' : 'Compra guardada');
    }

    editingExpenseId = null;
    await loadData();
    navigateTo('home');
    patchDataToSync();
  } catch (err) {
    console.error('Error guardando compra:', err);
    showToast('Error al guardar');
  }
}

function editExpense(id) {
  const expense = expenses.find(e => e.id === id);
  if (expense) openExpenseForm(expense);
}

async function deleteExpense(id) {
  if (confirm('¿Eliminar esta compra?')) {
    await db.deleteExpense(id);
    await loadData();
    if (currentScreen === 'home') renderHome();
    else if (currentScreen === 'history') renderHistory();
    showToast('Compra eliminada');
    patchDataToSync();
  }
}

async function markPurchasePaid(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  expense.paid = true;
  expense.paidDate = new Date().toISOString().split('T')[0];
  await db.updateExpense(expense);
  await loadData();
  renderHome();
  showToast('Compra marcada como pagada');
  patchDataToSync();
}

async function payMsiInstallment(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  const monthly = msiMonthly(expense);
  if (!confirm(`¿Pagar esta mensualidad de ${formatCurrency(monthly)}?`)) return;
  expense.paidInstallments = (expense.paidInstallments || 0) + 1;
  expense.paid = expense.paidInstallments >= (expense.installments || 0);
  await db.updateExpense(expense);
  await loadData();
  renderHome();
  showToast(expense.paid ? 'MSI pagado por completo' : 'Mensualidad pagada');
  patchDataToSync();
}

// Card CRUD
function openCardForm(card = null) {
  editingCardId = card ? card.id : null;
  document.getElementById('cardModalTitle').textContent = card ? 'Editar Tarjeta' : 'Nueva Tarjeta';
  document.getElementById('cardId').value = card ? card.id : '';
  document.getElementById('cardName').value = card ? card.name : '';
  document.getElementById('cardLastDigits').value = card ? card.lastDigits : '';
  document.getElementById('cardCreditLimit').value = card && card.creditLimit ? card.creditLimit : '';
  document.getElementById('cardCutoffDay').value = card && card.cutoffDay ? card.cutoffDay : '';
  document.getElementById('cardDueDay').value = card && card.dueDay ? card.dueDay : '';
  document.getElementById('cardColor').value = card ? card.color : '#0A2540';
  document.getElementById('cardModal').classList.remove('hidden');
}

function closeCardModal() {
  document.getElementById('cardModal').classList.add('hidden');
  editingCardId = null;
}

async function saveCard(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('cardName').value.trim(),
    lastDigits: document.getElementById('cardLastDigits').value,
    creditLimit: document.getElementById('cardCreditLimit').value ? parseFloat(document.getElementById('cardCreditLimit').value) : null,
    cutoffDay: document.getElementById('cardCutoffDay').value ? parseInt(document.getElementById('cardCutoffDay').value) : null,
    dueDay: document.getElementById('cardDueDay').value ? parseInt(document.getElementById('cardDueDay').value) : null,
    color: document.getElementById('cardColor').value
  };

  if (editingCardId) {
    data.id = editingCardId;
    await db.updateCard(data);
    showToast('Tarjeta actualizada');
  } else {
    await db.addCard(data);
    showToast('Tarjeta creada');
  }

  await loadData();
  closeCardModal();
  renderCards();
  renderHome();
  patchDataToSync();
}

function editCard(id) {
  const card = cards.find(c => c.id === id);
  if (card) openCardForm(card);
}

async function deleteCard(id) {
  if (confirm('¿Eliminar esta tarjeta? Los gastos asociados no se eliminarán.')) {
    await db.deleteCard(id);
    await loadData();
    renderCards();
    renderHome();
    showToast('Tarjeta eliminada');
    patchDataToSync();
  }
}

function setupEventListeners() {
  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
  });

  // Home
  document.getElementById('btnAddExpense').addEventListener('click', () => openExpenseForm());
  document.getElementById('btnHomeAddCard').addEventListener('click', () => openCardForm());
  document.getElementById('cardFilter').addEventListener('change', () => {
    renderHome();
  });
  document.getElementById('btnTheme').addEventListener('click', cycleTheme);

  // Expense Form
  document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
  document.getElementById('btnCancelExpense').addEventListener('click', () => navigateTo('home'));
  document.getElementById('expenseType').addEventListener('change', syncExpenseFormType);

  // Card Form
  document.getElementById('btnAddCard').addEventListener('click', () => openCardForm());
  document.getElementById('cardForm').addEventListener('submit', saveCard);
  document.getElementById('btnCancelCard').addEventListener('click', closeCardModal);

  // History
  document.getElementById('searchInput').addEventListener('input', renderHistory);
  document.getElementById('filterMonth').addEventListener('change', renderHistory);
  document.getElementById('filterCategory').addEventListener('change', renderHistory);

  // Settings
  document.getElementById('btnSaveCutoff').addEventListener('click', async () => {
    cutoffDay = parseInt(document.getElementById('cutoffDay').value);
    await db.setSetting('cutoffDay', cutoffDay);
    showToast('Fecha de corte guardada');
    renderHome();
  });

  document.getElementById('btnSaveTheme').addEventListener('click', saveTheme);

  document.getElementById('themeSelect').addEventListener('change', (e) => {
    applyTheme(e.target.value);
    updateThemeIcons(e.target.value);
  });

  if ('matchMedia' in window) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const theme = document.getElementById('themeSelect').value;
      if (theme === 'auto') {
        applyTheme('auto');
        updateThemeIcons('auto');
      }
    });
  }

  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', importData);
  document.getElementById('btnClearAll').addEventListener('click', clearAllData);

  // Simple Sync
  document.getElementById('btnGenerateSimpleCode').addEventListener('click', () => {
    generateSimpleSyncCode();
  });
  document.getElementById('btnCopySimpleCode').addEventListener('click', () => {
    const code = document.getElementById('simpleSyncCode');
    code.select();
    navigator.clipboard.writeText(code.value).then(() => showToast('Código copiado'));
  });
  document.getElementById('btnJoinSimpleCode').addEventListener('click', () => {
    const code = document.getElementById('joinSimpleCode').value.trim().toUpperCase();
    if (!code) { showToast('Ingresa un código primero'); return; }
    joinSimpleSync(code);
  });
  document.getElementById('btnDisconnectSimpleSync').addEventListener('click', () => {
    disconnectSimpleSync();
  });
}

// Register SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Export / Import / Clear
async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nora-backup-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Datos exportados');
}

async function importData() {
  const file = document.getElementById('importFile').files[0];
  if (!file) { showToast('Selecciona un archivo'); return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.expenses && !data.cards) {
      showToast('Archivo no válido');
      return;
    }
    await db.importAll(data);
    await loadData();
    renderHome();
    showToast('Datos importados');
  } catch (err) {
    console.error('Import error:', err);
    showToast('Error al importar');
  }
}

async function clearAllData() {
  if (!confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) return;
  await db.clearAll();
  expenses = [];
  cards = [];
  renderHome();
  showToast('Datos eliminados');
  patchDataToSync();
}

// Simple Local Sync
let syncRoomId = null;

function getSyncRoomId() {
  return localStorage.getItem('nora_simple_sync');
}

function saveSyncRoom(id) {
  localStorage.setItem('nora_simple_sync', id);
}

function clearSyncRoom() {
  localStorage.removeItem('nora_simple_sync');
}

function generateSimpleSyncCode() {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  saveSyncRoom(code);
  document.getElementById('simpleSyncCode').value = code;
  document.getElementById('simpleCodeBox').style.display = 'block';
  showToast('Código de sincronización generado');
}

async function joinSimpleSync(code) {
  if (!code) { showToast('Ingresa un código primero'); return false; }
  try {
    const url = new URL(window.location.href);
    const roomParam = url.searchParams.get('sync');
    if (roomParam) {
      saveSyncRoom(roomParam);
    } else {
      saveSyncRoom(code);
    }
    await loadData();
    renderHome();
    showToast('Sincronizado con éxito');
    return true;
  } catch (err) {
    console.error('Join simple sync error:', err);
    showToast('Error al unirse');
    return false;
  }
}

async function syncToSimple() {
  const room = getSyncRoomId();
  if (!room) return;
  try {
    localStorage.setItem(`nora_sync_${room}`, JSON.stringify({
      expenses,
      cards,
      cutoffDay,
      updatedAt: Date.now()
    }));
    updateSimpleSyncStatus('Sincronizado');
  } catch (err) {
    console.error('Upload simple sync error:', err);
  }
}

async function syncFromSimple() {
  const room = getSyncRoomId();
  if (!room) return;
  try {
    const saved = localStorage.getItem(`nora_sync_${room}`);
    if (!saved) return;
    const data = JSON.parse(saved);
    if (!data.updatedAt || data.updatedAt < Date.now() - 1000) return;
    expenses = (data.expenses || []).map(normalizeExpense);
    cards = data.cards || [];
    if (data.cutoffDay) cutoffDay = data.cutoffDay;
    const tx = db.db.transaction(['expenses', 'cards', 'settings'], 'readwrite');
    tx.objectStore('expenses').clear();
    tx.objectStore('cards').clear();
    expenses.forEach(e => { const { id, ...rest } = e; tx.objectStore('expenses').add(rest); });
    cards.forEach(c => { const { id, ...rest } = c; tx.objectStore('cards').add(rest); });
    if (data.cutoffDay) tx.objectStore('settings').put({ key: 'cutoffDay', value: data.cutoffDay });
    tx.oncomplete = () => {
      if (currentScreen === 'home') renderHome();
      else if (currentScreen === 'history') renderHistory();
      else if (currentScreen === 'cards') renderCards();
    };
    updateSimpleSyncStatus('Sincronizado');
  } catch (err) {
    console.error('Download simple sync error:', err);
    updateSimpleSyncStatus('Error de descarga');
  }
}

function updateSimpleSyncStatus(msg) {
  const el = document.getElementById('simpleSyncStatus');
  if (el) {
    el.textContent = msg + ' · ' + new Date().toLocaleTimeString('es-MX');
  }
}

function disconnectSimpleSync() {
  clearSyncRoom();
  document.getElementById('simpleCodeBox').style.display = 'none';
  document.getElementById('simpleSyncSetup').style.display = 'block';
  updateSimpleSyncStatus('');
  showToast('Sincronización detenida');
}

function showSimpleSyncConnected(room) {
  document.getElementById('simpleSyncSetup').style.display = 'none';
  document.getElementById('simpleCodeBox').style.display = 'none';
  document.getElementById('simpleSyncStatus').style.display = 'block';
  document.getElementById('btnDisconnectSimpleSync').style.display = 'block';
  updateSimpleSyncStatus('Conectado · ' + room);
}

// Auto-sync
function patchDataToSync() {
  if (getSyncRoomId()) {
    clearTimeout(window._simpleSyncTimer);
    window._simpleSyncTimer = setTimeout(syncToSimple, 1500);
  }
}

function initSimpleSync() {
  const urlParams = new URLSearchParams(window.location.search);
  const syncCode = urlParams.get('sync');
  if (syncCode) {
    saveSyncRoom(syncCode);
    syncFromSimple();
  }
  const room = getSyncRoomId();
  if (room) {
    showSimpleSyncConnected(room);
    syncFromSimple();
  }
}

// Start
init();
