const DB_NAME = 'NoraContable';
const DB_VERSION = 1;

class NoraDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        if (!db.objectStoreNames.contains('expenses')) {
          const store = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date');
          store.createIndex('cardId', 'cardId');
          store.createIndex('category', 'category');
        }
        
        if (!db.objectStoreNames.contains('cards')) {
          db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true });
        }
        
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // Generic helpers
  _tx(storeName, mode = 'readonly') {
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  _promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Expenses
  async addExpense(expense) {
    const store = this._tx('expenses', 'readwrite');
    return this._promisify(store.add(expense));
  }

  async updateExpense(expense) {
    const store = this._tx('expenses', 'readwrite');
    return this._promisify(store.put(expense));
  }

  async deleteExpense(id) {
    const store = this._tx('expenses', 'readwrite');
    return this._promisify(store.delete(id));
  }

  async getExpenses() {
    const store = this._tx('expenses');
    return this._promisify(store.getAll());
  }

  async getExpensesByCard(cardId) {
    const store = this._tx('expenses');
    const index = store.index('cardId');
    return this._promisify(index.getAll(cardId));
  }

  // Cards
  async addCard(card) {
    const store = this._tx('cards', 'readwrite');
    return this._promisify(store.add(card));
  }

  async updateCard(card) {
    const store = this._tx('cards', 'readwrite');
    return this._promisify(store.put(card));
  }

  async deleteCard(id) {
    const store = this._tx('cards', 'readwrite');
    return this._promisify(store.delete(id));
  }

  async getCards() {
    const store = this._tx('cards');
    return this._promisify(store.getAll());
  }

  // Settings
  async getSetting(key) {
    const store = this._tx('settings');
    const result = await this._promisify(store.get(key));
    return result ? result.value : null;
  }

  async setSetting(key, value) {
    const store = this._tx('settings', 'readwrite');
    return this._promisify(store.put({ key, value }));
  }

  // Export/Import
  async exportAll() {
    const expenses = await this.getExpenses();
    const cards = await this.getCards();
    const cutoffDay = await this.getSetting('cutoffDay');
    return { expenses, cards, cutoffDay, exportDate: new Date().toISOString() };
  }

  async importAll(data) {
    const tx = this.db.transaction(['expenses', 'cards', 'settings'], 'readwrite');
    const expStore = tx.objectStore('expenses');
    const cardStore = tx.objectStore('cards');
    const setStore = tx.objectStore('settings');

    // Clear existing
    expStore.clear();
    cardStore.clear();

    // Import expenses
    for (const exp of data.expenses || []) {
      const { id, ...rest } = exp;
      expStore.add(rest);
    }

    // Import cards
    for (const card of data.cards || []) {
      const { id, ...rest } = card;
      cardStore.add(rest);
    }

    // Import settings
    if (data.cutoffDay) {
      setStore.put({ key: 'cutoffDay', value: data.cutoffDay });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll() {
    const tx = this.db.transaction(['expenses', 'cards', 'settings'], 'readwrite');
    tx.objectStore('expenses').clear();
    tx.objectStore('cards').clear();
    tx.objectStore('settings').clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}

const db = new NoraDB();
