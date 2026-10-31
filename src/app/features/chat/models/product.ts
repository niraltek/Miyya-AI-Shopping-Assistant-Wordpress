/**
 * The product shape the chat renders.
 *
 * Built from the copilot's `ProductCard` blocks by `CopilotService.toProduct`, which is the
 * only thing that constructs one — field names follow this codebase's camelCase convention
 * (see models/woocommerce.ts), matching what the backend's routers already alias their
 * snake_case Python fields to. The product panel and comparison table consume this and
 * nothing else, so the copilot's wire format can change without touching them.
 */

export type StockStatus = 'instock' | 'outofstock' | 'onbackorder' | 'unknown';

export interface CartHint {
  status: 'ready' | 'choose_options' | 'out_of_stock' | 'external' | 'grouped' | 'not_sellable';
  maxQuantity?: number | null;
  options: Record<string, string[]>;
  variations: {
    sourceId: number;
    options: Record<string, string>;
    maxQuantity?: number | null;
    price?: string | null;
  }[];
}

export interface ProductPrice {
  /** Null when the store did not provide a usable price; zero is a real listed price. */
  current: number | null;
  currency: string;
  /** False when the price could not be live-verified against the store. */
  verified: boolean;
}

/** Store price formatting reported by `GET /copilot/readiness`. */
export interface StorePriceFormat {
  currencyCode?: string | null;
  /** WooCommerce's `woocommerce_currency_pos`: left, right, left_space or right_space. */
  position?: string | null;
  decimals?: number | null;
  decimalSeparator?: string | null;
  thousandSeparator?: string | null;
}

export interface ProductStock {
  status: StockStatus;
  /** False when availability could not be live-verified against the store. */
  verified: boolean;
}

export interface ProductAttributes {
  color?: string[];
  size?: string[];
  weight?: string;
}

export interface ProductMatch {
  /** 0–1 relevance score for the query that produced this result. */
  score: number;
}

/**
 * Most products a shopper may tick at once for a comparison.
 *
 * Mirrors the backend's `COPILOT_MAX_COMPARE_PRODUCTS`, which is the real ceiling — the
 * compare tool truncates past it, so a UI that allowed more would let a shopper select
 * products that silently never reach the table. Keep the two in step.
 *
 * Four, because a comparison is a decision aid and someone deciding between more than
 * four things is not comparing any more. It is also the width at which every column still
 * fits the docked panel without a sideways scroll — see `MAX_FITTED_COLUMNS` in
 * `comparison-panel-component`.
 */
export const MAX_COMPARE_PRODUCTS = 4;

/** Fewest products a comparison can be made of — one product is not a comparison. Mirrors
 * `MIN_COMPARE_PRODUCTS` in `app/copilot/tools/product/compare.py`, which enforces it. */
export const MIN_COMPARE_PRODUCTS = 2;

/**
 * One row of a comparison table — a field, and its value for each compared product.
 *
 * Built by the backend (`app/services/product_comparison_service.py`), NOT derived in the
 * browser, and that is the whole point of the shape. Which fields are worth comparing
 * depends on the merchant's own catalog: their attribute names, the profile they
 * configured for the category, and which axes the selected products actually share. The
 * browser knows none of that, which is why the panel used to render five hardcoded rows —
 * two of which (brand, category) a `ProductCard` does not even carry, so they were always
 * blank.
 */
export interface ComparisonRow {
  /** The field's machine name: a canonical one like `price`, or a merchant attribute. */
  field: string;
  /** What the shopper reads in the label column, in the merchant's own spelling. */
  label: string;
  /**
   * Positional against the table's `products` — `values[i]` belongs to `products[i]`.
   *
   * `null` means the store listed nothing for that product, and must render as such.
   * Never as an empty cell or a zero: both read as an answer, and "no price listed" and
   * "free" are not the same claim.
   */
  values: (string | null)[];
  /**
   * True when this row's values were read from the merchant's live store during the turn
   * that produced them, rather than from the synced catalog. Only price and availability
   * are ever live.
   */
  isLive: boolean;
}

/** A comparison as the copilot built it: the columns, and the rows across them. */
export interface ComparisonTable {
  products: Product[];
  rows: ComparisonRow[];
}

/** One rendered comparison cell, including its price highlight. */
export interface InlineCell {
  text: string | null;
  lowest: boolean;
  /** Only on the lowest price of a two-product comparison: how much less it costs. */
  saving: string | null;
}

export interface InlineRow {
  field: string;
  label: string;
  isLive: boolean;
  cells: InlineCell[];
}

export interface Product {
  /**
   * The backend's product UUID as a string. A string, not a number, because the copilot
   * API identifies products by `product.product_id` (a uuidv7).
   */
  productId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  price: ProductPrice;
  stock: ProductStock;
  imageUrl: string;
  productUrl: string;
  attributes: ProductAttributes;
  /** Short human-readable reason this product was recommended for the query. */
  reason: string;
  match: ProductMatch;
  /** WooCommerce's average customer rating (0-5), or null when the product has no reviews. */
  averageRating: number | null;
  /** The pre-sale price when the product is discounted; null when it is not on sale. */
  regularPrice?: number | null;
  /**
   * WooCommerce's parent product id for simple and variable products. The cart hint
   * determines whether to add directly or require every variation option first.
   */
  cartProductId?: number | null;
  cart?: CartHint | null;
  productType?: string | null;
}
