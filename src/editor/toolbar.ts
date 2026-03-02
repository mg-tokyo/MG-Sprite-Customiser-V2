import { el } from '../utils/dom';

export interface ToolbarRefs {
  el: HTMLElement;
  sceneNameInput: HTMLInputElement;
  sceneSaveBtn: HTMLButtonElement;
  sceneLoadInput: HTMLInputElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  themeBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  fxPreviewBtn: HTMLButtonElement;
  addTextBtn: HTMLButtonElement;
  addCardBtn: HTMLButtonElement;
  addFullCardBtn: HTMLButtonElement;
  addHungerBarBtn: HTMLButtonElement;
  addStrengthBarBtn: HTMLButtonElement;
  addBloblingBtn: HTMLButtonElement;
  uploadInput: HTMLInputElement;
  uploadBtn: HTMLButtonElement;
  clearSlotBtn: HTMLButtonElement;
  resetAllBtn: HTMLButtonElement;
}

export function buildToolbar(): ToolbarRefs {
  const themeBtn = el('button', { className: 'sc2-tb-btn', title: 'Toggle light/dark theme' }) as HTMLButtonElement;
  themeBtn.textContent = '\u25D1';

  const undoBtn = el('button', { className: 'sc2-tb-btn', title: 'Undo (Ctrl+Z)' }) as HTMLButtonElement;
  undoBtn.textContent = '\u21A9';

  const redoBtn = el('button', { className: 'sc2-tb-btn', title: 'Redo (Ctrl+Y)' }) as HTMLButtonElement;
  redoBtn.textContent = '\u21AA';

  const downloadBtn = el('button', { className: 'sc2-tb-btn sc2-tb-btn--accent', title: 'Download PNG' }) as HTMLButtonElement;
  downloadBtn.textContent = '\u2193 PNG';

  const fxPreviewBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Open FX Preview',
    textContent: 'FX Preview',
  }) as HTMLButtonElement;

  const sceneNameInput = el('input', {
    type: 'text',
    className: 'sc2-tb-scene-input',
    placeholder: 'Scene name...',
  }) as HTMLInputElement;

  const sceneSaveBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    textContent: 'Save',
    title: 'Save scene',
  }) as HTMLButtonElement;

  const sceneLoadInput = el('input', { type: 'file', accept: '.json' }) as HTMLInputElement;
  sceneLoadInput.style.display = 'none';

  const importBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    textContent: 'Import',
    title: 'Import scene JSON',
  }) as HTMLButtonElement;
  importBtn.addEventListener('click', () => sceneLoadInput.click());

  const addTextBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add Text Layer',
    textContent: '+ Text',
  }) as HTMLButtonElement;

  const addCardBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add card as separate layer elements',
    textContent: '+ Card',
  }) as HTMLButtonElement;

  const addFullCardBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add full card with live editor',
    textContent: '+ Card (full)',
  }) as HTMLButtonElement;

  const addBloblingBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add Blobling Layer',
    textContent: '+ Blobling',
  }) as HTMLButtonElement;

  const addHungerBarBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add Hunger Bar Layer',
    textContent: '+ Hunger Bar',
  }) as HTMLButtonElement;

  const addStrengthBarBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Add Strength Bar Layer',
    textContent: '+ Strength Bar',
  }) as HTMLButtonElement;

  const uploadInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif',
  }) as HTMLInputElement;
  uploadInput.style.display = 'none';

  const uploadBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Upload PNG/GIF image',
    textContent: '\u2191 Upload',
  }) as HTMLButtonElement;
  uploadBtn.addEventListener('click', () => uploadInput.click());

  const clearSlotBtn = el('button', {
    className: 'sc2-tb-btn',
    title: 'Clear active slot',
    textContent: 'Clear',
  }) as HTMLButtonElement;

  const resetAllBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--danger',
    title: 'Reset all slots',
    textContent: 'Reset',
  }) as HTMLButtonElement;

  const toolbar = el('div', { className: 'sc2-toolbar' }, [
    el('span', { className: 'sc2-tb-logo', textContent: 'SC2' }),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [sceneNameInput, sceneSaveBtn, importBtn, sceneLoadInput]),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [addTextBtn, addCardBtn, addFullCardBtn, addHungerBarBtn, addStrengthBarBtn, addBloblingBtn, uploadBtn, uploadInput]),
    el('div', { className: 'sc2-tb-spacer' }),
    el('div', { className: 'sc2-tb-group' }, [clearSlotBtn, resetAllBtn]),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [undoBtn, redoBtn]),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [themeBtn, fxPreviewBtn, downloadBtn]),
  ]);

  return {
    el: toolbar,
    sceneNameInput,
    sceneSaveBtn,
    sceneLoadInput,
    undoBtn,
    redoBtn,
    themeBtn,
    downloadBtn,
    fxPreviewBtn,
    addTextBtn,
    addCardBtn,
    addFullCardBtn,
    addHungerBarBtn,
    addStrengthBarBtn,
    addBloblingBtn,
    uploadInput,
    uploadBtn,
    clearSlotBtn,
    resetAllBtn,
  };
}
