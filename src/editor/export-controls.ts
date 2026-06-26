import { el } from '../utils/dom';
import {
  exportSettings,
  EXPORT_SIZE_PRESETS,
  EXPORT_MIN_DIM,
  EXPORT_MAX_DIM,
  isExportSettingsValid,
  type ExportSizeMode,
} from './export-settings';

export interface ExportControlsOptions {
  /** Fires after any settings change (for persistence + downstream UI sync). */
  onChange: () => void;
}

/**
 * Inline controls for export output size + auto-fit, rendered next to the
 * render-size dropdown in the preview-controls bar.
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
      title: 'Export output size',
    }) as HTMLSelectElement;
    for (const s of EXPORT_SIZE_PRESETS) {
      this.sizeSelect.append(el('option', { value: `preset:${s}`, textContent: `${s}px` }));
    }
    this.sizeSelect.append(el('option', { value: 'match', textContent: 'Match canvas' }));
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
        el('span', { className: 'preview-export-field-label', textContent: 'Export' }),
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
    if (exportSettings.sizeMode === 'preset') {
      this.sizeSelect.value = `preset:${exportSettings.sizePreset}`;
    } else {
      this.sizeSelect.value = exportSettings.sizeMode;
    }
    this.customWInput.value = String(exportSettings.customW);
    this.customHInput.value = String(exportSettings.customH);
    this.autoFitInput.checked = exportSettings.autoFit;
    this.customRow.style.display = exportSettings.sizeMode === 'custom' ? 'flex' : 'none';
    this.updateValidityHint();
  }

  /** Latest validity, mirrors `isExportSettingsValid()`. */
  isValid(): boolean {
    return isExportSettingsValid();
  }

  private makeNumInput(value: string): HTMLInputElement {
    return el('input', {
      type: 'number',
      value,
      min: String(EXPORT_MIN_DIM),
      max: String(EXPORT_MAX_DIM),
      step: '1',
      className: 'preview-export-custom-input',
    }) as HTMLInputElement;
  }

  private onSizeModeChange(): void {
    const v = this.sizeSelect.value;
    if (v === 'match' || v === 'custom') {
      exportSettings.sizeMode = v as ExportSizeMode;
    } else if (v.startsWith('preset:')) {
      exportSettings.sizeMode = 'preset';
      exportSettings.sizePreset = parseInt(v.split(':')[1], 10);
    }
    this.customRow.style.display = exportSettings.sizeMode === 'custom' ? 'flex' : 'none';
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
    this.validityHint.textContent = `W/H must be integers ${EXPORT_MIN_DIM}–${EXPORT_MAX_DIM}.`;
  }
}
