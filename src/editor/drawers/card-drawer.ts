import { el } from '../../utils/dom';
import { FILTERS } from '../../../mg-sprite-render/src';
import type { FullCardRarity } from '../../state/store';

// ── Mutation chip colors (exported so app.ts and inspector can reuse) ──────────
export const MUTATION_CHIP_COLORS: Record<string, string> = {
  Gold:          '#EBC800',
  Rainbow:       'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9)',
  Wet:           '#32B4C8',
  Chilled:       '#64A0D2',
  Frozen:        '#6482DC',
  Thunderstruck: '#FFD700',
  Dawnlit:       '#D146E7',
  Ambershine:    '#BE6428',
  Dawncharged:   '#8C50C8',
  Ambercharged:  '#AA3C19',
};

export interface CardDrawerRefs {
  el: HTMLElement;
  typeLabel: HTMLElement;
  nameInput: HTMLInputElement;
  raritySelect: HTMLSelectElement;
  rarityRow: HTMLElement;
  lockedCheck: HTMLInputElement;
  // Mutations (all types)
  itemMutationsContainer: HTMLElement;
  // Pet fields
  petSection: HTMLElement;
  petCurrentStrInput: HTMLInputElement;
  petMaxStrInput: HTMLInputElement;
  petStrPctInput: HTMLInputElement;
  petStrPctDisplay: HTMLElement;
  petHungerPctInput: HTMLInputElement;
  petHungerPctDisplay: HTMLElement;
  petAgeInput: HTMLInputElement;
  petWeightInput: HTMLInputElement;
  petSellInput: HTMLInputElement;
  petStrLabelInput: HTMLInputElement;
  petHungerLabelInput: HTMLInputElement;
  dietSlotList: HTMLElement;
  petAbilityChips: HTMLElement;
  petAbilityAddSelect: HTMLSelectElement;
  petAbilityAddBtn: HTMLButtonElement;
  petAbilityList: HTMLElement;
  addCustomAbilityBtn: HTMLButtonElement;
  // Plant fields
  plantSection: HTMLElement;
  plantSlotCountInput: HTMLInputElement;
  plantMaturedSlotsInput: HTMLInputElement;
  plantMaturityInput: HTMLInputElement;
  plantCropSlotList: HTMLElement;
  plantCropWeightInput: HTMLInputElement;
  plantCropSellInput: HTMLInputElement;
  // Crop fields
  cropSection: HTMLElement;
  cropSlotList: HTMLElement;
  cropWeightInput: HTMLInputElement;
  cropSellInput: HTMLInputElement;
  // Seed fields
  seedSection: HTMLElement;
  seedRaritySelect: HTMLSelectElement;
  seedCountInput: HTMLInputElement;
  // Egg fields
  eggSection: HTMLElement;
  eggCountInput: HTMLInputElement;
  eggHatchSlotList: HTMLElement;
  eggGoldRateInput: HTMLInputElement;
  eggRainbowRateInput: HTMLInputElement;
  // Tool fields
  toolSection: HTMLElement;
  toolCountInput: HTMLInputElement;
  toolDescInput: HTMLTextAreaElement;
  // Decor fields
  decorSection: HTMLElement;
  decorCountInput: HTMLInputElement;
}

const RARITIES: FullCardRarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythic', 'Divine', 'Celestial'];

