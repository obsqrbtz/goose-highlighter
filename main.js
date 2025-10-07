let currentLists = [];
let isGlobalHighlightEnabled = true;
let exceptionsList = [];
let isCurrentSiteException = false;
let matchCase = false;
let matchWhole = false;
let styleSheet = null;
let wordStyleMap = new Map();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCurrentSiteInExceptions() {
  const currentHostname = window.location.hostname;
  return exceptionsList.includes(currentHostname);
}

function initializeStyleSheet() {
  if (!styleSheet) {
    const style = document.createElement('style');
    style.id = 'goose-highlighter-styles';
    document.head.appendChild(style);
    styleSheet = style.sheet;
  }
}

function updateWordStyles(activeWords) {
  initializeStyleSheet();
  
  while (styleSheet.cssRules.length > 0) {
    styleSheet.deleteRule(0);
  }
  
  wordStyleMap.clear();
  const uniqueStyles = new Map();
  
  for (const word of activeWords) {
    const styleKey = `${word.background}-${word.foreground}`;
    if (!uniqueStyles.has(styleKey)) {
      const className = `highlighted-word-${uniqueStyles.size}`;
      uniqueStyles.set(styleKey, className);
      
      const rule = `.${className} { background: ${word.background}; color: ${word.foreground}; padding: 0 2px; }`;
      styleSheet.insertRule(rule, styleSheet.cssRules.length);
    }
    
    const lookup = matchCase ? word.text : word.text.toLowerCase();
    wordStyleMap.set(lookup, uniqueStyles.get(styleKey));
  }
}

function clearHighlights() {
  const highlightedElements = document.querySelectorAll('[data-gh]');
  for (const element of highlightedElements) {
    const parent = element.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(element.textContent), element);
      parent.normalize();
    }
  }
}


function processNodes() {
  observer.disconnect();
  clearHighlights();

  if (!isGlobalHighlightEnabled || isCurrentSiteException) {
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
      if (node.parentNode && node.parentNode.hasAttribute('data-gh')) return NodeFilter.FILTER_REJECT;
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
  updateWordStyles(activeWords);
  
  const wordMap = new Map();
  for (const word of activeWords) {
    wordMap.set(matchCase ? word.text : word.text.toLowerCase(), word);
  }

  let flags = matchCase ? 'gu' : 'giu';
  let wordsPattern = Array.from(wordMap.keys()).map(escapeRegex).join('|');
  
  if (matchWhole) {
    wordsPattern = `(?:(?<!\\p{L})|^)(${wordsPattern})(?:(?!\\p{L})|$)`;
  }
  
  try {
    const pattern = new RegExp(`(${wordsPattern})`, flags);

    for (const node of textNodes) {
      if (!node.nodeValue || !pattern.test(node.nodeValue)) continue;

      const span = document.createElement('span');
      span.innerHTML = node.nodeValue.replace(pattern, match => {
        const lookup = matchCase ? match : match.toLowerCase();
        const className = wordStyleMap.get(lookup) || 'highlighted-word-0';
        return `<span data-gh class="${className}">${match}</span>`;
      });

      node.parentNode.replaceChild(span, node);
    }
  } catch (e) {
    console.error('Regex error:', e);
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

function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this, args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Initial highlight on load
chrome.storage.local.get(['lists', 'globalHighlightEnabled', 'matchCaseEnabled', 'matchWholeEnabled', 'exceptionsList'], ({ lists, globalHighlightEnabled, matchCaseEnabled, matchWholeEnabled, exceptionsList: exceptions }) => {
  if (Array.isArray(lists)) setListsAndUpdate(lists);
  if (globalHighlightEnabled !== undefined) {
    isGlobalHighlightEnabled = globalHighlightEnabled;
  }
  matchCase = !!matchCaseEnabled;
  matchWhole = !!matchWholeEnabled;
  exceptionsList = Array.isArray(exceptions) ? exceptions : [];
  isCurrentSiteException = isCurrentSiteInExceptions();
  processNodes();
});

// Listen for updates from the popup and re-apply highlights
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'WORD_LIST_UPDATED') {
    chrome.storage.local.get('lists', ({ lists }) => {
      if (Array.isArray(lists)) setListsAndUpdate(lists);
    });
  } else if (message.type === 'GLOBAL_TOGGLE_UPDATED') {
    isGlobalHighlightEnabled = message.enabled;
    processNodes();
  } else if (message.type === 'MATCH_OPTIONS_UPDATED') {
    matchCase = !!message.matchCase;
    matchWhole = !!message.matchWhole;
    processNodes();
  } else if (message.type === 'EXCEPTIONS_LIST_UPDATED') {
    chrome.storage.local.get('exceptionsList', ({ exceptionsList: exceptions }) => {
      exceptionsList = Array.isArray(exceptions) ? exceptions : [];
      isCurrentSiteException = isCurrentSiteInExceptions();
      processNodes();
    });
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
