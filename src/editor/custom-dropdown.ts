import { renderThumb } from './thumbnail';

export interface DropdownItem {
  id: string;
  label: string;
  thumbUrl?: string;
  /** Pre-resolved frame URLs for sprite atlas animations. When set, selecting this item loads all frames and starts animated preview. */
  animFrameUrls?: string[];
  /** For card presets: sprite URLs to load into consecutive slots [bottom, middle, top]. */
  cardPresetUrls?: string[];
}

interface DropdownOptions {
  showThumbs?: boolean;
  placeholder?: string;
  onSelect: (item: DropdownItem) => void;
  /** Called when a thumbnail becomes visible in the list. Use to pre-warm the sprite cache. */
  onThumbVisible?: (url: string) => void;
}

export class CustomDropdown {
  private readonly wrap: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly triggerThumb: HTMLCanvasElement;
  private readonly triggerLabel: HTMLSpanElement;
  private readonly overlay: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly emptyMsg: HTMLLIElement;
  private readonly placeholder: string;

  private items: DropdownItem[] = [];
  private itemEls: HTMLLIElement[] = [];
  private selectedId: string | null = null;
  private focusedIndex = -1;
  private isOpen = false;

  private readonly showThumbs: boolean;
  private readonly onSelectCb: (item: DropdownItem) => void;
  private readonly onThumbVisibleCb?: (url: string) => void;
  private readonly observer: IntersectionObserver;
  private readonly outsideHandler: (e: MouseEvent) => void;

