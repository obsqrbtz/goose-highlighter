import { HighlightWord } from '../../types.js';
import { DOMUtils } from '../../utils/DOMUtils.js';

export class PopupRenderer {
  static createWordItemHTML(word: HighlightWord, realIndex: number, isSelected: boolean, listBackground: string, listForeground: string): string {
    const bgColor = word.background || listBackground;
    const fgColor = word.foreground || listForeground;
    const menuTitle = chrome.i18n.getMessage('word_actions') || 'Actions';

    return `
      <div class="word-item ${isSelected ? 'selected' : ''}" data-index="${realIndex}">
        <span class="word-item-text">${DOMUtils.escapeHtml(word.wordStr)}</span>
        <input type="text" class="word-item-edit-input" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${realIndex}" style="display: none;">
        <div class="word-item-actions">
          <button class="word-item-icon-btn edit-word-btn" data-index="${realIndex}" title="${chrome.i18n.getMessage('edit') || 'Edit'}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <input type="color" value="${bgColor}" data-bg-edit="${realIndex}" class="word-item-color-picker" title="${chrome.i18n.getMessage('background_color_title') || 'Background color'}">
          <input type="color" value="${fgColor}" data-fg-edit="${realIndex}" class="word-item-color-picker" title="${chrome.i18n.getMessage('text_color_title') || 'Text color'}">
          <label class="word-item-eye-toggle" title="${chrome.i18n.getMessage('toggle_active') || 'Toggle active'}" aria-label="${chrome.i18n.getMessage('toggle_active') || 'Toggle active'}">
            <input type="checkbox" class="word-item-eye-input" ${word.active !== false ? 'checked' : ''} data-index="${realIndex}">
            <span class="word-item-eye-icon">
              <i class="fa-solid fa-eye eye-active"></i>
              <i class="fa-solid fa-eye-slash eye-disabled"></i>
            </span>
          </label>
          <button type="button" class="word-item-icon-btn word-item-menu-btn" data-index="${realIndex}" title="${DOMUtils.escapeHtml(menuTitle)}" aria-label="${DOMUtils.escapeHtml(menuTitle)}">
            <i class="fa-solid fa-ellipsis-v"></i>
          </button>
        </div>
      </div>
    `;
  }

  static createPageHighlightItemHTML(highlight: PageHighlight, currentIndex: number): string {
    return `
      <div class="page-highlight-item" data-word="${DOMUtils.escapeHtml(highlight.word)}" style="border-left-color: ${highlight.background}; --item-tint: ${highlight.background};">
        <div class="page-highlight-word">
          <span class="page-highlight-preview">
            <span class="preview-dot" style="background-color: ${highlight.background};"></span>
            ${DOMUtils.escapeHtml(highlight.word)}
          </span>
          ${highlight.count > 1 ? `<span class="page-highlight-position">${currentIndex + 1}/${highlight.count}</span>` : ''}
        </div>
        ${highlight.count > 1 ? `
          <div class="page-highlight-nav">
            <button class="highlight-prev" title="${chrome.i18n.getMessage('previous') || 'Previous'}">
              <i class="fa-solid fa-chevron-up"></i>
            </button>
            <button class="highlight-next" title="${chrome.i18n.getMessage('next') || 'Next'}">
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  static createExceptionItemHTML(domain: string): string {
    return `
      <div class="exception-item">
        <span class="exception-domain-icon"><i class="fa-solid fa-at"></i></span>
        <span class="exception-domain">${DOMUtils.escapeHtml(domain)}</span>
        <button type="button" class="exception-remove" data-domain="${DOMUtils.escapeHtml(domain)}" title="${DOMUtils.escapeHtml(chrome.i18n.getMessage('remove') || 'Remove')}" aria-label="${DOMUtils.escapeHtml(chrome.i18n.getMessage('remove') || 'Remove')}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
  }

  static createPaginationHTML(currentPage: number, totalPages: number, totalWords: number, pageSize: number): string {
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalWords);

    const showingText = chrome.i18n.getMessage('showing_items')
      ?.replace('{start}', String(startItem))
      .replace('{end}', String(endItem))
      .replace('{total}', String(totalWords))
      || `Showing ${startItem}-${endItem} of ${totalWords} words`;

    const pageInfoText = chrome.i18n.getMessage('page_info')
      ?.replace('{current}', String(currentPage))
      .replace('{total}', String(totalPages))
      || `Page ${currentPage} of ${totalPages}`;

    const firstPageTitle = chrome.i18n.getMessage('first_page') || 'First page';
    const prevPageTitle = chrome.i18n.getMessage('previous_page') || 'Previous page';
    const nextPageTitle = chrome.i18n.getMessage('next_page') || 'Next page';
    const lastPageTitle = chrome.i18n.getMessage('last_page') || 'Last page';

    return `
      <div class="pagination-info">
        ${showingText}
      </div>
      <div class="pagination-controls">
        <button class="pagination-btn" id="firstPageBtn" ${currentPage === 1 ? 'disabled' : ''} title="${firstPageTitle}">
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button class="pagination-btn" id="prevPageBtn" ${currentPage === 1 ? 'disabled' : ''} title="${prevPageTitle}">
          <i class="fa-solid fa-angle-left"></i>
        </button>
        <div class="pagination-pages">
          <span class="page-info">${pageInfoText}</span>
        </div>
        <button class="pagination-btn" id="nextPageBtn" ${currentPage === totalPages ? 'disabled' : ''} title="${nextPageTitle}">
          <i class="fa-solid fa-angle-right"></i>
        </button>
        <button class="pagination-btn" id="lastPageBtn" ${currentPage === totalPages ? 'disabled' : ''} title="${lastPageTitle}">
          <i class="fa-solid fa-angles-right"></i>
        </button>
      </div>
    `;
  }

  static translateTitles(): void {
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      if (key) {
        const translation = chrome.i18n.getMessage(key);
        if (translation) {
          element.setAttribute('title', translation);
        }
      }
    });
  }

  static hideLoadingOverlay(): void {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 200);
    }
  }
}

export interface PageHighlight {
  word: string;
  count: number;
  background: string;
  foreground: string;
  listId?: number;
  listName?: string;
  listNames: string[];
}
