function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightWords(lists) {
  const processNodes = () => {
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

    for (const list of lists) {
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

    if (activeWords.length === 0) return;

    const wordMap = new Map();
    for (const word of activeWords) wordMap.set(word.text.toLowerCase(), word);

    const pattern = new RegExp(`(${Array.from(wordMap.keys()).map(escapeRegex).join('|')})`, 'gi');

    for (const node of textNodes) {
      if (!pattern.test(node.nodeValue)) continue;

      const span = document.createElement('span');
      span.innerHTML = node.nodeValue.replace(pattern, match => {
        const word = wordMap.get(match.toLowerCase()) || { background: '#ffff00', foreground: '#000000' };
        return `<mark style="background:${word.background};color:${word.foreground};padding:0 2px;">${match}</mark>`;
      });

      node.parentNode.replaceChild(span, node);
    }
  };

  const debouncedProcessNodes = debounce(processNodes, 300);

  debouncedProcessNodes();

  const observer = new MutationObserver(debouncedProcessNodes);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.addEventListener('scroll', debouncedProcessNodes);
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

chrome.storage.local.get("lists", ({ lists }) => {
  if (Array.isArray(lists)) highlightWords(lists);
});