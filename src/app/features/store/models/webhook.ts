/**
 * Shapes for product-webhook registration. Unlike the other model files these do not
 * mirror a backend contract: `WebhookService` talks to the merchant's OWN WordPress
 * (the plugin's `ai-assistant/v1/webhooks/register` route), which creates the webhooks
 * locally through WC_Webhook — that is what keeps the WooCommerce connection read-only.
 */

export type WebhookRegistrationOutcome = 'registered' | 'skipped' | 'not-connected' | 'failed';

export interface WebhookRegistrationResult {
  outcome: WebhookRegistrationOutcome;
  topics?: string[];
  message?: string;
}

/**
 * How far the post-connect webhook registration has got, as the success screen sees it.
 * Surfaced in the UI only when it settles on 'unavailable' — every other value keeps the
 * success screen exactly as it was before this existed.
 */
export type WebhookSetupState = 'pending' | 'registered' | 'unavailable';

export interface StoreDisconnectResponse {
  ok: boolean;
  message?: string;
  reason?: string;
}
