import { PopupController } from './PopupController.js';

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
  document.documentElement.classList.add('light');
} else {
  document.documentElement.classList.add('dark');
}

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

function displayVersion(): void {
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.getElementById('version-number');
  if (versionElement && manifest.version) {
    versionElement.textContent = manifest.version;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  localizePage();
  displayVersion();
  const controller = new PopupController();
  await controller.initialize();

  const onClose = (): void => controller.captureScrollAndSave();
  window.addEventListener('blur', onClose);
  window.addEventListener('pagehide', onClose);
});
