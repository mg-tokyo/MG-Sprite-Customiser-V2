import type { FullCardData, FullCardType } from '../../state/store';

export interface CardVariantBaseV1 {
  id: string;
  name: string;
  cardType: FullCardType;
  fullCardData: FullCardData;
  scenePresetId?: string;
  layerRefs?: string[];
  thumbnailRef?: string;
  version: 1;
}

export interface BuiltinCardVariantV1 extends CardVariantBaseV1 {
  source: 'builtin';
  readonly: true;
}

export interface UserCardVariantV1 extends CardVariantBaseV1 {
  source: 'user';
  readonly: false;
  createdAt: number;
  updatedAt: number;
}

export type CardVariantV1 = BuiltinCardVariantV1 | UserCardVariantV1;

export interface CardVariantExportV1 {
  version: 1;
  exportedAt: number;
  variants: UserCardVariantV1[];
}
