import type { StorePriceFormat } from './product';

export interface StoredCopilotSession {
  conversationId?: string;
  sessionSecret?: string;
  storeUrl?: string;
  apiBaseUrl?: string;
}

export interface CachedShopperToken {
  value: string;
  expiresAt: number;
}

export interface ShopperTokenResponse {
  token: string | null;
  expiresAt?: number;
}
import type { CartHint } from './product';

export type CopilotReadinessStatus =
  | 'ready'
  | 'store_not_connected'
  | 'subscription_required'
  | 'catalog_sync_required'
  | 'credits_exhausted';

export interface CopilotReadinessResponse {
  ready: boolean;
  status: CopilotReadinessStatus;
  message: string;
  /** How this store writes a price; absent until the store has reported its formatting. */
  priceFormat?: StorePriceFormat | null;
}

/**
 * One product as the copilot describes it.
 *
 * `price` arrives as a STRING, not a number: it is a money value that travelled through
 * JSON, and the backend serialises `Decimal` as a string deliberately so nothing rounds it
 * on the way here. Parse it only at the point of display.
 */
export interface CopilotProductCard {
  productId: string;
  name: string;
  sku?: string | null;
  price?: string | null;
  currency?: string | null;
  stockStatus?: string | null;
  imageSrc?: string | null;
  permalink?: string | null;
  /**
   * True only when this price was verified against the merchant's live store within
   * this turn. A catalog price is not a live price, and the UI must be able to say which
   * it is showing rather than presenting both identically.
   */
  priceIsLive: boolean;
  /** Availability is verified separately; older responses without this flag are unverified. */
  stockIsLive?: boolean;
  badges: string[];
  /** WooCommerce's average customer rating (0-5) as a string, or null/absent with no reviews. */
  averageRating?: string | null;
  /** The pre-sale price, sent only when it is strictly above `price` — a real discount. */
  regularPrice?: string | null;
  brand?: string | null;
  /**
   * One composer-written line on why this product fits the request. Checked server-side
   * against this product's own facts before it is sent; absent when nothing usable was written.
   */
  rationale?: string | null;
  /** WooCommerce's own product id; absent from older responses. */
  sourceProductId?: number | null;
  /** WooCommerce's product type ('simple', 'variable', ...). */
  productType?: string | null;
  cart?: CartHint | null;
}

export interface CopilotTextBlock {
  type: 'text';
  text: string;
}

export interface CopilotProductCarouselBlock {
  type: 'product_carousel';
  items: CopilotProductCard[];
  title?: string | null;
}

export interface CopilotProductGridBlock {
  type: 'product_grid';
  items: CopilotProductCard[];
  title?: string | null;
  totalMatched?: number | null;
}

/**
 * One attribute row across the compared products. `values` is positional against the
 * block's `products`, and `null` means "not listed" — render it as such, never as an empty
 * cell that reads like a zero.
 */
export interface CopilotComparisonRow {
  field: string;
  label: string;
  values: (string | null)[];
  isLive: boolean;
}

export interface CopilotComparisonBlock {
  type: 'comparison';
  products: CopilotProductCard[];
  rows: CopilotComparisonRow[];
}

export interface CopilotClarificationOption {
  label: string;
  value: string;
}

/** A question back to the shopper — a first-class outcome, not an error path. */
export interface CopilotClarificationBlock {
  type: 'clarification';
  question: string;
  options: CopilotClarificationOption[];
}

/**
 * A tappable refinement carrying the structured filter it applies, so tapping it does not
 * round-trip through natural language and back.
 */
export interface CopilotRefinementChip {
  label: string;
  field: string;
  operator: string;
  value: unknown;
  /** The sentence sent as the shopper's next message when tapped. Turns carry text only. */
  message?: string | null;
}

export interface CopilotRefinementChipsBlock {
  type: 'refinement_chips';
  items: CopilotRefinementChip[];
  /**
   * What the chips are FOR, as a question in the shopper's language ("Any particular fit -
   * Slim or Regular?"). Optional: the backend sets it only when one attribute genuinely
   * separates the results, so a mixed row of price and brand chips arrives without one.
   */
  prompt?: string | null;
}

/**
 * One department of the store as a tappable tile (`app/copilot/engine/catalog_overview.py`).
 * `priceFrom` is a string for the same reason `CopilotProductCard.price` is.
 */
export interface CopilotCategoryTile {
  sourceCategoryId: number;
  name: string;
  productCount: number;
  priceFrom?: string | null;
  currency?: string | null;
  imageSrc?: string | null;
  subcategories: string[];
  /** Sent as the shopper's next message when the tile is tapped. */
  message: string;
}

export interface CopilotCategoryGridBlock {
  type: 'category_grid';
  items: CopilotCategoryTile[];
  totalCategories: number;
}

/** Something the shopper should know about the answer itself — most often that a live
 * price or stock check could not be completed. */
export interface CopilotNoticeBlock {
  type: 'notice';
  level: 'info' | 'warning';
  text: string;
}

export interface CopilotCartLine {
  productId: string;
  sourceProductId: number;
  variationId?: number | null;
  name: string;
  productType?: string | null;
  options: Record<string, string>;
  quantity: number;
  maxQuantity?: number | null;
  price?: string | null;
  currency?: string | null;
  cartIds: number[];
  cartKey?: string | null;
  permalink?: string | null;
  cart?: CartHint | null;
}

export interface CopilotCartOfferBlock {
  type: 'cart_offer';
  /** update sets an existing line's quantity; clear empties the cart and has no lines. */
  action: 'add' | 'remove' | 'update' | 'clear';
  lines: CopilotCartLine[];
  offerId: string;
  phase: 'select_product' | 'choose_options' | 'confirm';
  autoExecute?: boolean;
}

