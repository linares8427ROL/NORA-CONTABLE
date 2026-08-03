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
  await db.init();
  cutoffDay = (await db.getSetting('cutoffDay')) || 15;
  await loadData();
  setupEventListeners();
  renderHome();
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
  return { used, limit, available, pct, normalPending, msiActive, usedNormal, usedMsi };
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
    <div class="expense-item pending-item" style="border-left-color: ${card ? card.color : '#e94560'}">
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
        <div class="expense-actions">
          <button class="btn-icon" onclick="editExpense(${e.id})"><img src="icons/edit.svg" width="18" height="18"></button>
          <button class="btn-icon delete" onclick="deleteExpense(${e.id})"><img src="icons/trash.svg" width="18" height="18"></button>
        </div>
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
    <div class="msi-item" style="border-left-color: ${card ? card.color : '#e94560'}">
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
    <div class="expense-item" style="border-left-color: ${card ? card.color : '#e94560'}">
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
  for (const [month, items] of Object.entries(grouped)) {
    const monthTotal = items.reduce((s, e) => s + parseFloat(e.amount), 0);
    html += `<div class="month-group">
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;color:var(--text-secondary);font-size:0.85rem">
        <span>${month}</span>
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
  const type = document.getElementById('expenseType').value;
  const data = {
    description: document.getElementById('expenseDesc').value.trim(),
    merchant: document.getElementById('expenseMerchant').value.trim(),
    amount: parseFloat(document.getElementById('expenseAmount').value),
    cardId: parseInt(document.getElementById('expenseCard').value),
    date: document.getElementById('expenseDate').value,
    category: document.getElementById('expenseCategory').value,
    notes: document.getElementById('expenseNotes').value.trim(),
    type
  };

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

  await loadData();
  editingExpenseId = null;
  navigateTo('home');
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
}

async function payMsiInstallment(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  expense.paidInstallments = (expense.paidInstallments || 0) + 1;
  expense.paid = expense.paidInstallments >= (expense.installments || 0);
  await db.updateExpense(expense);
  await loadData();
  renderHome();
  showToast(expense.paid ? 'MSI pagado por completo' : 'Mensualidad pagada');
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
  document.getElementById('cardColor').value = card ? card.color : '#e94560';
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
  }
}

// Voice Recognition - Conversational Flow
let voiceState = null;

function startVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Reconocimiento de voz no disponible');
    return;
  }
  if (!('speechSynthesis' in window)) {
    showToast('Síntesis de voz no disponible');
    return;
  }

  voiceState = { step: 'desc', data: {} };
  speak('¿Qué compraste?');
  listenStep();
}

function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

function listenStep() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'es-MX';
  recognition.interimResults = false;

  const btn = document.getElementById('btnVoice');
  btn.classList.add('listening');

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript.toLowerCase().trim();
    btn.classList.remove('listening');
    handleVoiceAnswer(text);
  };

  recognition.onerror = () => {
    btn.classList.remove('listening');
    showToast('No se pudo reconocer. Intenta de nuevo.');
    voiceState = null;
  };

  recognition.onend = () => btn.classList.remove('listening');
  recognition.start();
}

function handleVoiceAnswer(text) {
  if (!voiceState) return;

  switch (voiceState.step) {
    case 'desc':
      voiceState.data.desc = text;
      speak('¿Cuánto costó?');
      voiceState.step = 'amount';
      listenStep();
      break;

    case 'amount': {
      const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (!amountMatch) {
        speak('No entendí el monto. Repítelo, por favor.');
        listenStep();
        return;
      }
      voiceState.data.amount = parseFloat(amountMatch[1]);
      speak('¿Categoría? Alimentación, transporte, entretenimiento, salud, servicios, ropa u otro.');
      voiceState.step = 'category';
      listenStep();
      break;
    }

    case 'category': {
      const cats = ['alimentación', 'transporte', 'entretenimiento', 'salud', 'servicios', 'ropa', 'otro'];
      const found = cats.find(c => text.includes(c));
      voiceState.data.category = found || 'otro';
      speak('¿Fue contado o a meses sin intereses?');
      voiceState.step = 'type';
      listenStep();
      break;
    }

    case 'type': {
      const isMsi = text.includes('meses') || text.includes('msi') || text.includes('sin intereses');
      voiceState.data.type = isMsi ? 'msi' : 'normal';
      if (isMsi) {
        speak('¿A cuántos meses?');
        voiceState.step = 'installments';
        listenStep();
      } else {
        finishVoiceExpense();
      }
      break;
    }

    case 'installments': {
      const m = text.match(/(\d+)/);
      voiceState.data.installments = m ? Math.min(48, Math.max(2, parseInt(m[1]))) : 12;
      finishVoiceExpense();
      break;
    }
  }
}

function finishVoiceExpense() {
  const { desc, amount, category, type, installments } = voiceState.data;
  openExpenseForm();
  document.getElementById('expenseDesc').value = desc;
  document.getElementById('expenseAmount').value = amount;
  document.getElementById('expenseCategory').value = category;
  document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
  if (type === 'msi') {
    document.getElementById('expenseType').value = 'msi';
    syncExpenseFormType();
    document.getElementById('expenseInstallments').value = String(installments);
  }
  speak(`Listo. ${desc}, ${formatCurrency(amount)}, ${category}${type === 'msi' ? ', ' + installments + ' meses' : ''}.`);
  showToast(`Gasto cargado: ${desc} - ${formatCurrency(amount)}`);
  voiceState = null;
}

// Export/Import
function exportData() {
  db.exportAll().then(data => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nora-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Datos exportados');
  });
}

async function importData() {
  const file = document.getElementById('importFile').files[0];
  if (!file) {
    showToast('Selecciona un archivo primero');
    return;
  }

  if (!confirm('Esto reemplazará todos los datos actuales. ¿Continuar?')) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await db.importAll(data);
    await loadData();
    cutoffDay = (await db.getSetting('cutoffDay')) || 15;
    navigateTo('home');
    showToast('Datos importados correctamente');
  } catch (e) {
    showToast('Error al importar archivo');
  }
}

async function clearAllData() {
  if (confirm('¿Estás seguro? Esta acción no se puede deshacer.')) {
    if (confirm('Última oportunidad. ¿Borrar TODO?')) {
      await db.clearAll();
      await loadData();
      cutoffDay = 15;
      navigateTo('home');
      showToast('Todos los datos han sido eliminados');
    }
  }
}

// Toast
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Event Listeners
function setupEventListeners() {
  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
  });

  // Home
  document.getElementById('btnAddExpense').addEventListener('click', () => openExpenseForm());
  document.getElementById('btnVoice').addEventListener('click', startVoice);
  document.getElementById('btnHomeAddCard').addEventListener('click', () => openCardForm());
  document.getElementById('cardFilter').addEventListener('change', () => {
    renderHome();
  });

  // Expense Form
  document.getElementById('expenseForm').addEventListener('submit', saveExpense);
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

  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', importData);
  document.getElementById('btnClearAll').addEventListener('click', clearAllData);
}

// Register SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Start
init();
