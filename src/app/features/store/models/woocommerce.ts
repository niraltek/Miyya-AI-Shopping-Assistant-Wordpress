/**
 * Shared WooCommerce connection types, mirroring the shapes the backend
 * serialises so this client and the API agree on one contract.
 */

import { CatalogSyncSummary } from '../../catalog/models/catalog';
import { WidgetLayoutFormat } from './widget-layout';

export type ConnectionPlatform = 'woocommerce';

export type ConnectionPermission = 'read';

/** Lifecycle of a single store connection attempt/record. */
export type ConnectionStatus = 'checking' | 'connected' | 'pending' | 'failed' | 'revoked';

export interface WooCommerceConnectRequest {
  /** Identifies the merchant — the backend has no session of any kind. */
  email: string;
  storeUrl: string;
  storeName?: string;
  /**
   * wp-admin page WooCommerce should return the merchant's browser to. The
   * backend requires this to be on the same host as storeUrl.
   */
  returnUrl?: string;
  /** Whether the plugin should approve the read-only key itself or show WooCommerce's approval page. */
  approvalMode?: 'automatic' | 'manual';
  /** Explicitly creates a separate store after the merchant reviews an identity conflict. */
  connectionMode?: 'connect' | 'separate';
  /** Original Store Code explicitly chosen by the merchant for a legacy migration. */
  migrationSourceCode?: string;
}

export interface StoreIdentityConflict {
  code: 'STORE_IDENTITY_CONFLICT';
  message: string;
  handshakeId?: string | null;
}

export interface WooCommerceConnectResponse {
  /** WooCommerce's own approve screen. Only used when the plugin could not approve itself. */
  authorizationUrl: string;
  /**
   * The plugin already approved this connection for the merchant (who consented on the
   * Connect screen), so there is no approve screen to visit. `redirectUrl` is the connected
   * page to go to instead.
   */
  autoApproved?: boolean;
  redirectUrl?: string;
  /** Why the plugin could not approve it itself, when it could not. Never a secret. */
  autoApproveReason?: string;
}

/**
 * A connected store record. `maskedConsumerKey` is the only credential fragment
 * ever sent to a frontend, already masked server-side (e.g. "ck_************8F2A").
 * The Consumer Secret is never returned by the backend to any client.
 */
export interface MerchantStoreConnection {
  storeId?: string;
  merchantEmail?: string;
  name?: string;
  storeUrl: string;
  platform: ConnectionPlatform;
  status: ConnectionStatus;
  /** Fixed read-only protocol scope; no per-store database permission column. */
  permission: ConnectionPermission;
  connectedAt?: string;
  maskedConsumerKey?: string;
  /** Summary of the most recent catalog sync, if one has ever run. */
  catalogSync?: CatalogSyncSummary;
  /** True once a catalog sync has completed at least once for this store. */
  catalogStatus?: boolean;
  /**
   * When SMTP accepted the welcome email; this does not confirm inbox delivery.
   * Existing accounts may not need another welcome email: check portalInviteStatus.
   */
  portalInviteSentAt?: string;
  portalInviteStatus?: 'smtp_accepted' | 'not_required' | 'pending';
  /** Where that email's credentials are used. */
  portalLoginUrl?: string;
  /** First time a portal user of this store signed in; absent until someone has. */
  portalSignedInAt?: string;
}

export interface WooCommerceConnectionStatusResponse {
  status: ConnectionStatus;
  store?: MerchantStoreConnection;
}

export interface StoreUrlValidationResult {
  valid: boolean;
  /** Normalized URL, only present when valid. */
  url?: string;
  error?: string;
}

/**
 * Runtime config the WordPress plugin injects before the Angular bundle
 * executes. The Window augmentation lives in src/global.d.ts so both the app
 * and the spec TypeScript programs pick it up (tsconfig.spec.json only
 * includes *.d.ts and *.spec.ts).
 */
