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
  expenses = await db.getExpenses();
  cards = await db.getCards();
}

// Cycle calculation
function getCycleDates() {
  const now = new Date();
  const day = now.getDate();
  let start, end;

  if (day >= cutoffDay) {
    start = new Date(now.getFullYear(), now.getMonth(), cutoffDay);
    end = new Date(now.getFullYear(), now.getMonth() + 1, cutoffDay - 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, cutoffDay);
    end = new Date(now.getFullYear(), now.getMonth(), cutoffDay - 1);
  }

  return { start, end };
}

function getCycleTotal(cardId = 'all') {
  const { start, end } = getCycleDates();
  return expenses
    .filter(e => {
      const d = new Date(e.date);
      const inCycle = d >= start && d <= end;
      const matchCard = cardId === 'all' || e.cardId == cardId;
      return inCycle && matchCard;
    })
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
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
  document.querySelector(`[data-screen="${screen}"]`).classList.add('active');
  currentScreen = screen;

  if (screen === 'home') renderHome();
  else if (screen === 'history') renderHistory();
  else if (screen === 'cards') renderCards();
  else if (screen === 'settings') renderSettings();
}

// Render Home
function renderHome() {
  const total = getCycleTotal();
  const { start, end } = getCycleDates();
  document.getElementById('totalCiclo').textContent = formatCurrency(total);
  document.getElementById('cicloInfo').textContent = 
    `${start.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;

  // Card filter
  const filter = document.getElementById('cardFilter');
  const currentVal = filter.value;
  filter.innerHTML = '<option value="all">Todas las tarjetas</option>';
  cards.forEach(c => {
    filter.innerHTML += `<option value="${c.id}">${c.name}${c.lastDigits ? ' •••• ' + c.lastDigits : ''}</option>`;
  });
  filter.value = currentVal || 'all';

  // Recent expenses
  const recent = [...expenses]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const container = document.getElementById('recentExpenses');
  if (recent.length === 0) {
    container.innerHTML = '<p class="empty-state">Sin gastos recientes</p>';
    return;
  }

  container.innerHTML = recent.map(e => expenseHTML(e)).join('');
}

function expenseHTML(e) {
  const card = cards.find(c => c.id == e.cardId);
  const icon = CATEGORY_ICONS[e.category] || CATEGORY_ICONS.general;
  const catColor = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.general;
  return `
    <div class="expense-item" style="border-left-color: ${card ? card.color : '#e94560'}">
      <div class="expense-icon" style="background: ${catColor}20; border: 1.5px solid ${catColor}">
        <img src="${icon}" width="18" height="18" style="filter: brightness(0) invert(1)">
      </div>
      <div class="expense-details">
        <div class="expense-desc">${escapeHtml(e.description)}</div>
        <div class="expense-meta">${card ? card.name : 'N/A'} · ${formatDate(e.date)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <span class="expense-amount">${formatCurrency(parseFloat(e.amount))}</span>
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

  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

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
    items.forEach(e => { html += expenseHTML(e); });
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

  container.innerHTML = cards.map(c => `
    <div class="card-item">
      <div class="card-color" style="background:${c.color}"></div>
      <div class="card-info">
        <h4>${escapeHtml(c.name)}</h4>
        <p>${c.lastDigits ? '•••• ' + c.lastDigits : 'Sin número'}</p>
      </div>
      <div class="card-actions">
        <button class="btn-icon" onclick="editCard(${c.id})"><img src="icons/edit.svg" width="18" height="18"></button>
        <button class="btn-icon delete" onclick="deleteCard(${c.id})"><img src="icons/trash.svg" width="18" height="18"></button>
      </div>
    </div>
  `).join('');
}

// Render Settings
function renderSettings() {
  document.getElementById('cutoffDay').value = cutoffDay;
}

// Expense CRUD
function openExpenseForm(expense = null) {
  editingExpenseId = expense ? expense.id : null;
  document.getElementById('expenseId').value = expense ? expense.id : '';
  document.getElementById('expenseDesc').value = expense ? expense.description : '';
  document.getElementById('expenseAmount').value = expense ? expense.amount : '';
  document.getElementById('expenseDate').value = expense ? expense.date : new Date().toISOString().split('T')[0];
  document.getElementById('expenseCategory').value = expense ? expense.category : 'general';

  // Populate cards
  const select = document.getElementById('expenseCard');
  select.innerHTML = '<option value="">Seleccionar tarjeta</option>';
  cards.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.name}${c.lastDigits ? ' •••• ' + c.lastDigits : ''}</option>`;
  });
  select.value = expense ? expense.cardId : (cards.length === 1 ? cards[0].id : '');

  navigateTo('expense');
}

async function saveExpense(e) {
  e.preventDefault();
  const data = {
    description: document.getElementById('expenseDesc').value.trim(),
    amount: parseFloat(document.getElementById('expenseAmount').value),
    cardId: parseInt(document.getElementById('expenseCard').value),
    date: document.getElementById('expenseDate').value,
    category: document.getElementById('expenseCategory').value
  };

  if (editingExpenseId) {
    data.id = editingExpenseId;
    await db.updateExpense(data);
    showToast('Gasto actualizado');
  } else {
    await db.addExpense(data);
    showToast('Gasto guardado');
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
  if (confirm('¿Eliminar este gasto?')) {
    await db.deleteExpense(id);
    await loadData();
    if (currentScreen === 'home') renderHome();
    else if (currentScreen === 'history') renderHistory();
    showToast('Gasto eliminado');
  }
}

// Card CRUD
function openCardForm(card = null) {
  editingCardId = card ? card.id : null;
  document.getElementById('cardModalTitle').textContent = card ? 'Editar Tarjeta' : 'Nueva Tarjeta';
  document.getElementById('cardId').value = card ? card.id : '';
  document.getElementById('cardName').value = card ? card.name : '';
  document.getElementById('cardLastDigits').value = card ? card.lastDigits : '';
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

// Voice Recognition
function startVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Reconocimiento de voz no disponible');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'es-MX';
  recognition.interimResults = false;

  const btn = document.getElementById('btnVoice');
  btn.classList.add('listening');

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript.toLowerCase();
    parseVoiceInput(text);
    btn.classList.remove('listening');
  };

  recognition.onerror = () => {
    btn.classList.remove('listening');
    showToast('No se pudo reconocer. Intenta de nuevo.');
  };

  recognition.onend = () => btn.classList.remove('listening');
  recognition.start();
}

function parseVoiceInput(text) {
  // Try to extract amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  // Clean description (remove numbers)
  const desc = text.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

  if (amount) {
    document.getElementById('expenseDesc').value = desc || 'Gasto por voz';
    document.getElementById('expenseAmount').value = amount;
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    openExpenseForm();
    document.getElementById('expenseDesc').value = desc || 'Gasto por voz';
    document.getElementById('expenseAmount').value = amount;
    showToast(`Detectado: "${desc}" - ${formatCurrency(amount)}`);
  } else {
    showToast(`Escuché: "${text}". No detecté un monto.`);
  }
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
  document.getElementById('cardFilter').addEventListener('change', (e) => {
    const cardId = e.target.value;
    const total = getCycleTotal(cardId);
    document.getElementById('totalCiclo').textContent = formatCurrency(total);
  });

  // Expense Form
  document.getElementById('expenseForm').addEventListener('submit', saveExpense);
  document.getElementById('btnCancelExpense').addEventListener('click', () => navigateTo('home'));

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
