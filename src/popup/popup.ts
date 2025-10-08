// @ts-nocheck
const listSelect = document.getElementById('listSelect');
const listName = document.getElementById('listName');
const listBg = document.getElementById('listBg');
const listFg = document.getElementById('listFg');
const listActive = document.getElementById('listActive');
const bulkPaste = document.getElementById('bulkPaste');
const wordList = document.getElementById('wordList');
const importInput = document.getElementById('importInput');
const matchCase = document.getElementById('matchCase');
const matchWhole = document.getElementById('matchWhole');
let lists = [];
let currentListIndex = 0;
let selectedCheckboxes = new Set();
let globalHighlightEnabled = true;
let wordSearchQuery = '';
let matchCaseEnabled = false;
let matchWholeEnabled = false;
let exceptionsList = [];
let currentTabHost = '';
let sectionStates = {};

function loadSectionStates() {
  const saved = localStorage.getItem('goose-highlighter-section-states');
  if (saved) {
    try {
      sectionStates = JSON.parse(saved);
    } catch {
      sectionStates = {};
    }
  }
}

function saveSectionStates() {
  localStorage.setItem('goose-highlighter-section-states', JSON.stringify(sectionStates));
}

function toggleSection(sectionName) {
  const section = document.querySelector(`[data-section="${sectionName}"]`);
  if (!section) return;
  
  const isCollapsed = section.classList.contains('collapsed');
  
  if (isCollapsed) {
    section.classList.remove('collapsed');
    sectionStates[sectionName] = false;
  } else {
    section.classList.add('collapsed');
    sectionStates[sectionName] = true;
  }
  
  saveSectionStates();
}

function initializeSectionStates() {
  loadSectionStates();
  
  // Apply saved states
  Object.keys(sectionStates).forEach(sectionName => {
    const section = document.querySelector(`[data-section="${sectionName}"]`);
    if (section && sectionStates[sectionName]) {
      section.classList.add('collapsed');
    }
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function (m) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    })[m];
  });
}

async function save() {
  await chrome.storage.local.set({
    lists: lists,
    globalHighlightEnabled: globalHighlightEnabled,
    matchCaseEnabled,
    matchWholeEnabled,
    exceptionsList
  });
  renderLists();
  renderWords();

  chrome.tabs.query({}, function (tabs) {
    for (let tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'WORD_LIST_UPDATED' });
        chrome.tabs.sendMessage(tab.id, {
          type: 'GLOBAL_TOGGLE_UPDATED',
          enabled: globalHighlightEnabled
        });
        chrome.tabs.sendMessage(tab.id, {
          type: 'MATCH_OPTIONS_UPDATED',
          matchCase: matchCaseEnabled,
          matchWhole: matchWholeEnabled
        });
        chrome.tabs.sendMessage(tab.id, { type: 'EXCEPTIONS_LIST_UPDATED' });
      }
    }
  });
}

async function updateGlobalToggleState() {
  await chrome.storage.local.set({ globalHighlightEnabled: globalHighlightEnabled });
  chrome.tabs.query({}, function (tabs) {
    for (let tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'GLOBAL_TOGGLE_UPDATED',
          enabled: globalHighlightEnabled
        });
      }
    }
  });
}

async function load() {
  const res = await chrome.storage.local.get({
    lists: [],
    globalHighlightEnabled: true,
    matchCaseEnabled: false,
    matchWholeEnabled: false,
    exceptionsList: []
  });
  lists = res.lists;
  globalHighlightEnabled = res.globalHighlightEnabled !== false;
  matchCaseEnabled = !!res.matchCaseEnabled;
  matchWholeEnabled = !!res.matchWholeEnabled;
  exceptionsList = res.exceptionsList || [];
  matchCase.checked = matchCaseEnabled;
  matchWhole.checked = matchWholeEnabled;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      currentTabHost = url.hostname;
      updateExceptionButton();
    }
  } catch (e) {
    console.warn('Could not get current tab:', e);
  }

  if (!lists.length) {
    lists.push({
      id: Date.now(),
      name: chrome.i18n.getMessage('default_list_name'),
      background: '#ffff00',
      foreground: '#000000',
      active: true,
      words: []
    });
  }
  renderLists();
  renderWords();
  renderExceptions();

  document.getElementById('globalHighlightToggle').checked = globalHighlightEnabled;
}

