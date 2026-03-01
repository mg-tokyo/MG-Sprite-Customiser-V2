import { el } from '../../utils/dom';
import { CustomDropdown } from '../custom-dropdown';
import { BLOBLING_ANIMATIONS } from '../blobling-rive';

/** Full ordered layer list including Banner (behind Rive), overlay layers (on top). */
export const BLOBLING_LAYER_ORDER = [
  'Banner', 'Bottom', 'Mid', 'Top', 'Expression', 'Status', 'FaceProp',
] as const;

export type BloblingLayerKey = typeof BLOBLING_LAYER_ORDER[number];

export interface BloblingDrawerRefs {
  el: HTMLElement;
  catDropdowns: Map<BloblingLayerKey, CustomDropdown>;
  animDropdown: CustomDropdown;
}

export interface BloblingDrawerCallbacks {
  onLayerChange: (cat: BloblingLayerKey, itemId: string) => void;
  onAnimChange: (animId: string) => void;
}

export function buildBloblingDrawer(cbs: BloblingDrawerCallbacks): BloblingDrawerRefs {
  const catDropdowns = new Map<BloblingLayerKey, CustomDropdown>();
  const rows: HTMLElement[] = [];

  for (const cat of BLOBLING_LAYER_ORDER) {
    const dropdown = new CustomDropdown({
      showThumbs: true,
      placeholder: 'None',
      onSelect: (item) => cbs.onLayerChange(cat, item.id),
    });
    dropdown.setItems([{ id: 'none', label: 'None' }], 'none');
    catDropdowns.set(cat, dropdown);

    rows.push(el('div', { className: 'blobling-cat-row' }, [
      el('span', { className: 'blobling-cat-label', textContent: cat }),
      dropdown.element,
    ]));
  }

  // Animation picker
  const animDropdown = new CustomDropdown({
    showThumbs: false,
    placeholder: 'None (static)',
    onSelect: (item) => cbs.onAnimChange(item.id),
  });
  animDropdown.setItems([{ id: 'none', label: 'None (static)' }], 'none');

  const content = el('div', { className: 'blobling-controls-section' }, [
    el('h3', { className: 'blobling-heading', textContent: 'Blobling Rig' }),
    el('p', { className: 'blobling-hint', textContent: 'Layer cosmetics to build your blobling.' }),
    ...rows,
    el('div', { className: 'blobling-anim-section' }, [
      el('label', { textContent: 'Animation' }),
      animDropdown.element,
    ]),
  ]);

  return { el: content, catDropdowns, animDropdown };
}

export function buildBloblingAnimItems() {
  return [
    { id: 'none', label: 'None (static)' },
    ...BLOBLING_ANIMATIONS.map(a => ({ id: String(a.id), label: a.name })),
  ];
}
