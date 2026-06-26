import { el } from '../utils/dom';
import {
  exportSettings,
  SIZE_PRESETS,
  SIZE_MIN_DIM,
  SIZE_MAX_DIM,
  isExportSettingsValid,
  type SizeMode,
} from './export-settings';

export interface ExportControlsOptions {
  /** Fires after any settings change (for persistence + downstream UI sync). */
  onChange: () => void;
}

/**
 * Unified size + auto-fit controls. The chosen size drives BOTH the editor
 * preview canvas and the export output dimensions.
 */
export class ExportControls {
  readonly element: HTMLElement;
  private sizeSelect: HTMLSelectElement;
  private customRow: HTMLElement;
  private customWInput: HTMLInputElement;
  private customHInput: HTMLInputElement;
  private autoFitInput: HTMLInputElement;
  private validityHint: HTMLElement;
  private opts: ExportControlsOptions;

  constructor(opts: ExportControlsOptions) {
    this.opts = opts;

    this.sizeSelect = el('select', {
      className: 'preview-export-select',
      title: 'Canvas + export size',
    }) as HTMLSelectElement;
    for (const s of SIZE_PRESETS) {
      this.sizeSelect.append(el('option', { value: `preset:${s}`, textContent: `${s}px` }));
    }
    this.sizeSelect.append(el('option', { value: 'custom', textContent: 'Custom' }));
    this.sizeSelect.addEventListener('change', () => this.onSizeModeChange());

    this.customWInput = this.makeNumInput(String(exportSettings.customW));
    this.customHInput = this.makeNumInput(String(exportSettings.customH));
    this.customWInput.addEventListener('input', () => this.onCustomInput());
    this.customHInput.addEventListener('input', () => this.onCustomInput());

    this.customRow = el('div', { className: 'preview-export-custom' }, [
      el('label', { className: 'preview-export-custom-field' }, [
        el('span', { textContent: 'W' }),
        this.customWInput,
      ]),
      el('label', { className: 'preview-export-custom-field' }, [
        el('span', { textContent: 'H' }),
        this.customHInput,
      ]),
    ]);

    this.autoFitInput = el('input', { type: 'checkbox', className: 'preview-export-autofit' }) as HTMLInputElement;
    this.autoFitInput.addEventListener('change', () => {
      exportSettings.autoFit = this.autoFitInput.checked;
      this.opts.onChange();
    });

    this.validityHint = el('div', { className: 'preview-export-hint' });

    this.element = el('div', { className: 'preview-export-controls' }, [
      el('label', { className: 'preview-export-field' }, [
        el('span', { className: 'preview-export-field-label', textContent: 'Size' }),
        this.sizeSelect,
      ]),
      this.customRow,
      el('label', { className: 'preview-export-autofit-label', title: 'Crop to content bounds, then scale to fit the chosen size.' }, [
        this.autoFitInput,
        el('span', { textContent: 'Auto-fit' }),
      ]),
      this.validityHint,
    ]);

    this.syncFromState();
  }

  /** Re-read exportSettings (e.g. after loading from localStorage) and update UI. */
  syncFromState(): void {
    if (exportSettings.mode === 'custom') {
      this.sizeSelect.value = 'custom';
    } else {
      this.sizeSelect.value = `preset:${exportSettings.preset}`;
    }
    this.customWInput.value = String(exportSettings.customW);
    this.customHInput.value = String(exportSettings.customH);
    this.autoFitInput.checked = exportSettings.autoFit;
    this.customRow.style.display = exportSettings.mode === 'custom' ? 'flex' : 'none';
    this.updateValidityHint();
  }

  isValid(): boolean {
    return isExportSettingsValid();
  }

  private makeNumInput(value: string): HTMLInputElement {
    return el('input', {
      type: 'number',
      value,
      min: String(SIZE_MIN_DIM),
      max: String(SIZE_MAX_DIM),
      step: '1',
      className: 'preview-export-custom-input',
    }) as HTMLInputElement;
  }

  private onSizeModeChange(): void {
    const v = this.sizeSelect.value;
    if (v === 'custom') {
      exportSettings.mode = 'custom' satisfies SizeMode;
    } else if (v.startsWith('preset:')) {
      exportSettings.mode = 'preset' satisfies SizeMode;
      exportSettings.preset = parseInt(v.split(':')[1], 10);
    }
    this.customRow.style.display = exportSettings.mode === 'custom' ? 'flex' : 'none';
    this.updateValidityHint();
    this.opts.onChange();
  }

  private onCustomInput(): void {
    const w = Number(this.customWInput.value);
    const h = Number(this.customHInput.value);
    if (Number.isInteger(w)) exportSettings.customW = w;
    if (Number.isInteger(h)) exportSettings.customH = h;
    this.updateValidityHint();
    this.opts.onChange();
  }

  private updateValidityHint(): void {
    if (this.isValid()) {
      this.validityHint.textContent = '';
      return;
    }
    this.validityHint.textContent = `W/H must be integers ${SIZE_MIN_DIM}-${SIZE_MAX_DIM}.`;
  }
}
