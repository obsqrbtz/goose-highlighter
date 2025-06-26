let currentLists = [];
let isGlobalHighlightEnabled = true;
let matchCase = false;
let matchWhole = false;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clearHighlights() {
  // Remove all <mark> elements added by the highlighter
  const marks = document.querySelectorAll('mark[data-gh]');
  for (const mark of marks) {
    // Replace the <mark> with its text content
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize(); // Merge adjacent text nodes
    }
  }
}


function processNodes() {
  observer.disconnect();
  clearHighlights();

  // If global highlighting is disabled, skip processing
  if (!isGlobalHighlightEnabled) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    return;
  }

  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (node.parentNode && node.parentNode.nodeName === 'MARK') return NodeFilter.FILTER_REJECT;
      if (node.parentNode && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.parentNode.nodeName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const activeWords = [];
  for (const list of currentLists) {
    if (!list.active) continue;
    for (const word of list.words) {
      if (!word.active) continue;
      activeWords.push({
        text: word.wordStr,
        background: word.background || list.background,
        foreground: word.foreground || list.foreground
      });
    }
  }

  if (activeWords.length > 0) {
    const wordMap = new Map();
    for (const word of activeWords) wordMap.set(word.text.toLowerCase(), word);

    let flags = matchCase ? 'g' : 'gi';
    let wordsPattern = Array.from(wordMap.keys()).map(escapeRegex).join('|');
    if (matchWhole) {
      wordsPattern = `\\b(?:${wordsPattern})\\b`;
    }
    const pattern = new RegExp(`(${wordsPattern})`, flags);

    for (const node of textNodes) {
      if (!pattern.test(node.nodeValue)) continue;

      const span = document.createElement('span');
      span.innerHTML = node.nodeValue.replace(pattern, match => {
        const word = wordMap.get(match.toLowerCase()) || { background: '#ffff00', foreground: '#000000' };
        return `<mark data-gh style="background:${word.background};color:${word.foreground};padding:0 2px;">${match}</mark>`;
      });

      node.parentNode.replaceChild(span, node);
    }
  }

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

const debouncedProcessNodes = debounce(processNodes, 300);

function setListsAndUpdate(lists) {
  currentLists = lists;
  debouncedProcessNodes();
}

// Debounce helper function
function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this, args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Initial highlight on load
chrome.storage.local.get(["lists", "globalHighlightEnabled", "matchCaseEnabled", "matchWholeEnabled"], ({ lists, globalHighlightEnabled, matchCaseEnabled, matchWholeEnabled }) => {
  if (Array.isArray(lists)) setListsAndUpdate(lists);
  if (globalHighlightEnabled !== undefined) {
    isGlobalHighlightEnabled = globalHighlightEnabled;
  }
  matchCase = !!matchCaseEnabled;
  matchWhole = !!matchWholeEnabled;
  processNodes();
});

// Listen for updates from the popup and re-apply highlights
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WORD_LIST_UPDATED") {
    chrome.storage.local.get("lists", ({ lists }) => {
      if (Array.isArray(lists)) setListsAndUpdate(lists);
    });
  } else if (message.type === "GLOBAL_TOGGLE_UPDATED") {
    isGlobalHighlightEnabled = message.enabled;
    processNodes();
  } else if (message.type === "MATCH_OPTIONS_UPDATED") {
    matchCase = !!message.matchCase;
    matchWhole = !!message.matchWhole;
    processNodes();
  }
});

// Set up observer and scroll handler
const observer = new MutationObserver(debouncedProcessNodes);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

window.addEventListener('scroll', debouncedProcessNodes);
