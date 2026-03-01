import { el } from '../../utils/dom';

/**
 * A slide-in panel anchored to the right side of .sc2-main.
 * Manages the .sc2-drawer element and adds/removes .open + .drawer-open classes.
 */
export class Drawer {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly body: HTMLElement;
  private mainEl: HTMLElement | null = null;

  constructor() {
    this.titleEl = el('span', { className: 'sc2-drawer-title' });

    const closeBtn = el('button', {
      className: 'sc2-drawer-close',
      textContent: '✕',
      title: 'Close',
    }) as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.close());

    const header = el('div', { className: 'sc2-drawer-header' }, [this.titleEl, closeBtn]);
    this.body = el('div', { className: 'sc2-drawer-body' });
    this.el = el('div', { className: 'sc2-drawer' }, [header, this.body]);
  }

  /** Attach to .sc2-main so drawer-open class can be toggled on it. */
  attachMain(mainEl: HTMLElement): void {
    this.mainEl = mainEl;
  }

  /**
   * Open the drawer with a given title and content element.
   * If already open with the same content, this is a no-op (idempotent).
   */
  open(title: string, content: HTMLElement): void {
    this.titleEl.textContent = title;
    // Swap content only if different
    if (this.body.firstElementChild !== content) {
      this.body.innerHTML = '';
      this.body.appendChild(content);
    }
    this.el.classList.add('open');
    this.mainEl?.classList.add('drawer-open');
  }

  close(): void {
    this.el.classList.remove('open');
    this.mainEl?.classList.remove('drawer-open');
  }

  isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  currentContent(): Element | null {
    return this.body.firstElementChild ?? null;
  }
}
