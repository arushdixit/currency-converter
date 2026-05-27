import './style.css';
import { getCurrencyInfo, CURRENCY_MAP } from './currencyData.js';

// ==========================================================================
// 1. Hardcoded Modern Offline Fallback Rates (Base: USD)
// ==========================================================================
const OFFLINE_FALLBACK_RATES = {
  USD: 1.0,
  AED: 3.6725,
  INR: 83.35,
  EUR: 0.9220,
  JPY: 156.80,
  GBP: 0.7850,
  AUD: 1.5050,
  CAD: 1.3650,
  CHF: 0.9080,
  CNY: 7.2450,
  SGD: 1.3480
};

// ==========================================================================
// 2. Application State
// ==========================================================================
const state = {
  // Ordered currency list (5 rows). AED, INR, USD, EUR, JPY by default
  currencies: ['AED', 'INR', 'USD', 'EUR', 'JPY'],

  // Loaded exchange rates relative to USD base
  rates: { ...OFFLINE_FALLBACK_RATES },

  // Row currently being focused (index 0 to 4)
  activeRowIndex: 0,

  // Precise string accumulator representing exactly what the user typed in the active row
  inputValueAccumulator: '100', // Start with 100 on startup to look alive

  // Target row index when swapping a currency from the picker modal
  modalTargetRowIndex: null,

  // Timestamp of the last successful rates sync
  lastFetched: null
};

// ==========================================================================
// 3. DOM Cache Elements
// ==========================================================================
let refreshBtn, lastUpdatedText, keypadGrid;
let currencyModal, closeModalBtn, currencySearch, clearSearchBtn, currencyList;

function cacheDomElements() {
  refreshBtn = document.getElementById('refreshBtn');
  lastUpdatedText = document.getElementById('lastUpdatedText');
  keypadGrid = document.querySelector('.keypad-grid');

  currencyModal = document.getElementById('currencyModal');
  closeModalBtn = document.getElementById('closeModalBtn');
  currencySearch = document.getElementById('currencySearch');
  clearSearchBtn = document.getElementById('clearSearchBtn');
  currencyList = document.getElementById('currencyList');
}

// ==========================================================================
// 4. Rate Sync & Caching Engine
// ==========================================================================

// Fetches rates in the background, updates local cache, and triggers conversions
async function fetchLatestRates(isManual = false) {
  if (refreshBtn) refreshBtn.classList.add('loading');
  if (lastUpdatedText && !isManual) lastUpdatedText.textContent = 'Syncing rates...';

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('API network response failed');

    const data = await response.json();
    if (data && data.result === 'success' && data.rates) {
      state.rates = data.rates;
      state.lastFetched = Date.now();

      // Save to localStorage
      localStorage.setItem('converter_rates', JSON.stringify(state.rates));
      localStorage.setItem('converter_last_fetched', state.lastFetched.toString());

      updateTimestampUI(true);
      recalculateAllFromActive();
    } else {
      throw new Error('API returned invalid rates format');
    }
  } catch (error) {
    console.error('Failed to sync rates:', error);
    if (lastUpdatedText) {
      lastUpdatedText.textContent = state.lastFetched
        ? `Offline. Cached ${getRelativeTimeString(state.lastFetched)}`
        : 'Offline. Using fallback rates';
    }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('loading');
  }
}

// Loads state from localStorage on startup
function loadStoredData() {
  try {
    // 1. Currencies array
    const storedCurrencies = localStorage.getItem('converter_active_currencies');
    if (storedCurrencies) {
      state.currencies = JSON.parse(storedCurrencies);
    }

    // 2. Active Focused Row Index
    const storedActiveRow = localStorage.getItem('converter_active_row');
    if (storedActiveRow !== null) {
      state.activeRowIndex = parseInt(storedActiveRow, 10);
    }

    // 3. Last typed input accumulator
    const storedAccumulator = localStorage.getItem('converter_accumulator');
    if (storedAccumulator !== null) {
      state.inputValueAccumulator = storedAccumulator;
    }

    // 4. Rates cache
    const storedRates = localStorage.getItem('converter_rates');
    const storedTimestamp = localStorage.getItem('converter_last_fetched');
    if (storedRates && storedTimestamp) {
      state.rates = JSON.parse(storedRates);
      state.lastFetched = parseInt(storedTimestamp, 10);
    }
  } catch (e) {
    console.error('Failed to parse localStorage data:', e);
  }
}

