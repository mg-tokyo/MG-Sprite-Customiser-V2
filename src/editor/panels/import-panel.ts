import { state, updateSlot } from '../../state/store';
import { el } from '../../utils/dom';

export class ImportPanel {
  readonly element: HTMLElement;
  private readonly MAX_IMPORT_BYTES = 15 * 1024 * 1024;

  constructor() {
    const fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif',
      className: 'file-input',
    }) as HTMLInputElement;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.importFile(file);
      fileInput.value = '';
    });

    const dropZone = el('div', { className: 'drop-zone', textContent: 'Drop PNG/GIF here or click to browse' });
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file) this.importFile(file);
    });

    this.element = el('div', { className: 'panel import-panel' }, [
      el('div', { className: 'panel-header', textContent: 'Import' }),
      dropZone,
      fileInput,
    ]);
  }

  private importFile(file: File): void {
    if (file.size > this.MAX_IMPORT_BYTES) {
      alert('File is too large. Please use files smaller than 15 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');

    updateSlot(state.activeSlotIndex, {
      type: 'custom',
      spriteKey: name,
      spriteUrl: url,
    });
  }
}
