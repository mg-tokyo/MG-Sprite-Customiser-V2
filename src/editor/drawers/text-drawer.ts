import { el } from '../../utils/dom';
import { CustomDropdown } from '../custom-dropdown';
import type { DropdownItem } from '../custom-dropdown';
import { UNICODE_STYLES, MG_FONTS } from '../font-data';
import type { TextData } from '../../state/store';

export interface TextDrawerRefs {
  el: HTMLElement;
  fontGroupDropdown: CustomDropdown;
  fontItemDropdown: CustomDropdown;
  fontGoogleSearch: HTMLInputElement;
  fontGoogleResults: HTMLElement;
  unicodeDropdown: CustomDropdown;
  unicodeRow: HTMLElement;
  textArea: HTMLTextAreaElement;
  alignBtns: HTMLButtonElement[];
  wordWrapToggle: HTMLInputElement;
  wordWrapWidthRow: HTMLElement;
  wordWrapWidthInput: HTMLInputElement;
  boldToggle: HTMLInputElement;
  italicToggle: HTMLInputElement;
  mgShadowToggle: HTMLInputElement;
  strokeToggle: HTMLInputElement;
  strokeControls: HTMLElement;
  strokeColorInput: HTMLInputElement;
  strokeWidthInput: HTMLInputElement;
}

export interface TextDrawerCallbacks {
  onFontGroupChange: (groupId: string) => void;
  onFontItemSelect: (fontId: string) => void;
  onGoogleSearch: () => void;
  onTextInput: () => void;
  onAlignClick: (align: TextData['align']) => void;
  onWordWrapToggle: () => void;
  onWordWrapWidthInput: () => void;
  onBoldToggle: () => void;
  onItalicToggle: () => void;
  onMgShadowToggle: () => void;
  onStrokeToggle: () => void;
  onStrokeColorInput: () => void;
  onStrokeWidthInput: () => void;
  onUnicodeSelect: (id: string) => void;
}

const FONT_GROUPS = [
  { id: 'mg',      label: 'MG Fonts' },
  { id: 'system',  label: 'System Fonts' },
  { id: 'google',  label: 'Google Fonts' },
  { id: 'unicode', label: 'Unicode Styles' },
];

