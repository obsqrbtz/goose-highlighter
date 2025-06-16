const listSelect = document.getElementById("listSelect");
const listName = document.getElementById("listName");
const listBg = document.getElementById("listBg");
const listFg = document.getElementById("listFg");
const listActive = document.getElementById("listActive");
const bulkPaste = document.getElementById("bulkPaste");
const wordList = document.getElementById("wordList");
const importInput = document.getElementById("importInput");

let lists = [];
let currentListIndex = 0;

async function save() {
  await chrome.storage.local.set({ lists });
  renderLists();
  renderWords();
}

async function load() {
  const res = await chrome.storage.local.get("lists");
  lists = res.lists || [];
  if (!lists.length) {
    lists.push({
      id: Date.now(),
      name: chrome.i18n.getMessage("default_list_name"),
      background: "#ffff00",
      foreground: "#000000",
      active: true,
      words: []
    });
  }
  renderLists();
  renderWords();
}

function renderLists() {
  listSelect.innerHTML = lists.map((list, index) => `<option value="${index}">${list.name}</option>`).join("");
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
  wordList.innerHTML = ""; // Clear first

  list.words.forEach((w, i) => {
    const container = document.createElement("div");

    const cbSelect = document.createElement("input");
    cbSelect.type = "checkbox";
    cbSelect.dataset.index = i;

    const inputWord = document.createElement("input");
    inputWord.type = "text";
    inputWord.value = w.wordStr;
    inputWord.dataset.wordEdit = i;

    const inputBg = document.createElement("input");
    inputBg.type = "color";
    inputBg.value = w.background || list.background;
    inputBg.dataset.bgEdit = i;

    const inputFg = document.createElement("input");
    inputFg.type = "color";
    inputFg.value = w.foreground || list.foreground;
    inputFg.dataset.fgEdit = i;

    const labelActive = document.createElement("label");
    const cbActive = document.createElement("input");
    cbActive.type = "checkbox";
    if (w.active) cbActive.checked = true;
    cbActive.dataset.activeEdit = i;
    labelActive.appendChild(cbActive);
    labelActive.appendChild(document.createTextNode(" " + chrome.i18n.getMessage("word_active_label")));

    container.appendChild(cbSelect);
    container.appendChild(inputWord);
    container.appendChild(inputBg);
    container.appendChild(inputFg);
    container.appendChild(labelActive);

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue('--input-bg').trim();
    const fg = styles.getPropertyValue('--text-color').trim();
    const border = styles.getPropertyValue('--input-border').trim();

    inputWord.style.backgroundColor = bg;
    inputWord.style.color = fg;
    inputWord.style.border = `1px solid ${border}`;

    wordList.appendChild(container);
  });
}

listSelect.onchange = () => {
  currentListIndex = +listSelect.value;
  renderWords();
  updateListForm();
};

document.getElementById("newListBtn").onclick = () => {
  lists.push({
    id: Date.now(),
    name: chrome.i18n.getMessage("new_list_name"),
    background: "#ffff00",
    foreground: "#000000",
    active: true,
    words: []
  });
  currentListIndex = lists.length - 1;
  save();
};

document.getElementById("deleteListBtn").onclick = () => {
  if (confirm(chrome.i18n.getMessage("confirm_delete_list"))) {
    lists.splice(currentListIndex, 1);
    currentListIndex = Math.max(0, currentListIndex - 1);
    save();
  }
};

listName.oninput = () => { lists[currentListIndex].name = listName.value; save(); };
listBg.oninput = () => { lists[currentListIndex].background = listBg.value; save(); };
listFg.oninput = () => { lists[currentListIndex].foreground = listFg.value; save(); };
listActive.onchange = () => { lists[currentListIndex].active = listActive.checked; save(); };

document.getElementById("addWordsBtn").onclick = () => {
  const words = bulkPaste.value.split(/\n+/).map(w => w.trim()).filter(Boolean);
  const list = lists[currentListIndex];
  for (const w of words) list.words.push({ wordStr: w, background: "", foreground: "", active: true });
  bulkPaste.value = "";
  save();
};

document.getElementById("selectAllBtn").onclick = () => {
  wordList.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = true);
};

document.getElementById("deleteSelectedBtn").onclick = () => {
  if (confirm(chrome.i18n.getMessage("confirm_delete_words"))) {
    const list = lists[currentListIndex];
    const toDelete = [...wordList.querySelectorAll("input[type=checkbox]:checked")].map(cb => +cb.dataset.index);
    lists[currentListIndex].words = list.words.filter((_, i) => !toDelete.includes(i));
    save();
  }
};

document.getElementById("disableSelectedBtn").onclick = () => {
  const list = lists[currentListIndex];
  wordList.querySelectorAll("input[type=checkbox]:checked").forEach(cb => list.words[+cb.dataset.index].active = false);
  save();
};

document.getElementById("enableSelectedBtn").onclick = () => {
  const list = lists[currentListIndex];
  wordList.querySelectorAll("input[type=checkbox]:checked").forEach(cb => list.words[+cb.dataset.index].active = true);
  save();
};

wordList.addEventListener("input", e => {
  const index = e.target.dataset.wordEdit ?? e.target.dataset.bgEdit ?? e.target.dataset.fgEdit;
  if (e.target.dataset.wordEdit != null) lists[currentListIndex].words[index].wordStr = e.target.value;
  if (e.target.dataset.bgEdit != null) lists[currentListIndex].words[index].background = e.target.value;
  if (e.target.dataset.fgEdit != null) lists[currentListIndex].words[index].foreground = e.target.value;
  save();
});

wordList.addEventListener("change", e => {
  if (e.target.dataset.activeEdit != null) {
    lists[currentListIndex].words[e.target.dataset.activeEdit].active = e.target.checked;
    save();
  }
});


const exportBtn = document.getElementById("exportBtn");
exportBtn.onclick = () => {
  const blob = new Blob([JSON.stringify(lists, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "highlight-lists.json";
  a.click();
  URL.revokeObjectURL(url);
};

const importBtn = document.getElementById("importBtn");
importBtn.onclick = () => importInput.click();

importInput.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) {
        lists = data;
        currentListIndex = 0;
        save();
      }
    } catch (err) {
      alert(chrome.i18n.getMessage("invalid_json_error"));
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

document.addEventListener('DOMContentLoaded', localizePage);

const toggle = document.getElementById('themeToggle');
const body = document.body;

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
  body.classList.add('dark');
  toggle.checked = true;
}

toggle.addEventListener('change', () => {
  if (toggle.checked) {
    body.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    body.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
});

load();