export interface CartCommand {
  offerId: string;
  reply: 'confirm' | 'decline';
}
export interface CopilotCartActionBlock {
  type: 'cart_action';
  commandId: string;
  action: 'add' | 'remove' | 'update' | 'clear' | 'view' | 'checkout';
  lines: CopilotCartLine[];
}
export interface CartExecutionResult {
  message: string;
  ok: boolean;
  items: {
    key: string;
    id: number;
    name: string;
    quantity: number;
    variation?: { attribute: string; value: string }[];
  }[];
}

export type CopilotBlock =
  | CopilotCartActionBlock
  | CopilotCartOfferBlock
  | CopilotTextBlock
  | CopilotProductCarouselBlock
  | CopilotProductGridBlock
  | CopilotComparisonBlock
  | CopilotClarificationBlock
  | CopilotRefinementChipsBlock
  | CopilotCategoryGridBlock
  | CopilotNoticeBlock;

/** A stable, machine-readable failure. `code` is part of the API contract; `message` is
 * for humans and may change. Neither ever carries internal detail — a storefront widget
 * is public. */
export interface CopilotApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CopilotConversationResponse {
  conversationId: string;
  /**
   * Returned EXACTLY ONCE, at creation. It is never retrievable again — a credential that
   * can be re-fetched is one that leaks with the first over-permissive log line. Keep it
   * in memory for the life of the conversation and send it as `X-Conversation-Secret`.
   */
  sessionSecret?: string | null;
  stateVersion: number;
}

export interface CopilotMessageResponse {
  messageId: string;
  turnId: string;
  conversationId: string;
  /** A log correlation id, safe to show. Being able to say "this answer was wrong, here
   * is its id" is worth more than the nothing it reveals. */
  traceId?: string | null;
  stateVersion: number;
  blocks: CopilotBlock[];
  error?: CopilotApiError | null;
  /** How much this turn cost and what's left in the wallet. Undefined on a turn that
   * spent no tokens (e.g. a short-circuited reply). */
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
}

export interface CopilotTurnStartedEvent {
  type: 'turn.started';
  sequence: number;
  turnId: string;
  data: { conversationId: string; clientMessageId: string };
}

/** How far the turn has got, in words the shopper can be shown. Sent between
 * `turn.started` and the answer; absent from older backends. */
export interface CopilotTurnProgressEvent {
  type: 'turn.progress';
  sequence: number;
  turnId: string;
  data: { stage: 'searching' | 'verifying' | 'writing'; label: string };
}

export interface CopilotAssistantDeltaEvent {
  type: 'assistant.delta';
  sequence: number;
  turnId: string;
  data: { delta: string };
}

export interface CopilotProductsReadyEvent {
  type: 'products.ready';
  sequence: number;
  turnId: string;
  data: { block: CopilotProductCarouselBlock | CopilotProductGridBlock };
}

export interface CopilotComparisonReadyEvent {
  type: 'comparison.ready';
  sequence: number;
  turnId: string;
  data: { block: CopilotComparisonBlock };
}

export interface CopilotClarificationReadyEvent {
  type: 'clarification.ready';
  sequence: number;
  turnId: string;
  data: { block: CopilotClarificationBlock };
}

export interface CopilotTurnCompletedEvent {
  type: 'turn.completed';
  sequence: number;
  turnId: string;
  data: {
    messageId: string;
    conversationId: string;
    traceId?: string | null;
    stateVersion: number;
    blocks: CopilotBlock[];
    creditsUsed?: number | null;
    creditsRemaining?: number | null;
  };
}

export interface CopilotTurnFailedEvent {
  type: 'turn.failed';
  sequence: number;
  turnId: string;
  data: CopilotApiError;
}

export type CopilotStreamEvent =
  | CopilotTurnStartedEvent
  | CopilotTurnProgressEvent
  | CopilotAssistantDeltaEvent
  | CopilotProductsReadyEvent
  | CopilotComparisonReadyEvent
  | CopilotClarificationReadyEvent
  | CopilotTurnCompletedEvent
  | CopilotTurnFailedEvent;

export interface CopilotConversationMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: CopilotBlock[];
  createdAt: string;
}

export interface CopilotConversationDetail {
  conversationId: string;
  status: string;
  stateVersion: number;
  messages: CopilotConversationMessage[];
}

/** What this store can actually be filtered by, derived from the merchant's own catalog
 * (`GET /api/v1/copilot/catalog/capabilities`). Nothing consumes this yet; it is what a
 * guided-filter UI would be built from, in place of the hardcoded question set that was
 * deleted with the prototype. */
export interface CopilotCatalogCategory {
  id: number;
  name: string;
  productCount: number;
}

export interface CopilotCatalogFilterOption {
  value: string;
  label: string;
  productCount?: number;
}

export interface CopilotCatalogFilter {
  key: string;
  label: string;
  type: string;
  unit?: string | null;
  options?: CopilotCatalogFilterOption[];
  min?: number | null;
  max?: number | null;
}

export interface CopilotCatalogCapabilities {
  categories: CopilotCatalogCategory[];
  filters: CopilotCatalogFilter[];
}

/**
 * The product page the storefront widget is rendered on, as the backend resolved it.
 *
 * `sourceProductId` is WooCommerce's own public id and the only thing the browser knows;
 * `productId` and `name` come back from the catalog after that id was checked against the
 * merchant it belongs to. The name is display-only — every decision about which product a
 * message is about is made server-side from the id.
 */
export interface PageProduct {
  productId: string;
  sourceProductId: number;
  name: string;
}
