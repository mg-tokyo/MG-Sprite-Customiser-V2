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
  addTextBtn: HTMLButtonElement;
  addCardBtn: HTMLButtonElement;
  addFullCardBtn: HTMLButtonElement;
  addBloblingBtn: HTMLButtonElement;
  uploadInput: HTMLInputElement;
  uploadBtn: HTMLButtonElement;
  clearSlotBtn: HTMLButtonElement;
  resetAllBtn: HTMLButtonElement;
}

export function buildToolbar(): ToolbarRefs {
  const themeBtn = el('button', { className: 'sc2-tb-btn', title: 'Toggle light/dark theme' }) as HTMLButtonElement;
  themeBtn.textContent = '◑';

  const undoBtn = el('button', { className: 'sc2-tb-btn', title: 'Undo (Ctrl+Z)' }) as HTMLButtonElement;
  undoBtn.textContent = '↩';

  const redoBtn = el('button', { className: 'sc2-tb-btn', title: 'Redo (Ctrl+Y)' }) as HTMLButtonElement;
  redoBtn.textContent = '↪';

  const downloadBtn = el('button', { className: 'sc2-tb-btn sc2-tb-btn--accent', title: 'Download PNG' }) as HTMLButtonElement;
  downloadBtn.textContent = '↓ PNG';

  const sceneNameInput = el('input', {
    type: 'text',
    className: 'sc2-tb-scene-input',
    placeholder: 'Scene name…',
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

  const uploadInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif',
  }) as HTMLInputElement;
  uploadInput.style.display = 'none';

  const uploadBtn = el('button', {
    className: 'sc2-tb-btn sc2-tb-btn--secondary',
    title: 'Upload PNG/GIF image',
    textContent: '↑ Upload',
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
    el('div', { className: 'sc2-tb-group' }, [addTextBtn, addCardBtn, addFullCardBtn, addBloblingBtn, uploadBtn, uploadInput]),
    el('div', { className: 'sc2-tb-spacer' }),
    el('div', { className: 'sc2-tb-group' }, [clearSlotBtn, resetAllBtn]),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [undoBtn, redoBtn]),
    el('div', { className: 'sc2-tb-sep' }),
    el('div', { className: 'sc2-tb-group' }, [themeBtn, downloadBtn]),
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
    addTextBtn,
    addCardBtn,
    addFullCardBtn,
    addBloblingBtn,
    uploadInput,
    uploadBtn,
    clearSlotBtn,
    resetAllBtn,
  };
}
