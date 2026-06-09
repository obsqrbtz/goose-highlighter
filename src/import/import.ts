import { browserAPI } from '../utils/browser.js';
import { ImportService } from '../services/ImportService.js';

// Share the popup's theme choice (same extension origin -> same localStorage).
const savedTheme = localStorage.getItem('theme');
document.documentElement.classList.add(savedTheme === 'light' ? 'light' : 'dark');

function t(key: string, fallback: string): string {
  return browserAPI.i18n.getMessage(key) || fallback;
}

function localize(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = (el as HTMLElement).dataset.i18n;
    if (!key) return;
    const msg = browserAPI.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });
}

const importType: 'list' | 'settings' =
  new URLSearchParams(location.search).get('type') === 'settings' ? 'settings' : 'list';

const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
const chooseBtn = document.getElementById('chooseFileBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;
const closeHint = document.getElementById('closeHint') as HTMLElement;

async function handleFile(file: File): Promise<void> {
  chooseBtn.hidden = true;
  statusEl.textContent = t('import_in_progress', 'Importing…');
  statusEl.className = 'status';
  try {
    const text = await file.text();
    if (importType === 'settings') {
      await ImportService.importSettingsToStorage(text);
      statusEl.textContent = t('import_complete', 'Import complete.');
    } else {
      const count = await ImportService.importListsToStorage(text);
      const tpl = browserAPI.i18n.getMessage('import_complete_lists', [String(count)]);
      statusEl.textContent = tpl || `Import complete. Added ${count} list(s).`;
    }
    statusEl.classList.add('success');
  } catch (err) {
    statusEl.textContent = `${t('import_failed', 'Import failed.')} ${(err as Error).message}`;
    statusEl.classList.add('error');
  } finally {
    closeHint.hidden = false;
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void handleFile(file);
});

chooseBtn.addEventListener('click', () => fileInput.click());

localize();
document.title = t('import_page_title', 'Import — Goose Highlighter');
statusEl.textContent =
  importType === 'settings'
    ? t('import_select_settings_prompt', 'Select a settings file to import.')
    : t('import_select_list_prompt', 'Select a list file to import.');