function renderLists() {
  listSelect.innerHTML = lists.map((list, index) =>
    `<option value="${index}">${escapeHtml(list.name)}</option>`
  ).join('');
  listSelect.value = currentListIndex;
  updateListForm();
}

function updateListForm() {
  const list = lists[currentListIndex];
  listName.value = list.name;
  listBg.value = list.background;
  listFg.value = list.foreground;
  listActive.checked = list.active;
}

function renderWords() {
  const list = lists[currentListIndex];

  let filteredWords = list.words;
  if (wordSearchQuery.trim()) {
    const q = wordSearchQuery.trim().toLowerCase();
    filteredWords = list.words.filter(w => w.wordStr.toLowerCase().includes(q));
  }

  const itemHeight = 32;
  const containerHeight = wordList.clientHeight;
  const scrollTop = wordList.scrollTop;
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(
    startIndex + Math.ceil(containerHeight / itemHeight) + 2,
    filteredWords.length
  );

  wordList.innerHTML = '';

  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  spacer.style.height = `${filteredWords.length * itemHeight}px`;
  spacer.style.width = '100%';

  for (let i = startIndex; i < endIndex; i++) {
    const w = filteredWords[i];
    if (!w) continue;
    const container = document.createElement('div');
    container.style.height = `${itemHeight}px`;
    container.style.position = 'absolute';
    container.style.top = `${i * itemHeight}px`;
    container.style.width = 'calc(100% - 8px)';
    container.style.left = '4px';
    container.style.right = '4px';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '6px';
    container.style.padding = '0 4px';
    container.style.boxSizing = 'border-box';
    container.style.background = 'var(--highlight-tag)';
    container.style.border = '1px solid var(--highlight-tag-border)';

    const realIndex = list.words.indexOf(w);

    const cbSelect = document.createElement('input');
    cbSelect.type = 'checkbox';
    cbSelect.className = 'word-checkbox';
    cbSelect.dataset.index = realIndex;
    if (selectedCheckboxes.has(realIndex)) {
      cbSelect.checked = true;
    }

    const inputWord = document.createElement('input');
    inputWord.type = 'text';
    inputWord.value = w.wordStr;
    inputWord.dataset.wordEdit = realIndex;
    inputWord.style.flexGrow = '1';
    inputWord.style.minWidth = '0';
    inputWord.style.padding = '4px 8px';
    inputWord.style.borderRadius = '4px';
    inputWord.style.border = '1px solid var(--input-border)';
    inputWord.style.backgroundColor = 'var(--input-bg)';
    inputWord.style.color = 'var(--text-color)';

    const inputBg = document.createElement('input');
    inputBg.type = 'color';
    inputBg.value = w.background || list.background;
    inputBg.dataset.bgEdit = realIndex;
    inputBg.style.width = '24px';
    inputBg.style.height = '24px';
    inputBg.style.flexShrink = '0';

    const inputFg = document.createElement('input');
    inputFg.type = 'color';
    inputFg.value = w.foreground || list.foreground;
    inputFg.dataset.fgEdit = realIndex;
    inputFg.style.width = '24px';
    inputFg.style.height = '24px';
    inputFg.style.flexShrink = '0';

    const activeContainer = document.createElement('label');
    activeContainer.className = 'word-active';
    activeContainer.style.display = 'flex';
    activeContainer.style.alignItems = 'center';
    activeContainer.style.gap = '4px';
    activeContainer.style.flexShrink = '0';

    const cbActive = document.createElement('input');
    cbActive.type = 'checkbox';
    cbActive.checked = w.active !== false;
    cbActive.dataset.activeEdit = realIndex;
    cbActive.className = 'switch';

    activeContainer.appendChild(cbActive);

    container.appendChild(cbSelect);
    container.appendChild(inputWord);
    container.appendChild(inputBg);
    container.appendChild(inputFg);
    container.appendChild(activeContainer);

    spacer.appendChild(container);
  }

  wordList.appendChild(spacer);

  const wordCount = document.getElementById('wordCount');
  if (wordCount) {
    wordCount.textContent = filteredWords.length;
  }
}

function updateExceptionButton() {
  const toggleBtn = document.getElementById('toggleExceptionBtn');
  const btnText = document.getElementById('exceptionBtnText');
  
  if (!toggleBtn || !btnText || !currentTabHost) return;
  
  const isException = exceptionsList.includes(currentTabHost);
  
  if (isException) {
    btnText.textContent = chrome.i18n.getMessage('remove_exception') || 'Remove from Exceptions';
    toggleBtn.className = 'danger';
    toggleBtn.querySelector('i').className = 'fa-solid fa-check';
  } else {
    btnText.textContent = chrome.i18n.getMessage('add_exception') || 'Add to Exceptions';
    toggleBtn.className = '';
    toggleBtn.querySelector('i').className = 'fa-solid fa-ban';
  }
}

