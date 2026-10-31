/**
 * The merchant's own entitlement, as reported by
 * `GET /api/v1/woocommerce/subscription-status` through the plugin's proxy route.
 *
 * Mirrors `StoreSubscriptionStatusResponse` in backend/app/schemas/store.py. It carries
 * no Stripe identifiers and no amounts: the plugin has no billing screen, only a banner
 * that explains the state and a link out to the portal.
 */
export interface SubscriptionStatus {
  /** False while the backend has enforcement switched off — show nothing at all. */
  enforced: boolean;
  /** The only field the UI branches on for "does the product work". */
  allowed: boolean;
  state: 'enabled' | 'grace' | 'restricted' | 'disabled' | string;
  reason: string;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  remainingTrialDays: number;
  currentPeriodEnd: string | null;
  accessUntil: string | null;
  cancelAtPeriodEnd: boolean;
  manageUrl: string;
  /**
   * Spendable credits of this store's billing wallet, or 0 whenever a new AI turn would
   * be refused. Independent of `allowed`: a paid or trial store that cannot answer right
   * now still has `allowed: true`, and `reason` says why - `credits_exhausted`,
   * `trial_usage_limit`, `trial_daily_limit` - so the banner can tell "you need to pay"
   * apart from "you need to recharge" or "wait until tomorrow".
   */
  creditsRemaining: number;
  /** True once this connection has completed its first catalog import. */
  catalogReady: boolean;
  /** Backend-owned decision used by the storefront widget and chat composer. */
  assistantReady: boolean;
  /** Account membership is independent of WooCommerce connection and trial capacity. */
  storeLinkStatus?: 'linked' | 'pending' | 'rejected' | null;
  notice?: SubscriptionNotice | null;
  setupMessage?: string | null;
}

/** What the banner renders. `null` means there is nothing worth saying. */
export interface SubscriptionNotice {
  tone: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  actionLabel: string;
}
