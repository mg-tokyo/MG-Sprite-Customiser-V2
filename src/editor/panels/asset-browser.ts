import { el } from '../../utils/dom';
import type { DropdownItem } from '../custom-dropdown';

export interface AssetBrowserRefs {
  el: HTMLElement;
  tabsEl: HTMLElement;
  searchInput: HTMLInputElement;
  zoomInput: HTMLInputElement;
  zoomValueEl: HTMLElement;
  gridEl: HTMLElement;
}

export function buildAssetBrowser(): AssetBrowserRefs {
  const tabsEl = el('div', { className: 'browser-tabs' });

  // Left / right scroll arrows
  const leftArrow = el('button', {
    className: 'browser-tabs-arrow browser-tabs-arrow--left',
    textContent: '‹',
    title: 'Scroll tabs left',
  }) as HTMLButtonElement;
  const rightArrow = el('button', {
    className: 'browser-tabs-arrow browser-tabs-arrow--right',
    textContent: '›',
    title: 'Scroll tabs right',
  }) as HTMLButtonElement;
  leftArrow.addEventListener('click',  () => tabsEl.scrollBy({ left: -120, behavior: 'smooth' }));
  rightArrow.addEventListener('click', () => tabsEl.scrollBy({ left:  120, behavior: 'smooth' }));

  const tabsNav = el('div', { className: 'browser-tabs-nav' }, [leftArrow, tabsEl, rightArrow]);

  const searchInput = el('input', {
    type: 'text',
    className: 'browser-search',
    placeholder: '🔍 Search sprites…',
  }) as HTMLInputElement;

  const zoomInput = el('input', {
    type: 'range',
    className: 'browser-zoom-input',
    min: '0.75',
    max: '2',
    step: '0.05',
    value: '1',
  }) as HTMLInputElement;
  const zoomValueEl = el('span', {
    className: 'browser-zoom-value',
    textContent: '100%',
  }) as HTMLElement;

  const gridEl = el('div', { className: 'browser-grid' });

  const browserEl = el('div', { className: 'sc2-col-browser' }, [
    tabsNav,
    el('div', { className: 'browser-search-wrap' }, [searchInput]),
    gridEl,
    el('div', { className: 'browser-zoom-wrap' }, [
      el('label', { className: 'browser-zoom-row' }, [
        el('span', { className: 'browser-zoom-label', textContent: 'Zoom' }),
        zoomInput,
        zoomValueEl,
      ]),
    ]),
  ]);

  return { el: browserEl, tabsEl, searchInput, zoomInput, zoomValueEl, gridEl };
}

/** Category tab accent colors by category name. */
const CAT_COLORS: Record<string, string> = {
  plants:      '#4ade80',
  pets:        '#f97316',
  decor:       '#a78bfa',
  items:       '#60a5fa',
  seeds:       '#86efac',
  eggs:        '#fde68a',
  mutations:   '#f43f5e',
  ui:          '#94a3b8',
  tiles:       '#78716c',
  weather:     '#38bdf8',
  winter:      '#bae6fd',
  objects:     '#d946ef',
  'tall-plant': '#22c55e',
  animations:  '#fb923c',
  cards:       '#f59e0b',
};

export function getCatColor(catId: string): string {
  const base = catId.startsWith('cosmetic:') ? catId.slice('cosmetic:'.length) : catId;
  return CAT_COLORS[base] ?? '#94a3b8';
}

/** Apply colored-outline active style to a tab button. */
function setTabActive(btn: HTMLButtonElement, color: string): void {
  btn.classList.add('active');
  btn.style.border = `2px solid ${color}`;
  btn.style.color = color;
}

/** Clear active style from a tab button. */
function clearTabActive(btn: HTMLButtonElement): void {
  btn.classList.remove('active');
  btn.style.border = '';
  btn.style.color = '';
}

/**
 * Populate the browser tabs from a list of category items.
 * Returns a Map from category id → tab button element.
 */
export function populateBrowserTabs(
  tabsEl: HTMLElement,
  categories: { id: string; label: string }[],
  activeId: string,
  onTabClick: (id: string) => void,
): Map<string, HTMLButtonElement> {
  tabsEl.innerHTML = '';
  const map = new Map<string, HTMLButtonElement>();
  for (const cat of categories) {
    const btn = el('button', {
      className: 'browser-tab',
      textContent: cat.label,
      title: cat.label,
    }) as HTMLButtonElement;
    btn.dataset.catId = cat.id;
    const color = getCatColor(cat.id);
    if (cat.id === activeId) {
      setTabActive(btn, color);
    }
    btn.addEventListener('click', () => {
      for (const [, b] of map) clearTabActive(b);
      setTabActive(btn, color);
      onTabClick(cat.id);
    });
    tabsEl.appendChild(btn);
    map.set(cat.id, btn);
  }
  return map;
}

/**
 * Populate the browser grid from sprite items with lazy-loaded thumbnails.
 * Returns a cleanup function to disconnect the IntersectionObserver.
 */
export function populateBrowserGrid(
  gridEl: HTMLElement,
  items: DropdownItem[],
  filterQuery: string,
  onItemClick: (item: DropdownItem) => void,
): () => void {
  gridEl.innerHTML = '';

  if (items.length === 0) {
    const msg = el('div', { className: 'browser-empty', textContent: 'No items in this category.' });
    gridEl.appendChild(msg);
    return () => {};
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target as HTMLImageElement;
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        delete img.dataset.src;
      }
      observer.unobserve(img);
    }
  }, { root: gridEl, rootMargin: '60px' });

  const q = filterQuery.toLowerCase().trim();

  for (const item of items) {
    if (q && !item.label.toLowerCase().includes(q)) continue;
    if (!item.thumbUrl) continue;

    const img = document.createElement('img');
    img.dataset.src = item.thumbUrl;
    img.alt = item.label;
    img.title = item.label;
    img.className = 'browser-thumb-placeholder';

    const div = el('div', { className: 'browser-item', title: item.label }, [img]);

    if ((item.animFrameUrls && item.animFrameUrls.length > 0) || item.sheetAnim) {
      const badge = el('span', { className: 'browser-item-anim', textContent: '▶' });
      div.appendChild(badge);
    }

    div.addEventListener('click', () => onItemClick(item));
    gridEl.appendChild(div);
    observer.observe(img);
  }

  if (gridEl.childElementCount === 0) {
    const msg = el('div', { className: 'browser-empty', textContent: 'No results.' });
    gridEl.appendChild(msg);
  }

  return () => observer.disconnect();
}