  constructor(opts: DropdownOptions) {
    this.showThumbs = opts.showThumbs ?? true;
    this.onSelectCb = opts.onSelect;
    this.onThumbVisibleCb = opts.onThumbVisible;
    this.placeholder = opts.placeholder ?? 'Select\u2026';

    // ── Trigger ──
    this.triggerThumb = document.createElement('canvas');
    this.triggerThumb.className = 'cdd-trigger-thumb';
    this.triggerThumb.width = 32;
    this.triggerThumb.height = 32;
    this.triggerThumb.style.display = 'none';

    this.triggerLabel = document.createElement('span');
    this.triggerLabel.className = 'cdd-trigger-label';
    this.triggerLabel.textContent = this.placeholder;

    const arrow = document.createElement('span');
    arrow.className = 'cdd-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'cdd-trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    if (this.showThumbs) this.trigger.append(this.triggerThumb);
    this.trigger.append(this.triggerLabel, arrow);

    // ── Overlay ──
    this.emptyMsg = document.createElement('li');
    this.emptyMsg.className = 'cdd-empty';
    this.emptyMsg.textContent = 'No results';
    this.emptyMsg.style.display = 'none';

    this.list = document.createElement('ul');
    this.list.className = 'cdd-list';
    this.list.setAttribute('role', 'listbox');
    this.list.append(this.emptyMsg);

    this.overlay = document.createElement('div');
    this.overlay.className = 'cdd-overlay';
    this.overlay.setAttribute('tabindex', '-1');
    this.overlay.hidden = true;
    this.overlay.append(this.list);

    this.wrap = document.createElement('div');
    this.wrap.className = 'cdd-wrap';
    this.wrap.append(this.trigger, this.overlay);

    // ── Lazy thumbnail loader (viewport-based IntersectionObserver) ──
    // Items only load when visible in the open overlay, matching the viewport.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = entry.target as HTMLElement;
          const url = slot.dataset.thumbUrl;
          if (!url) continue;
          this.observer.unobserve(slot);
          const canvas = document.createElement('canvas');
          canvas.className = 'cdd-thumb';
          canvas.width = 36;
          canvas.height = 36;
          slot.replaceWith(canvas);
          // Render content-cropped thumbnail + warm renderer cache (both fire-and-forget)
          renderThumb(url, canvas);
          this.onThumbVisibleCb?.(url);
        }
      },
      { rootMargin: '80px 0px' },
    );

    // ── Events ──
    this.trigger.addEventListener('click', () => this.toggle());
    this.wrap.addEventListener('keydown', (e) => this.onKey(e));
    this.outsideHandler = (e: MouseEvent) => {
      if (!this.wrap.contains(e.target as Node)) this.close();
    };
  }

  get element(): HTMLElement {
    return this.wrap;
  }

  /**
   * Repopulate the dropdown with a new set of items.
   * If restoreId is found in the new list, selects it silently (no callback).
   * Otherwise auto-selects the first item and fires onSelect.
   */
  setItems(items: DropdownItem[], restoreId?: string): void {
    this.observer.disconnect();
    this.items = items;
    this.itemEls = [];
    this.focusedIndex = -1;
    this.selectedId = null;

    // Remove all existing item elements (keep emptyMsg)
    const toRemove: Element[] = [];
    for (const child of this.list.children) {
      if (child !== this.emptyMsg) toRemove.push(child);
    }
    for (const child of toRemove) this.list.removeChild(child);
    this.emptyMsg.style.display = 'none';

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'cdd-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.id = item.id;

      if (this.showThumbs) {
        const thumbSlot = document.createElement('span');
        thumbSlot.className = 'cdd-thumb-placeholder';
        if (item.thumbUrl) {
          thumbSlot.dataset.thumbUrl = item.thumbUrl;
          this.observer.observe(thumbSlot);
        }
        li.append(thumbSlot);
      }

      const lbl = document.createElement('span');
      lbl.className = 'cdd-item-label';
      lbl.textContent = item.label;
      li.append(lbl);

      li.addEventListener('click', () => this.pick(item, li));
      li.addEventListener('mouseenter', () => {
        const idx = this.itemEls.indexOf(li);
        if (idx >= 0) this.setFocusIdx(idx, false);
      });

      this.list.insertBefore(li, this.emptyMsg);
      this.itemEls.push(li);
    }

    if (items.length === 0) {
      this.triggerLabel.textContent = this.placeholder;
      if (this.showThumbs) this.triggerThumb.style.display = 'none';
      return;
    }

    const restoreIdx = restoreId != null && restoreId !== ''
      ? items.findIndex(i => i.id === restoreId)
      : -1;

    if (restoreIdx >= 0) {
      // Restore silently — sprite is already loaded in slot
      this.applySelection(items[restoreIdx], this.itemEls[restoreIdx]);
    } else {
      // Auto-select first item and notify
      this.applySelection(items[0], this.itemEls[0]);
      this.onSelectCb(items[0]);
    }
  }

  /**
   * Update the visible selection without firing onSelect.
   * Used when switching slots to sync the UI with the slot's current sprite.
   */
  selectById(id: string): void {
    if (!id || this.selectedId === id) return;
    const idx = this.items.findIndex(i => i.id === id);
    if (idx >= 0) this.applySelection(this.items[idx], this.itemEls[idx]);
  }

  /**
   * Filter visible items by query string. No DOM rebuild — just show/hide.
   */
  filter(query: string): void {
    const q = query.toLowerCase().trim();
    let firstVisible = -1;

    for (let i = 0; i < this.itemEls.length; i++) {
      const visible = !q || this.items[i].label.toLowerCase().includes(q);
      this.itemEls[i].style.display = visible ? '' : 'none';
      if (visible && firstVisible < 0) firstVisible = i;
    }

    this.emptyMsg.style.display = firstVisible < 0 ? '' : 'none';
    this.focusedIndex = firstVisible;
  }

  destroy(): void {
    this.observer.disconnect();
    document.removeEventListener('mousedown', this.outsideHandler);
  }

  // ── Private ──

  private applySelection(item: DropdownItem, el: HTMLLIElement): void {
    for (const li of this.itemEls) {
      li.classList.remove('selected');
      li.setAttribute('aria-selected', 'false');
    }
    this.selectedId = item.id;
    el.classList.add('selected');
    el.setAttribute('aria-selected', 'true');

    this.triggerLabel.textContent = item.label;
    if (this.showThumbs && item.thumbUrl) {
      this.triggerThumb.style.display = '';
      renderThumb(item.thumbUrl, this.triggerThumb);
    } else if (this.showThumbs) {
      this.triggerThumb.style.display = 'none';
    }
  }

  private pick(item: DropdownItem, el: HTMLLIElement): void {
    this.applySelection(item, el);
    this.close();
    this.trigger.focus();
    this.onSelectCb(item);
  }

  private toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  private open(): void {
    this.isOpen = true;
    this.overlay.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');

    // Determine flip direction
    const rect = this.wrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < 280 && rect.top > 280;
    this.overlay.classList.toggle('cdd-flip', flip);
    this.trigger.classList.toggle('cdd-flip', flip);
    this.trigger.classList.add('open');

    // Scroll to selected and focus — deferred so layout is complete
    requestAnimationFrame(() => {
      const selIdx = this.itemEls.findIndex(el => el.classList.contains('selected'));
      const targetIdx = selIdx >= 0 ? selIdx : 0;
      if (this.itemEls.length > 0) {
        this.setFocusIdx(targetIdx, true);
      }
      this.overlay.focus();
    });

    document.addEventListener('mousedown', this.outsideHandler);
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.classList.remove('open');

    if (this.focusedIndex >= 0 && this.focusedIndex < this.itemEls.length) {
      this.itemEls[this.focusedIndex].classList.remove('focused');
    }
    document.removeEventListener('mousedown', this.outsideHandler);
  }

  private setFocusIdx(idx: number, scroll: boolean): void {
    if (this.focusedIndex >= 0 && this.focusedIndex < this.itemEls.length) {
      this.itemEls[this.focusedIndex].classList.remove('focused');
    }
    this.focusedIndex = idx;
    if (idx >= 0 && idx < this.itemEls.length) {
      this.itemEls[idx].classList.add('focused');
      if (scroll) this.itemEls[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  private nextVisible(from: number, dir: 1 | -1): number {
    let i = from + dir;
    while (i >= 0 && i < this.itemEls.length) {
      if (this.itemEls[i].style.display !== 'none') return i;
      i += dir;
    }
    return -1;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.open();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        this.trigger.focus();
        break;

      case 'ArrowDown': {
        e.preventDefault();
        const next = this.nextVisible(this.focusedIndex, 1);
        if (next >= 0) this.setFocusIdx(next, true);
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const prev = this.nextVisible(this.focusedIndex, -1);
        if (prev >= 0) this.setFocusIdx(prev, true);
        break;
      }

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.focusedIndex < this.itemEls.length) {
          this.pick(this.items[this.focusedIndex], this.itemEls[this.focusedIndex]);
          this.trigger.focus();
        }
        break;
    }
  }
}
