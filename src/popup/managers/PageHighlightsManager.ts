import { MessageService } from '../../services/MessageService.js';
import { DOMUtils } from '../../utils/DOMUtils.js';
import { PopupRenderer, PageHighlight } from './PopupRenderer.js';

export class PageHighlightsManager {
  private static readonly MANY_LISTS_THRESHOLD = 8;

  private pageHighlights: PageHighlight[] = [];
  private pageHighlightsActiveLists: Array<{ id: number; name: string; background: string }> = [];
  private pageHighlightsCollapsedGroups = new Set<string>();
  private highlightIndices = new Map<string, number>();

  constructor(
    private getGroupByList: () => boolean,
    private setGroupByList: (value: boolean) => void,
    private getListFilter: () => Set<number>,
    private setListFilter: (value: Set<number>) => void,
    private onStateChanged: () => void
  ) {}

  setupEventListeners(): void {
    document.getElementById('pageHighlightsList')?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const groupHeader = target.closest('.page-highlights-group-header');
      if (groupHeader) {
        const section = groupHeader.closest('.page-highlights-group-section');
        const groupKey = section?.getAttribute('data-group');
        if (groupKey) {
          if (this.pageHighlightsCollapsedGroups.has(groupKey)) {
            this.pageHighlightsCollapsedGroups.delete(groupKey);
          } else {
            this.pageHighlightsCollapsedGroups.add(groupKey);
          }
          this.render();
          return;
        }
      }

      const item = target.closest('.page-highlight-item') as HTMLElement;
      if (!item) return;

      const word = item.dataset.word;
      if (!word) return;

      const button = target.closest('button');

      if (button?.classList.contains('highlight-prev')) {
        e.stopPropagation();
        await this.navigateHighlight(word, -1);
      } else if (button?.classList.contains('highlight-next')) {
        e.stopPropagation();
        await this.navigateHighlight(word, 1);
      } else if (!button) {
        const currentIndex = this.highlightIndices.get(word) || 0;
        await this.jumpToHighlight(word, currentIndex);
      }
    });

    document.getElementById('pageHighlightsGroupByList')?.addEventListener('change', (e) => {
      this.setGroupByList((e.target as HTMLInputElement).checked);
      this.onStateChanged();
      this.render();
    });
  }

  async load(): Promise<void> {
    try {
      const response = await MessageService.sendToActiveTab({ type: 'GET_PAGE_HIGHLIGHTS' });

      if (response && response.highlights) {
        this.pageHighlights = response.highlights.map((h: PageHighlight) => ({
          ...h,
          listNames: h.listNames || (h.listName ? [h.listName] : [])
        }));
        this.pageHighlightsActiveLists = response.lists || [];
        const listIdsOnPage = this.getListIdsWithMatchesOnPage();
        if (listIdsOnPage.size > 0) {
          this.setListFilter(new Set(listIdsOnPage));
        }
        this.highlightIndices.clear();
        this.pageHighlights.forEach(h => this.highlightIndices.set(h.word, 0));
        this.render();
        this.renderFilters();
      }
    } catch (e) {
      console.error('Error loading page highlights:', e);
      this.pageHighlights = [];
      this.pageHighlightsActiveLists = [];
      this.render();
      this.renderFilters();
    }
  }

  private async jumpToHighlight(word: string, index: number): Promise<void> {
    this.highlightIndices.set(word, index);
    await MessageService.sendToActiveTab({
      type: 'SCROLL_TO_HIGHLIGHT',
      word,
      index
    });
    this.render();
  }

  private async navigateHighlight(word: string, direction: number): Promise<void> {
    const highlight = this.pageHighlights.find(h => h.word === word);
    if (!highlight) return;

    const currentIndex = this.highlightIndices.get(word) || 0;
    let newIndex = currentIndex + direction;

    if (newIndex < 0) newIndex = highlight.count - 1;
    if (newIndex >= highlight.count) newIndex = 0;

    await this.jumpToHighlight(word, newIndex);
  }

  private passesListFilter(h: PageHighlight): boolean {
    const listFilter = this.getListFilter();
    if (listFilter.size === 0) return true;
    if (listFilter.has(-1)) return false;
    const wordListIds = new Set<number>();
    if (h.listId !== undefined) wordListIds.add(h.listId);
    for (const name of h.listNames) {
      const list = this.pageHighlightsActiveLists.find(l => l.name === name);
      if (list) wordListIds.add(list.id);
    }
    return [...wordListIds].some(id => listFilter.has(id));
  }

  render(): void {
    const container = document.getElementById('pageHighlightsList');
    const countElement = document.getElementById('totalHighlightsCount');

    if (!container || !countElement) return;

    const filtered = this.pageHighlights.filter(h => this.passesListFilter(h));
    const totalCount = filtered.reduce((sum, h) => sum + h.count, 0);
    countElement.textContent = totalCount.toString();

    if (filtered.length === 0) {
      container.innerHTML = `<div class="page-highlights-empty">${chrome.i18n.getMessage('no_highlights_on_page') || 'No highlights on this page'}</div>`;
      return;
    }

    const groupByList = this.getGroupByList();
    if (groupByList && this.pageHighlightsActiveLists.length > 0) {
      container.innerHTML = this.renderGrouped(filtered);
    } else {
      container.innerHTML = filtered.map(h => {
        const currentIndex = this.highlightIndices.get(h.word) || 0;
        return PopupRenderer.createPageHighlightItemHTML(h, currentIndex);
      }).join('');
    }
  }

  private renderGrouped(filtered: PageHighlight[]): string {
    const listFilter = this.getListFilter();
    const listIds = new Set(this.pageHighlightsActiveLists.map(l => l.id).filter(id => listFilter.has(id) || listFilter.size === 0));
    const groupOrder = this.pageHighlightsActiveLists.filter(l => listIds.has(l.id));
    let html = '';
    
    for (const list of groupOrder) {
      const items = filtered.filter(h => h.listId === list.id || (h.listNames && h.listNames.includes(list.name)));
      if (items.length === 0) continue;
      const groupKey = `list-${list.id}`;
      const collapsed = this.pageHighlightsCollapsedGroups.has(groupKey);
      const chevron = collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
      html += `
        <div class="page-highlights-group-section ${collapsed ? 'collapsed' : ''}" data-group="${groupKey}">
          <div class="page-highlights-group-header">
            <i class="fa-solid ${chevron}"></i>
            <span class="group-dot" style="background-color: ${list.background};"></span>
            <span>${DOMUtils.escapeHtml(list.name)}</span>
            <span style="opacity: 0.6; margin-left: 4px;">(${items.reduce((s, i) => s + i.count, 0)})</span>
          </div>
          ${collapsed ? '' : items.map(h => {
            const currentIndex = this.highlightIndices.get(h.word) || 0;
            return PopupRenderer.createPageHighlightItemHTML(h, currentIndex);
          }).join('')}
        </div>
      `;
    }
    
    const ungrouped = filtered.filter(h => !groupOrder.some(l => h.listId === l.id || (h.listNames && h.listNames.includes(l.name))));
    if (ungrouped.length > 0) {
      const groupKey = 'list-other';
      const collapsed = this.pageHighlightsCollapsedGroups.has(groupKey);
      const chevron = collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
      html += `
        <div class="page-highlights-group-section ${collapsed ? 'collapsed' : ''}" data-group="${groupKey}">
          <div class="page-highlights-group-header">
            <i class="fa-solid ${chevron}"></i>
            <span style="opacity: 0.6;">${chrome.i18n.getMessage('other') || 'Other'}</span>
          </div>
          ${collapsed ? '' : ungrouped.map(h => {
            const currentIndex = this.highlightIndices.get(h.word) || 0;
            return PopupRenderer.createPageHighlightItemHTML(h, currentIndex);
          }).join('')}
        </div>
      `;
    }
    return html;
  }

  private getListIdsWithMatchesOnPage(): Set<number> {
    const ids = new Set<number>();
    for (const h of this.pageHighlights) {
      if (h.listId !== undefined) ids.add(h.listId);
      for (const name of h.listNames) {
        const list = this.pageHighlightsActiveLists.find(l => l.name === name);
        if (list) ids.add(list.id);
      }
    }
    return ids;
  }

  private getListsWithMatchesOnPage(): Array<{ id: number; name: string; background: string }> {
    const ids = this.getListIdsWithMatchesOnPage();
    return this.pageHighlightsActiveLists.filter(l => ids.has(l.id));
  }

  renderFilters(): void {
    const container = document.getElementById('pageHighlightsListFilters');
    const actionsEl = document.getElementById('pageHighlightsFiltersActions');
    if (!container) return;
    
    const listsOnPage = this.getListsWithMatchesOnPage();
    if (listsOnPage.length <= 1) {
      container.innerHTML = '';
      if (actionsEl) {
        actionsEl.innerHTML = '';
        actionsEl.hidden = true;
      }
      return;
    }

    const listFilter = this.getListFilter();
    const isNone = listFilter.size === 1 && listFilter.has(-1);
    const showQuickActions = listsOnPage.length > PageHighlightsManager.MANY_LISTS_THRESHOLD;

    if (actionsEl) {
      if (showQuickActions) {
        const allLabel = chrome.i18n.getMessage('select_all') || 'Select all';
        const noneLabel = chrome.i18n.getMessage('deselect_all') || 'Deselect all';
        actionsEl.innerHTML = `
          <button type="button" class="page-highlights-filter-link" data-filter-action="all">${DOMUtils.escapeHtml(allLabel)}</button>
          <span aria-hidden="true"> · </span>
          <button type="button" class="page-highlights-filter-link" data-filter-action="none">${DOMUtils.escapeHtml(noneLabel)}</button>
        `;
        actionsEl.hidden = false;
        actionsEl.querySelectorAll('.page-highlights-filter-link').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = (btn as HTMLElement).dataset.filterAction;
            if (action === 'all') {
              this.setListFilter(new Set());
            } else if (action === 'none') {
              this.setListFilter(new Set([-1]));
            }
            this.onStateChanged();
            this.render();
            this.renderFilters();
          });
        });
      } else {
        actionsEl.innerHTML = '';
        actionsEl.hidden = true;
      }
    }

    const active = (listId: number) =>
      !isNone && (listFilter.size === 0 || listFilter.has(listId));

    container.innerHTML = listsOnPage.map(list => {
      const chipActive = active(list.id);
      const bg = DOMUtils.escapeHtml(list.background);
      return `
        <button type="button" class="page-highlights-filter-chip ${chipActive ? 'active' : ''}" data-list-id="${list.id}" title="${DOMUtils.escapeHtml(list.name)}" style="--list-color: ${bg};">
          <span class="filter-dot" style="background-color: ${bg};"></span>
          <span>${DOMUtils.escapeHtml(list.name)}</span>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.page-highlights-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.listId);
        const listIdsOnPage = this.getListIdsWithMatchesOnPage();
        const allSelected = listFilter.size === 0;
        
        if (listFilter.has(id)) {
          listFilter.delete(id);
          if (listFilter.size === 0) {
            this.setListFilter(new Set());
          }
        } else {
          if (allSelected) {
            const newFilter = new Set(listIdsOnPage);
            newFilter.delete(id);
            this.setListFilter(newFilter);
          } else {
            listFilter.add(id);
          }
        }
        if (listFilter.has(-1)) {
          listFilter.delete(-1);
        }
        this.onStateChanged();
        this.render();
        this.renderFilters();
      });
    });
  }
}