export function buildCardDrawer(callbacks: {
  onAnyInput: () => void;
  onAbilityAdd: () => void;
  onAddCustomAbility: () => void;
}): CardDrawerRefs {
  const { onAnyInput } = callbacks;

  const typeLabel = el('div', { className: 'full-card-type-label', textContent: 'Full Card' }) as HTMLElement;
  const nameInput = el('input', { type: 'text', placeholder: 'Item name...' }) as HTMLInputElement;
  nameInput.addEventListener('input', onAnyInput);

  // ── Shared: rarity ──
  const raritySelect = el('select') as HTMLSelectElement;
  for (const r of RARITIES) raritySelect.append(el('option', { value: r, textContent: r }));
  raritySelect.addEventListener('change', onAnyInput);
  const rarityRow = el('div', { className: 'full-card-field' }, [
    el('label', { textContent: 'Rarity' }), raritySelect,
  ]);

  // ── Shared: locked ──
  const lockedCheck = el('input', { type: 'checkbox' }) as HTMLInputElement;
  lockedCheck.addEventListener('change', onAnyInput);

  // ── Pet fields ──
  const petCurrentStrInput = el('input', { type: 'number', min: '0', max: '1000', step: '1', value: '50' }) as HTMLInputElement;
  petCurrentStrInput.addEventListener('input', onAnyInput);
  const petMaxStrInput = el('input', { type: 'number', min: '0', max: '1000', step: '1', value: '80' }) as HTMLInputElement;
  petMaxStrInput.addEventListener('input', onAnyInput);

  const petStrPctDisplay = el('span', { className: 'full-card-slider-val', textContent: '0%' });
  const petStrPctInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0' }) as HTMLInputElement;
  petStrPctInput.addEventListener('input', () => {
    petStrPctDisplay.textContent = `${petStrPctInput.value}%`;
    onAnyInput();
  });

  const petHungerPctDisplay = el('span', { className: 'full-card-slider-val', textContent: '100%' });
  const petHungerPctInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '100' }) as HTMLInputElement;
  petHungerPctInput.addEventListener('input', () => {
    petHungerPctDisplay.textContent = `${petHungerPctInput.value}%`;
    onAnyInput();
  });

  const petAgeInput = el('input', { type: 'text', placeholder: '0h' }) as HTMLInputElement;
  petAgeInput.addEventListener('input', onAnyInput);
  const petWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
  petWeightInput.addEventListener('input', onAnyInput);
  const petSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
  petSellInput.addEventListener('input', onAnyInput);
  const petStrLabelInput = el('input', { type: 'text', placeholder: 'Strength' }) as HTMLInputElement;
  petStrLabelInput.addEventListener('input', onAnyInput);
  const petHungerLabelInput = el('input', { type: 'text', placeholder: 'Hunger' }) as HTMLInputElement;
  petHungerLabelInput.addEventListener('input', onAnyInput);

  const dietSlotList = el('div', { className: 'full-card-slot-list' });

  const petAbilityChips = el('div', { className: 'full-card-ability-chips' });
  const petAbilityAddSelect = el('select') as HTMLSelectElement;
  petAbilityAddSelect.append(el('option', { value: '', textContent: '(loading abilities...)' }));
  const petAbilityAddBtn = el('button', {
    type: 'button',
    className: 'full-card-item-btn',
    textContent: 'Add',
  }) as HTMLButtonElement;
  petAbilityAddBtn.addEventListener('click', () => callbacks.onAbilityAdd());

  const petAbilityList = el('div', { className: 'full-card-abilities-list' });
  const addCustomAbilityBtn = el('button', {
    type: 'button',
    className: 'full-card-ability-add',
    textContent: '+',
    title: 'Add custom ability',
  }) as HTMLButtonElement;
  addCustomAbilityBtn.addEventListener('click', () => callbacks.onAddCustomAbility());

  const petSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Pet Stats' }),
    rarityRow,
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Current STR' }), petCurrentStrInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Max STR' }), petMaxStrInput]),
    el('div', { className: 'full-card-field' }, [
      el('label', { textContent: 'XP % (within level)' }),
      el('div', { className: 'full-card-slider-row' }, [petStrPctInput, petStrPctDisplay]),
    ]),
    el('div', { className: 'full-card-field' }, [
      el('label', { textContent: 'Hunger %' }),
      el('div', { className: 'full-card-slider-row' }, [petHungerPctInput, petHungerPctDisplay]),
    ]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Age' }), petAgeInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Weight' }), petWeightInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Sell Price' }), petSellInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Str label' }), petStrLabelInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Hunger label' }), petHungerLabelInput]),
    el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Diet' }), dietSlotList]),
    el('div', { className: 'full-card-field full-card-field--stack' }, [
      el('label', { textContent: 'Abilities' }),
      el('div', { className: 'full-card-abilities-wrap' }, [
        petAbilityChips,
        el('div', { className: 'full-card-ability-add-row' }, [petAbilityAddSelect, petAbilityAddBtn]),
        el('div', { className: 'full-card-abilities-custom' }, [petAbilityList, addCustomAbilityBtn]),
      ]),
    ]),
  ]);

  // ── Plant fields ──
  const plantSlotCountInput = el('input', { type: 'number', min: '1', step: '1', value: '1' }) as HTMLInputElement;
  plantSlotCountInput.addEventListener('input', onAnyInput);
  const plantMaturedSlotsInput = el('input', { type: 'number', min: '0', step: '1', value: '0' }) as HTMLInputElement;
  plantMaturedSlotsInput.addEventListener('input', onAnyInput);
  const plantMaturityInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0' }) as HTMLInputElement;
  plantMaturityInput.addEventListener('input', onAnyInput);
  const plantCropSlotList = el('div', { className: 'full-card-slot-list' });
  const plantCropWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
  plantCropWeightInput.addEventListener('input', onAnyInput);
  const plantCropSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
  plantCropSellInput.addEventListener('input', onAnyInput);

  const plantSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Growth' }),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Total Slots' }), plantSlotCountInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Mature Slots' }), plantMaturedSlotsInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Maturity %' }), plantMaturityInput]),
    el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Crops' }), plantCropSlotList]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Crop Weight' }), plantCropWeightInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Crop Sell Price' }), plantCropSellInput]),
  ]);

  // ── Crop fields ──
  const cropSlotList = el('div', { className: 'full-card-slot-list' });
  const cropWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
  cropWeightInput.addEventListener('input', onAnyInput);
  const cropSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
  cropSellInput.addEventListener('input', onAnyInput);

  const cropSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Crop' }),
    el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Produce' }), cropSlotList]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Weight' }), cropWeightInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Sell Price' }), cropSellInput]),
  ]);

  // ── Seed fields ──
  const seedCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
  seedCountInput.addEventListener('input', onAnyInput);
  const seedRaritySelect = el('select') as HTMLSelectElement;
  for (const r of RARITIES) seedRaritySelect.append(el('option', { value: r, textContent: r }));
  seedRaritySelect.addEventListener('change', onAnyInput);

  const seedSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Seed' }),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), seedCountInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Rarity' }), seedRaritySelect]),
  ]);

  // ── Egg fields ──
  const eggCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
  eggCountInput.addEventListener('input', onAnyInput);
  const eggHatchSlotList = el('div', { className: 'full-card-slot-list' });
  const eggGoldRateInput = el('input', { type: 'text', placeholder: '0%' }) as HTMLInputElement;
  eggGoldRateInput.addEventListener('input', onAnyInput);
  const eggRainbowRateInput = el('input', { type: 'text', placeholder: '0%' }) as HTMLInputElement;
  eggRainbowRateInput.addEventListener('input', onAnyInput);

  const eggSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Egg' }),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), eggCountInput]),
    el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Hatches' }), eggHatchSlotList]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Gold Rate' }), eggGoldRateInput]),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Rainbow Rate' }), eggRainbowRateInput]),
  ]);

  // ── Tool fields ──
  const toolCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
  toolCountInput.addEventListener('input', onAnyInput);
  const toolDescInput = el('textarea', { placeholder: 'Tool description...' }) as HTMLTextAreaElement;
  toolDescInput.rows = 3;
  toolDescInput.addEventListener('input', onAnyInput);

  const toolSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Tool' }),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), toolCountInput]),
    el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Description' }), toolDescInput]),
  ]);

  // ── Decor fields ──
  const decorCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
  decorCountInput.addEventListener('input', onAnyInput);

  const decorSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
    el('div', { className: 'full-card-section-title', textContent: 'Decor' }),
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), decorCountInput]),
  ]);

  // ── Shared: mutations ──
  const itemMutationsContainer = el('div', { className: 'full-card-mutations-wrap' });
  for (const id of Object.keys(FILTERS)) {
    const chip = el('span', { className: 'full-card-mutation-chip', textContent: id }) as HTMLElement;
    chip.dataset.mutationId = id;
    chip.style.background = MUTATION_CHIP_COLORS[id] ?? '#555';
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      onAnyInput();
    });
    itemMutationsContainer.append(chip);
  }

  // ── Assemble ──
  const content = el('div', { className: 'full-card-controls-section' });
  content.append(
    typeLabel,
    el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Name' }), nameInput]),
    el('label', { className: 'full-card-locked-wrap' }, [lockedCheck, document.createTextNode(' Locked')]),
    petSection,
    plantSection,
    cropSection,
    seedSection,
    eggSection,
    toolSection,
    decorSection,
    el('div', { className: 'full-card-section' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Mutations' }),
      itemMutationsContainer,
    ]),
  );

  return {
    el: content,
    typeLabel,
    nameInput,
    raritySelect,
    rarityRow,
    lockedCheck,
    itemMutationsContainer,
    petSection,
    petCurrentStrInput,
    petMaxStrInput,
    petStrPctInput,
    petStrPctDisplay,
    petHungerPctInput,
    petHungerPctDisplay,
    petAgeInput,
    petWeightInput,
    petSellInput,
    petStrLabelInput,
    petHungerLabelInput,
    dietSlotList,
    petAbilityChips,
    petAbilityAddSelect,
    petAbilityAddBtn,
    petAbilityList,
    addCustomAbilityBtn,
    plantSection,
    plantSlotCountInput,
    plantMaturedSlotsInput,
    plantMaturityInput,
    plantCropSlotList,
    plantCropWeightInput,
    plantCropSellInput,
    cropSection,
    cropSlotList,
    cropWeightInput,
    cropSellInput,
    seedSection,
    seedRaritySelect,
    seedCountInput,
    eggSection,
    eggCountInput,
    eggHatchSlotList,
    eggGoldRateInput,
    eggRainbowRateInput,
    toolSection,
    toolCountInput,
    toolDescInput,
    decorSection,
    decorCountInput,
  };
}