// Saves transient states to localStorage
function saveStateToStorage() {
  localStorage.setItem('converter_active_currencies', JSON.stringify(state.currencies));
  localStorage.setItem('converter_active_row', state.activeRowIndex.toString());
  localStorage.setItem('converter_accumulator', state.inputValueAccumulator);
}

// Formatting date timestamp
function getRelativeTimeString(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function updateTimestampUI(justUpdated = false) {
  if (!lastUpdatedText) return;

  if (justUpdated) {
    lastUpdatedText.textContent = 'Synced!';
    lastUpdatedText.classList.add('highlight-success');

    // Remove the success highlight pill styling after 3 seconds
    setTimeout(() => {
      lastUpdatedText.classList.remove('highlight-success');
      if (state.lastFetched) {
        lastUpdatedText.textContent = `Synced ${getRelativeTimeString(state.lastFetched)}`;
      }
    }, 3000);
  } else if (state.lastFetched) {
    lastUpdatedText.textContent = `Synced ${getRelativeTimeString(state.lastFetched)}`;
  } else {
    lastUpdatedText.textContent = 'Using backup rates';
  }
}

// Auto-updates relative timestamps periodically
setInterval(() => {
  if (!lastUpdatedText?.classList.contains('highlight-success')) {
    updateTimestampUI();
  }
}, 30000);


// ==========================================================================
// 5. Recalculation & Formatter Engine
// ==========================================================================

// Main float mathematical calculation
function recalculateAllFromActive() {
  const activeCode = state.currencies.at(state.activeRowIndex);
  const activeRate = Reflect.get(state.rates, activeCode);

  // Formatters
  const thousandFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  // Strip commas for calculations
  const rawNumString = state.inputValueAccumulator.replace(/,/g, '');
  const numericVal = parseFloat(rawNumString);

  const hasValue = !isNaN(numericVal);

  state.currencies.forEach((code, index) => {
    const inputElement = document.getElementById(`input-${index}`);
    if (!inputElement) return;

    // For the active typing row, preserve the exact characters typed (including trailing dots, e.g. "12.")
    if (index === state.activeRowIndex) {
      inputElement.value = state.inputValueAccumulator;
      toggleClearBtnVisibility(index, state.inputValueAccumulator.length > 0);
      return;
    }

    // For non-active rows, compute the conversion
    if (!hasValue) {
      inputElement.value = '';
      toggleClearBtnVisibility(index, false);
      return;
    }

    const targetRate = Reflect.get(state.rates, code);
    if (!activeRate || !targetRate) {
      inputElement.value = 'Error';
      return;
    }

    // Conversion Formula: (Amount / Source Rate) * Target Rate
    const convertedAmount = (numericVal / activeRate) * targetRate;

    // Premium formatted string (with commas and decimal places)
    inputElement.value = thousandFormatter.format(convertedAmount);
    toggleClearBtnVisibility(index, true);
  });
}

function toggleClearBtnVisibility(index, visible) {
  const row = document.getElementById(`row-${index}`);
  const btn = row?.querySelector('.clear-input-btn');
  if (btn) {
    if (visible) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }
}

// ==========================================================================
// 6. Interactive Input & Custom Keypad Handlers
// ==========================================================================

function handleKeyInput(char) {
  let currentStr = state.inputValueAccumulator.replace(/,/g, ''); // strip any potential commas

  if (char === 'backspace') {
    if (currentStr.length > 0) {
      currentStr = currentStr.slice(0, -1);
    }
  } else if (char === 'clear') {
    currentStr = '';
  } else if (char === '.') {
    if (!currentStr.includes('.')) {
      currentStr = currentStr === '' ? '0.' : currentStr + '.';
    }
  } else {
    // Digits '0'-'9'
    // Prevent typing excessive numbers to protect layout grids
    if (currentStr.length >= 12) return;

    if (currentStr === '0' && char !== '0') {
      currentStr = char; // Replace leading single zero
    } else if (currentStr === '' && char === '0') {
      currentStr = '0'; // Only allow single leading zero
    } else if (currentStr !== '0' || char !== '0') {
      currentStr += char;
    }
  }

  state.inputValueAccumulator = currentStr;
  saveStateToStorage();
  recalculateAllFromActive();
}

function setActiveRow(index) {
  if (state.activeRowIndex === index) {
    // Already active, just make sure focus/cursor is correct
    document.getElementById(`input-${index}`)?.focus();
    return;
  }

  // Update classes
  document.querySelectorAll('.currency-row').forEach((row, i) => {
    if (i === index) {
      row.classList.add('active');
    } else {
      row.classList.remove('active');
    }
  });

  state.activeRowIndex = index;

  // Extract the raw amount without formatting commas to serve as the new keypad accumulator base
  const inputElement = document.getElementById(`input-${index}`);
  if (inputElement) {
    const rawVal = inputElement.value.replace(/,/g, '');

    // If the input value is just 0 or empty, clear accumulator to give a clean typing canvas
    if (rawVal === '0.00' || rawVal === '0' || rawVal === '') {
      state.inputValueAccumulator = '';
    } else {
      state.inputValueAccumulator = rawVal;
    }

    inputElement.focus();
  }

  saveStateToStorage();
  recalculateAllFromActive();
}

// Intercepts physical keyboard inputs on desktops for cohesive typing controls
function handleDesktopKeyboard(event) {
  // If search picker input is focused, let it process naturally
  if (document.activeElement === currencySearch) return;

  const key = event.key;

  if (key >= '0' && key <= '9') {
    event.preventDefault();
    handleKeyInput(key);
  } else if (key === '.') {
    event.preventDefault();
    handleKeyInput('.');
  } else if (key === 'Backspace') {
    event.preventDefault();
    handleKeyInput('backspace');
  } else if (key === 'Escape' || key === 'Delete') {
    event.preventDefault();
    handleKeyInput('clear');
  } else if (key === 'ArrowUp') {
    event.preventDefault();
    const prev = (state.activeRowIndex - 1 + 5) % 5;
    setActiveRow(prev);
  } else if (key === 'ArrowDown') {
    event.preventDefault();
    const next = (state.activeRowIndex + 1) % 5;
    setActiveRow(next);
  }
}


// ==========================================================================
// 7. Search Picker Dialog & Flag Resolutions
// ==========================================================================

function renderRowsMetadata() {
  state.currencies.forEach((code, index) => {
    const info = getCurrencyInfo(code);
    const row = document.getElementById(`row-${index}`);
    if (!row) return;

    // Update labels and flag image inside button
    const codeSpan = row.querySelector('.currency-code');
    const flagImg = row.querySelector('.currency-flag');

    if (codeSpan) codeSpan.textContent = info.code;
    if (flagImg) {
      flagImg.src = info.flagUrl;
      flagImg.alt = `${info.name} flag`;
    }

    // Setup selector click trigger
    const selectorBtn = row.querySelector('.currency-selector');
    if (selectorBtn) {
      selectorBtn.onclick = (e) => {
        e.stopPropagation();
        openCurrencyPicker(index);
      };
    }
  });
}

function openCurrencyPicker(rowIndex) {
  state.modalTargetRowIndex = rowIndex;
  if (currencySearch) currencySearch.value = '';
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';

  renderModalList('');

  if (currencyModal) {
    currencyModal.showModal();
    // Tiny delay to auto-focus search bar for rapid typing
    setTimeout(() => currencySearch?.focus(), 50);
  }
}

// Render search results scroll list
function renderModalList(filterQueryText = '') {
  if (!currencyList) return;
  currencyList.innerHTML = '';

  const query = filterQueryText.toLowerCase().trim();
  const allCodes = Object.keys(CURRENCY_MAP);

  let matches = allCodes.filter(code => {
    const details = Reflect.get(CURRENCY_MAP, code);
    return code.toLowerCase().includes(query) || details.name.toLowerCase().includes(query);
  });

  if (matches.length === 0) {
    const noResultsDiv = document.createElement('div');
    noResultsDiv.className = 'no-results';

    // Static HTML for the search error icon is safe since no variables are interpolated
    noResultsDiv.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    `;

    const messageSpan = document.createElement('span');
    messageSpan.textContent = `No currencies match "${filterQueryText}"`;
    noResultsDiv.appendChild(messageSpan);

    currencyList.appendChild(noResultsDiv);
    return;
  }

  // Fragment for optimized bulk DOM injection
  const fragment = document.createDocumentFragment();

  matches.forEach(code => {
    const info = getCurrencyInfo(code);
    const itemBtn = document.createElement('button');
    itemBtn.className = 'currency-item';
    itemBtn.type = 'button';
    itemBtn.role = 'option';

    // Highlight if this currency is currently active in the selected row
    const currentCodeInRow = state.currencies.at(state.modalTargetRowIndex);
    if (code === currentCodeInRow) {
      itemBtn.classList.add('active-choice');
    }

    // Build DOM structure dynamically and safely
    const flagImg = document.createElement('img');
    flagImg.className = 'item-flag';
    flagImg.src = info.flagUrl;
    flagImg.alt = `${info.name} flag`;
    flagImg.loading = 'lazy';

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'item-details';

    const codeSpan = document.createElement('span');
    codeSpan.className = 'item-code';
    codeSpan.textContent = info.code;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = info.name;

    detailsDiv.appendChild(codeSpan);
    detailsDiv.appendChild(nameSpan);

    itemBtn.appendChild(flagImg);
    itemBtn.appendChild(detailsDiv);

    itemBtn.onclick = () => selectCurrency(code);
    fragment.appendChild(itemBtn);
  });

  currencyList.appendChild(fragment);
}

function selectCurrency(code) {
  if (state.modalTargetRowIndex === null) return;

  // Swap the target row currency safely
  Reflect.set(state.currencies, state.modalTargetRowIndex, code);
  saveStateToStorage();

  renderRowsMetadata();
  recalculateAllFromActive();

  if (currencyModal) currencyModal.close();

  // Programmatic return of active input focus
  document.getElementById(`input-${state.modalTargetRowIndex}`)?.focus();
}

// Binds native dialog light-dismiss event triggers for older platforms
function setupModalLightDismissFallback() {
  if (!currencyModal) return;

  // Fallback for browsers that do not support <dialog closedby="any"> natively
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    currencyModal.addEventListener('click', (event) => {
      // If clicking the backdrop, event target matches the dialog element
      if (event.target !== currencyModal) return;

      const rect = currencyModal.getBoundingClientRect();
      const isInside = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );

      if (!isInside) {
        currencyModal.close();
      }
    });
  }
}

// ==========================================================================
// 8. Event Binding & Orchestration
// ==========================================================================

function bindAppEvents() {
  // Refresh button
  refreshBtn?.addEventListener('click', () => fetchLatestRates(true));

  // Rows focus listeners
  state.currencies.forEach((_, index) => {
    const row = document.getElementById(`row-${index}`);
    const input = document.getElementById(`input-${index}`);
    const clearBtn = row?.querySelector('.clear-input-btn');

    // Tap row or input to highlight focused selection
    row?.addEventListener('click', () => setActiveRow(index));
    input?.addEventListener('focus', () => setActiveRow(index));

    // In-input clear trigger
    clearBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleKeyInput('clear');
      input?.focus();
    });
  });

  // Custom Keypad bindings
  keypadGrid?.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;

    const value = target.dataset.val;
    if (value) {
      handleKeyInput(value);
    }
  });

  // Global desktop typing listeners
  document.addEventListener('keydown', handleDesktopKeyboard);

  // Search Modal bindings
  closeModalBtn?.addEventListener('click', () => currencyModal?.close());
  currencyModal?.addEventListener('close', () => {
    state.modalTargetRowIndex = null;
  });

  currencySearch?.addEventListener('input', (e) => {
    const query = e.target.value;
    if (clearSearchBtn) {
      clearSearchBtn.style.display = query.length > 0 ? 'flex' : 'none';
    }
    renderModalList(query);
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (currencySearch) {
      currencySearch.value = '';
      currencySearch.focus();
    }
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
    renderModalList('');
  });

  setupModalLightDismissFallback();
}

// ==========================================================================
// 9. Boot sequence
// ==========================================================================
let isBooted = false;

function bootApp() {
  if (isBooted) return;
  isBooted = true;

  loadStoredData();
  cacheDomElements();
  bindAppEvents();

  // Render row names & flags
  renderRowsMetadata();

  // Focus the stored/default active row on boot
  setActiveRow(state.activeRowIndex);

  // Initial UI timestamp check
  updateTimestampUI();

  // Silent background network rates sync on load
  fetchLatestRates(false);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', bootApp);
// Double check for cases where defer script loads after DOMContentLoaded
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  bootApp();
}

// Register Service Worker for PWA installation support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('Service Worker registered successfully:', reg.scope))
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}
