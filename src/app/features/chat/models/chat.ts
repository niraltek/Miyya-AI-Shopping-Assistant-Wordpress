import { ComparisonTable, Product } from './product';
import type {
  CopilotCartOfferBlock,
  CopilotCartActionBlock,
  CartExecutionResult,
  CopilotReadinessStatus,
} from './copilot';
import type { LucideIconData } from '@lucide/angular';

/** One node of the visual flow strip shown under the typing bubble. */
export interface FlowStep {
  readonly icon: LucideIconData;
  readonly label: string;
  /** Fixed brand colour, independent of the merchant's theme accent. */
  readonly accent: string;
}

export interface ChatReadiness {
  readonly ready: boolean;
  /** `setup_incomplete` is a client-only onboarding state. */
  readonly status: CopilotReadinessStatus | 'checking' | 'unavailable' | 'setup_incomplete';
  readonly message: string;
}

/** One store department shown as a tile under a "what do you sell?" answer. */
export interface ChatCategoryTile {
  id: number;
  name: string;
  productCount: number;
  /** Lowest published price in the department; null when none is listed. */
  priceFrom: number | null;
  currency: string;
  imageUrl: string;
  subcategories: string[];
  /** Exactly what is sent as the next turn when the tile is tapped. */
  message: string;
}

/**
 * A tappable next step under an answer: a refinement chip or a clarification option.
 * `message` is exactly what is sent as the shopper's next turn.
 */
export interface ChatSuggestion {
  label: string;
  message: string;
}

/**
 * `system` is not something either party said. It marks a change in the conversation's
 * circumstances — today only that the shopper opened a different product page — and is
 * rendered as a centred divider rather than a bubble, with no avatar, timestamp or
 * feedback controls.
 */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  /**
   * `text` rendered as sanitized markdown HTML — see `utils/markdown.ts`.
   *
   * Set once, when the answer is complete, and absent while it is still streaming: partial
   * markdown reinterprets itself as it arrives, so a streaming bubble renders `text` as
   * plain text and only swaps to this when the turn finishes. Absent on user messages,
   * which are shown exactly as typed.
   */
  html?: string;
  time: string;
  /** Present on an assistant message whose answer carried product cards. */
  products?: Product[];
  /** Present on an assistant message reporting a failed product search — shows a Retry button. */
  isSearchError?: boolean;
  /**
   * Present on an assistant message answering a "compare these products" request — the
   * side-by-side comparison table renders from this, frozen at send time so scrolling back to
   * it later never regenerates the comparison against a since-changed selection.
   *
   * The whole table, columns AND rows, rather than just the products: which fields a
   * comparison of these particular products should show is decided by the backend from
   * the merchant's own catalog, and cannot be re-derived from the cards here.
   */
  comparison?: ComparisonTable;
  /**
   * How long this answer took, in milliseconds.
   *
   * Measured in the browser around the request, so it is the wait the shopper actually
   * experienced — network included — rather than the server's own processing time, which
   * is always the smaller number and never the one someone is complaining about.
   */
  durationMs?: number;
  /**
   * The backend's own id for this message (`CopilotMessageResponse.messageId`), distinct
   * from `id` above which is generated client-side purely to `@for track` the bubble.
   *
   * Only set once a real turn has completed — absent on the opening greeting and on a
   * locally-generated error bubble, neither of which the server knows about. Thumbs up/down
   * is only offered when this is present, since `POST .../feedback` needs it to join the
   * verdict back to the turn that produced it.
   */
  serverId?: string;
  /** Follow-up chips and clarification options for this answer, in the order sent. Only the
   * newest assistant message shows them; older ones are history. */
  suggestions?: ChatSuggestion[];
  /** The store's departments, when this answer is a store overview. */
  categories?: ChatCategoryTile[];
  cartOffer?: CopilotCartOfferBlock;
  cartAction?: CopilotCartActionBlock;
  cartResult?: CartExecutionResult;
  /** Which verdict the shopper already gave on this answer, if any — drives the thumbs
   * buttons into their selected/disabled state so a second tap can't double-submit. */
  feedback?: 'up' | 'down';
  /**
   * LLM credits this turn cost the merchant's wallet. wp-admin only — see
   * `ChatComponent.answerTooltip` — a storefront shopper has no reason to see what
   * answering them cost.
   */
  creditsUsed?: number | null;
}

/**
 * In-flight pointer drag of the chat panel.
 *
 * `screenX`/`screenY` are the screen-space start of the drag, used only when embedded in
 * the storefront iframe. There the frame itself moves, which drags the iframe's own
 * viewport along with it — so clientX/clientY shrink as the frame follows the pointer and
 * the panel stutters or stalls. Screen coordinates are unaffected by that.
 */
export interface ChatDragState {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  screenX: number;
  screenY: number;
  originX: number;
  originY: number;
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

/**
 * How far the turn in flight has actually got.
 *
 * Driven by the copilot's own SSE events rather than by a timer. The previous indicator
 * advanced three hardcoded labels every 700ms whatever the server was doing, so it claimed
 * to be "checking live price & availability" on a turn that had already failed, and claimed
 * to be still "understanding your request" on one that had answered — a progress bar that
 * is not connected to progress teaches people to ignore progress bars.
 *
 * - `idle`      nothing in flight
 * - `sent`      request made, no event back yet
 * - `thinking`  `turn.started` — the server has the turn and the planner is running
 * - `searching` a tool round is under way
 * - `found`     `products.ready` / `comparison.ready` — results exist, prose is being written
 */
export type ChatTurnStage = 'idle' | 'sent' | 'thinking' | 'searching' | 'found';

export interface ChatProgressStage {
  stage: ChatTurnStage;
  label: string;
}

export interface ChatSuggestionGroup {
  messageId: string;
  items: ChatSuggestion[];
}

/** One line of the staged loading indicator, derived from `ChatTurnStage`. */
export interface ChatLoadingStep {
  label: string;
  done: boolean;
  /** The step currently happening — exactly one at a time, and never one already `done`. */
  active: boolean;
}
