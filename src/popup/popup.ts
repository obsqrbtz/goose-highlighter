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

document.addEventListener('DOMContentLoaded', async () => {
  localizePage();
  const controller = new PopupController();
  await controller.initialize();
});