export function buildTextDrawer(cbs: TextDrawerCallbacks): TextDrawerRefs {
  // ── Font group selector ──
  const fontGroupDropdown = new CustomDropdown({
    showThumbs: false,
    placeholder: 'Font group…',
    onSelect: (item) => cbs.onFontGroupChange(item.id),
  });
  fontGroupDropdown.setItems(
    FONT_GROUPS.map(g => ({ id: g.id, label: g.label })),
    'mg',
  );

  // ── Font item selector ──
  const fontItemDropdown = new CustomDropdown({
    showThumbs: false,
    placeholder: 'Select font…',
    onSelect: (item) => cbs.onFontItemSelect(item.id),
  });

  // ── Google font search ──
  const fontGoogleSearch = el('input', {
    type: 'text',
    placeholder: 'Search Google Fonts…',
    className: 'font-google-search',
    style: 'display:none',
  }) as HTMLInputElement;
  fontGoogleSearch.addEventListener('input', () => cbs.onGoogleSearch());

  const fontGoogleResults = el('div', { className: 'font-google-results', style: 'display:none' });

  // ── Unicode style selector ──
  const unicodeDropdown = new CustomDropdown({
    showThumbs: false,
    placeholder: 'None (off)',
    onSelect: (item) => cbs.onUnicodeSelect(item.id),
  });
  const unicodeItems: DropdownItem[] = [
    { id: 'none', label: 'None (off)' },
    ...UNICODE_STYLES.map(u => ({ id: u.id, label: u.label })),
  ];
  unicodeDropdown.setItems(unicodeItems, 'none');
  const unicodeRow = el('div', { className: 'text-control-row', style: 'display:none' }, [
    el('label', { textContent: 'Unicode style' }),
    unicodeDropdown.element,
  ]);

  // ── Text area ──
  const textArea = el('textarea', {
    className: 'text-input-area',
    placeholder: 'Type your text…',
    rows: '3',
  }) as HTMLTextAreaElement;
  textArea.addEventListener('input', () => cbs.onTextInput());

  // ── Alignment ──
  const alignLabels: Array<{ id: TextData['align']; glyph: string }> = [
    { id: 'left',   glyph: '⫷' },
    { id: 'center', glyph: '≡' },
    { id: 'right',  glyph: '⫸' },
  ];
  const alignBtns = alignLabels.map(({ id, glyph }) => {
    const btn = el('button', { className: 'align-btn', textContent: glyph, title: id }) as HTMLButtonElement;
    btn.dataset.align = id;
    btn.addEventListener('click', () => cbs.onAlignClick(id));
    return btn;
  });
  const alignRow = el('div', { className: 'align-row' }, [
    el('span', { textContent: 'Align:', className: 'align-row-label' }),
    ...alignBtns,
  ]);

  // ── Word wrap ──
  const wordWrapToggle = el('input', { type: 'checkbox', id: 'txtWordWrap' }) as HTMLInputElement;
  const wordWrapWidthInput = el('input', {
    type: 'range', min: '100', max: '900', step: '10', value: '400', id: 'txtWrapWidth',
  }) as HTMLInputElement;
  const wordWrapWidthRow = el('div', { className: 'word-wrap-width-row', style: 'display:none' }, [
    el('label', { textContent: 'Max width' }),
    wordWrapWidthInput,
  ]);

  wordWrapToggle.addEventListener('change', () => {
    wordWrapWidthRow.style.display = wordWrapToggle.checked ? '' : 'none';
    cbs.onWordWrapToggle();
  });
  wordWrapWidthInput.addEventListener('input', () => cbs.onWordWrapWidthInput());

  // ── Style toggles ──
  const boldToggle   = el('input', { type: 'checkbox', id: 'txtBold' })   as HTMLInputElement;
  const italicToggle = el('input', { type: 'checkbox', id: 'txtItalic' }) as HTMLInputElement;
  boldToggle.addEventListener('change',   () => cbs.onBoldToggle());
  italicToggle.addEventListener('change', () => cbs.onItalicToggle());

  // ── MG shadow ──
  const mgShadowToggle = el('input', { type: 'checkbox', id: 'txtMgShadow' }) as HTMLInputElement;
  mgShadowToggle.checked = true;
  mgShadowToggle.addEventListener('change', () => cbs.onMgShadowToggle());

  // ── Stroke ──
  const strokeToggle     = el('input', { type: 'checkbox', id: 'txtStroke' })                  as HTMLInputElement;
  const strokeColorInput = el('input', { type: 'color', id: 'txtStrokeColor', value: '#000000' }) as HTMLInputElement;
  const strokeWidthInput = el('input', { type: 'range', min: '1', max: '20', step: '1', value: '3', id: 'txtStrokeWidth' }) as HTMLInputElement;
  const strokeControls = el('div', { className: 'stroke-controls', style: 'display:none' }, [
    el('div', {}, [el('label', { textContent: 'Outline color' }), strokeColorInput]),
    el('div', {}, [el('label', { textContent: 'Outline width' }), strokeWidthInput]),
  ]);

  strokeToggle.addEventListener('change', () => {
    strokeControls.style.display = strokeToggle.checked ? '' : 'none';
    cbs.onStrokeToggle();
  });
  strokeColorInput.addEventListener('input', () => cbs.onStrokeColorInput());
  strokeWidthInput.addEventListener('input', () => cbs.onStrokeWidthInput());

  // ── Assemble ──
  const makeCheckLabel = (text: string, input: HTMLInputElement): HTMLLabelElement => {
    const lbl = el('label', {}) as HTMLLabelElement;
    lbl.append(input, ` ${text}`);
    return lbl;
  };

  const content = el('div', { className: 'text-controls-section' }, [
    el('label', { textContent: 'Font group' }),
    fontGroupDropdown.element,
    el('label', { textContent: 'Font' }),
    fontItemDropdown.element,
    fontGoogleSearch,
    fontGoogleResults,
    unicodeRow,
    el('label', { textContent: 'Text' }),
    textArea,
    alignRow,
    el('div', { className: 'text-style-row' }, [
      makeCheckLabel('Word wrap', wordWrapToggle),
      makeCheckLabel('Bold', boldToggle),
      makeCheckLabel('Italic', italicToggle),
    ]),
    wordWrapWidthRow,
    el('div', { className: 'text-preset-row' }, [
      makeCheckLabel('MG drop shadow', mgShadowToggle),
      makeCheckLabel('Outline/Stroke', strokeToggle),
    ]),
    strokeControls,
  ]);

  // Populate font item list for default group (mg)
  fontItemDropdown.setItems(MG_FONTS.map(f => ({ id: f.id, label: f.label })));

  return {
    el: content,
    fontGroupDropdown,
    fontItemDropdown,
    fontGoogleSearch,
    fontGoogleResults,
    unicodeDropdown,
    unicodeRow,
    textArea,
    alignBtns,
    wordWrapToggle,
    wordWrapWidthRow,
    wordWrapWidthInput,
    boldToggle,
    italicToggle,
    mgShadowToggle,
    strokeToggle,
    strokeControls,
    strokeColorInput,
    strokeWidthInput,
  };
}
