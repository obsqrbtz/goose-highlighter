import { PopupController } from './PopupController.js';

function localizePage(): void {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const message = (element as HTMLElement).dataset.i18n!;
    const localizedText = chrome.i18n.getMessage(message);
    if (localizedText) {
      if (element.tagName === 'INPUT' && (element as HTMLInputElement).hasAttribute('placeholder')) {
        (element as HTMLInputElement).placeholder = localizedText;
      } else {
        element.textContent = localizedText;
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
});