export interface AIAssistantConfig {
  route: string;
  apiBaseUrl?: string;
  /**
   * True only inside the storefront widget iframe, whose host page owns the frame's
   * size and position (see class-frontend-widget.php's resize script).
   *
   * Both places the app runs are now iframes — wp-admin serves it framed too, for CSS
   * isolation — so `window.parent !== window` no longer distinguishes them and would
   * put the admin Chat screen into widget mode, posting resize messages to a host with
   * no listener. The plugin states which frame this is instead of the app guessing.
   */
  embedded?: boolean;
  /**
   * Set only in the storefront frame, and only for `left`/`right`: the rail this frame
   * is docked as. The PHP host has already anchored and sized the frame from it before
   * the bundle boots, so it is injected rather than fetched. Absent means classic.
   */
  widgetLayout?: WidgetLayoutFormat;
  /**
   * URL of the bundle's own directory (dist/plugin-frontend/browser/), so components can
   * build absolute URLs for assets shipped alongside it (e.g. images/). A plain relative
   * src resolves against the current wp-admin page, not this folder, and 404s.
   */
  assetsBaseUrl?: string;
  /** WordPress admin email — the merchant identity for every backend call. */
  email?: string;
  /** The merchant's own site URL, from get_site_url(). */
  storeUrl?: string;
  /** WooCommerce's numeric product id when this storefront page is a single product. */
  viewingProductSourceId?: number;
  /**
   * Storefront only, and only with WooCommerce active: the Store API root
   * (`/wp-json/wc/store/v1/`) the chat's "Add to cart" calls with the shopper's own cart
   * cookie. No nonce rides along — the page may be served from a cache, so `CartService`
   * fetches a fresh one at click time.
   */
  storeApiUrl?: string;
  /** Storefront only: WooCommerce's cart page, for "View cart" after an add. */
  cartUrl?: string;
  checkoutUrl?: string;
  /**
   * Storefront only, with WooCommerce active: the store's own endpoint that returns a
   * short-lived token proving the visitor is a logged-in customer (`{token: null}` for a
   * guest). Asked at send time and never baked into the page, which may be cached.
   */
  shopperTokenUrl?: string;
  /** This site's title, from get_bloginfo('name') — pre-fills the connect form's store name. */
  storeName?: string;
  /**
   * The backend's single-use provisioning token, when WooCommerce's redirect carried
   * one. It arrives on the *top-level* wp-admin URL, which this app cannot read from
   * inside its frame, so PHP forwards it here — see AA_Admin_App::FORWARDED_PARAMS.
   */
  provisionToken?: string | null;
  /**
   * True when the Miyya portal sent the merchant to Catalog Sync to start the import
   * (`aaAutoSync=1` on the top-level URL, forwarded by PHP): the screen then begins the
   * sync on arrival instead of asking for a second click.
   */
  autoSync?: boolean;
  /** Absolute wp-admin URL of the "connected" page, used as the return URL. */
  connectedUrl?: string;
  /** Absolute wp-admin dashboard URL. */
  dashboardUrl?: string;
  /**
   * Absolute wp-admin URL of Miyya Setup. The connection success page hands the merchant
   * to it (top-level, so the address bar follows) and a failed connection returns there to
   * retry.
   */
  setupUrl?: string;
  /**
   * This site's OWN WordPress REST route that registers the product webhooks keeping
   * the backend catalog live — not a backend URL. Registration happens in PHP via
   * WC_Webhook precisely so the WooCommerce connection can stay read-only; see
   * wordpress-plugin/includes/class-webhook-registrar.php.
   */
  webhookRegisterUrl?: string;
  /** Local WordPress proxy; merchant bearer tokens remain on the PHP server. */
  merchantApiUrl?: string;
  /**
   * This site's own REST route for disconnecting the store. Revoking requires the site
   * token, which lives in wp_options and never reaches the browser, so the SPA asks PHP
   * to make the call rather than calling the backend itself.
   */
  webhookDisconnectUrl?: string;
  /** wp_rest nonce authenticating the SPA to the two routes above as the logged-in admin. */
  restNonce?: string;
  /**
   * Whether this WordPress still holds the site token that authorises the privileged
   * backend calls (disconnect, and provisioning the webhook secret).
   *
   * Only the boolean crosses to the browser — never the token itself. It is here because
   * the token is lost far more often than the connection is: deleting the plugin runs
   * uninstall.php, and pointing the site at a different backend origin severs the link,
   * either of which leaves a store the backend still reports as `connected` while this
   * WordPress can no longer act on it. Without this flag that state is invisible until
   * the merchant clicks Disconnect and gets a 409, which reads as a bug rather than as
   * "reconnect to restore the link".
   * This is a page-load snapshot: the authenticated connection check can recover the
   * token afterwards. WebhookService tracks that confirmation reactively for Settings.
   */
  hasSiteToken?: boolean;
}

/**
 * The merchant identity every backend call re-sends. There is no login and no session:
 * this pair is what scopes a caller to one `store` row, and the plugin injects
 * both into `AIAssistantConfig` above.
 *
 * A type alias rather than an interface: it is handed straight to HttpClient as `params`,
 * and only a type alias picks up the implicit index signature that assignment needs.
 */
export type MerchantIdentity = {
  email: string;
  storeUrl: string;
};

/* --- View models: UI-only shapes for the connection screens, not backend contracts. --- */

/** Where `ConnectComponent`'s form is in the handshake it kicks off. */
export type ConnectStatus = 'idle' | 'connecting' | 'redirecting' | 'error';

/**
 * What `ConnectedComponent` shows while it polls connection status. 'checking' covers the
 * backend's `pending` too — verification runs in the worker, so the browser can land here
 * before the connection has been confirmed.
 */
export type ConnectedViewState = 'checking' | 'connected' | 'failed';

/** One label/value line in the connection summary. */
export interface ConnectionDetailRow {
  label: string;
  value: string;
}
