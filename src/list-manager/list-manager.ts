import { ListManagerController } from './ListManagerController.js';

function localizePage(): void {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const message = (element as HTMLElement).dataset.i18n!;
    const localizedText = chrome.i18n.getMessage(message);
    if (localizedText) {
      if ((element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') && (element as HTMLInputElement).hasAttribute('placeholder')) {
        (element as HTMLInputElement).placeholder = localizedText;
      } else {
        element.textContent = localizedText;
      }
    }
  });

  const titleElements = document.querySelectorAll('[data-i18n-title]');
  titleElements.forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    if (key) {
      const translation = chrome.i18n.getMessage(key);
      if (translation) {
        element.setAttribute('title', translation);
      }
    }
  });
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
  document.documentElement.classList.add('light');
} else {
  document.documentElement.classList.add('dark');
}

document.addEventListener('DOMContentLoaded', async () => {
  localizePage();
  const controller = new ListManagerController();
  await controller.initialize();
});
