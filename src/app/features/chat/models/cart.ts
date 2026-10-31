export type CartItemState = 'adding' | 'added' | 'failed';

export interface StoreCartItem {
  key: string;
  id: number;
  name: string;
  quantity: number;
  variation?: { attribute: string; value: string }[];
}

export interface StoreCart {
  items: StoreCartItem[];
}

export interface StoreAttribute {
  name: string;
  taxonomy: string | null;
  has_variations: boolean;
  terms: { name: string; slug: string }[];
}

export interface StoreProduct {
  attributes: StoreAttribute[];
}

export interface CartOfferOption {
  name: string;
  values: string[];
  product: string;
}