function renderExceptions() {
  const container = document.getElementById('exceptionsList');
  if (!container) return;
  
  if (exceptionsList.length === 0) {
    container.innerHTML = '<div class="exception-item">No exceptions</div>';
    return;
  }
  
  container.innerHTML = exceptionsList.map(domain => 
    `<div class="exception-item">
      <span class="exception-domain">${escapeHtml(domain)}</span>
      <button class="exception-remove" data-domain="${escapeHtml(domain)}">${chrome.i18n.getMessage('remove')}</button>
    </div>`
  ).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  initializeSectionStates();
  localizePage();
  
  // Add event listeners for collapse toggles
  document.querySelectorAll('.collapse-toggle').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetSection = button.getAttribute('data-target');
      toggleSection(targetSection);
    });
  });
  
  // Also allow clicking section headers to toggle
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on a button or input within the header
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('button')) {
        return;
      }
      const section = header.closest('.section');
      const sectionName = section.getAttribute('data-section');
      if (sectionName) {
        toggleSection(sectionName);
      }
    });
  });

  document.getElementById('selectAllBtn').onclick = () => {
    const list = lists[currentListIndex];
    list.words.forEach((_, index) => {
      selectedCheckboxes.add(index);
    });
    renderWords();
  };

  document.getElementById('globalHighlightToggle').addEventListener('change', function () {
    globalHighlightEnabled = this.checked;
    updateGlobalToggleState();
  });

  wordList.addEventListener('change', e => {
    if (e.target.type === 'checkbox') {
      if (e.target.dataset.index != null) {
        if (e.target.checked) {
          selectedCheckboxes.add(+e.target.dataset.index);
        } else {
          selectedCheckboxes.delete(+e.target.dataset.index);
        }
        renderWords();
      } else if (e.target.dataset.activeEdit != null) {
        lists[currentListIndex].words[e.target.dataset.activeEdit].active = e.target.checked;
        save();
      }
    }
  });

  let scrollTimeout;
  wordList.addEventListener('scroll', () => {
    if (scrollTimeout) {
      return;
    }
    scrollTimeout = setTimeout(() => {
      requestAnimationFrame(renderWords);
      scrollTimeout = null;
    }, 16); // ~60fps
  });

  listSelect.onchange = () => {
    selectedCheckboxes.clear();
    currentListIndex = +listSelect.value;
    renderWords();
    updateListForm();
  };

  document.getElementById('newListBtn').onclick = () => {
    lists.push({
      id: Date.now(),
      name: chrome.i18n.getMessage('new_list_name'),
      background: '#ffff00',
      foreground: '#000000',
      active: true,
      words: []
    });
    currentListIndex = lists.length - 1;
    save();
  };

  document.getElementById('deleteListBtn').onclick = () => {
    if (confirm(chrome.i18n.getMessage('confirm_delete_list'))) {
      lists.splice(currentListIndex, 1);
      currentListIndex = Math.max(0, currentListIndex - 1);
      save();
    }
  };

  listName.oninput = () => { lists[currentListIndex].name = listName.value; save(); };
  listBg.oninput = () => { lists[currentListIndex].background = listBg.value; save(); };
  listFg.oninput = () => { lists[currentListIndex].foreground = listFg.value; save(); };
  listActive.onchange = () => { lists[currentListIndex].active = listActive.checked; save(); };

  document.getElementById('addWordsBtn').onclick = () => {
    const words = bulkPaste.value.split(/\n+/).map(w => w.trim()).filter(Boolean);
    const list = lists[currentListIndex];
    for (const w of words) list.words.push({ wordStr: w, background: '', foreground: '', active: true });
    bulkPaste.value = '';
    save();
  };

  document.getElementById('deleteSelectedBtn').onclick = () => {
    if (confirm(chrome.i18n.getMessage('confirm_delete_words'))) {
      const list = lists[currentListIndex];
      const toDelete = Array.from(selectedCheckboxes);
      lists[currentListIndex].words = list.words.filter((_, i) => !toDelete.includes(i));
      selectedCheckboxes.clear();
      save();
      renderWords();
    }
  };

  document.getElementById('disableSelectedBtn').onclick = () => {
    const list = lists[currentListIndex];
    selectedCheckboxes.forEach(index => {
      list.words[index].active = false;
    });
    save();
    renderWords();
  };

  document.getElementById('enableSelectedBtn').onclick = () => {
    const list = lists[currentListIndex];
    selectedCheckboxes.forEach(index => {
      list.words[index].active = true;
    });
    save();
    renderWords();
  };

  wordList.addEventListener('input', e => {
    const index = e.target.dataset.wordEdit ?? e.target.dataset.bgEdit ?? e.target.dataset.fgEdit;
    if (index == null) return;

    const word = lists[currentListIndex].words[index];
    if (e.target.dataset.wordEdit != null) word.wordStr = e.target.value;
    if (e.target.dataset.bgEdit != null) word.background = e.target.value;
    if (e.target.dataset.fgEdit != null) word.foreground = e.target.value;

    save();
  });

  const exportBtn = document.getElementById('exportBtn');
  exportBtn.onclick = () => {
    const exportData = {
      lists: lists,
      exceptionsList: exceptionsList
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'highlight-lists.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBtn = document.getElementById('importBtn');
  importBtn.onclick = () => importInput.click();

  importInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        
        if (Array.isArray(data)) {
          // Old format - just lists
          lists = data;
        } else if (data && typeof data === 'object') {
          // New format - object with lists and exceptions
          if (Array.isArray(data.lists)) {
            lists = data.lists;
          }
          if (Array.isArray(data.exceptionsList)) {
            exceptionsList = data.exceptionsList;
          }
        }
        
        currentListIndex = 0;
        updateExceptionButton();
        renderExceptions();
        save();
      } catch (err) {
        alert(chrome.i18n.getMessage('invalid_json_error:' + err.message));
      }
    };
    reader.readAsText(file);
  };

  function localizePage() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const message = element.dataset.i18n;
      const localizedText = chrome.i18n.getMessage(message);
      if (localizedText) {
        if (element.tagName === 'INPUT' && element.hasAttribute('placeholder')) {
          element.placeholder = localizedText;
        } else {
          element.textContent = localizedText;
        }
      }
    });
  }

  const toggle = document.getElementById('themeToggle');
  const body = document.body;

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    body.classList.remove('dark');
    body.classList.add('light');
    toggle.checked = false;
  } else {
    body.classList.add('dark');
    body.classList.remove('light');
    toggle.checked = true;
  }

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      body.classList.add('dark');
      body.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      body.classList.remove('dark');
      body.classList.add('light');
      localStorage.setItem('theme', 'light');
    }
  });

  document.getElementById('deselectAllBtn').onclick = () => {
    selectedCheckboxes.clear();
    renderWords();
  };

  const wordSearch = document.getElementById('wordSearch');
  wordSearch.addEventListener('input', (e) => {
    wordSearchQuery = e.target.value;
    renderWords();
  });

  matchCase.addEventListener('change', () => {
    matchCaseEnabled = matchCase.checked;
    save();
  });
  matchWhole.addEventListener('change', () => {
    matchWholeEnabled = matchWhole.checked;
    save();
  });

  document.getElementById('toggleExceptionBtn').addEventListener('click', () => {
    if (!currentTabHost) return;
    
    const isException = exceptionsList.includes(currentTabHost);
    
    if (isException) {
      exceptionsList = exceptionsList.filter(domain => domain !== currentTabHost);
    } else {
      exceptionsList.push(currentTabHost);
    }
    
    updateExceptionButton();
    renderExceptions();
    save();
  });

  document.getElementById('manageExceptionsBtn').addEventListener('click', () => {
    const panel = document.getElementById('exceptionsPanel');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  });

  document.getElementById('clearExceptionsBtn').addEventListener('click', () => {
    if (confirm(chrome.i18n.getMessage('confirm_clear_exceptions') || 'Clear all exceptions?')) {
      exceptionsList = [];
      updateExceptionButton();
      renderExceptions();
      save();
    }
  });

  document.getElementById('exceptionsList').addEventListener('click', (e) => {
    if (e.target.classList.contains('exception-remove')) {
      const domain = e.target.dataset.domain;
      exceptionsList = exceptionsList.filter(d => d !== domain);
      updateExceptionButton();
      renderExceptions();
      save();
    }
  });

  load();
});
