/**
 * Navigates the top-level browser window, escaping the iframe this app runs in.
 *
 * Both places the plugin renders this app are iframes — the storefront widget, and (for
 * CSS isolation) the wp-admin page, which serves it from admin-post.php. A plain
 * `window.location` assignment therefore navigates the *frame*, which for the two URLs
 * that use this would mean loading WooCommerce's approval screen or a whole second copy
 * of wp-admin inside a box on the page instead of taking the merchant there.
 *
 * Both frames are same-origin with their host, so `window.top` is reachable. The guard
 * is for the case that stops being true (a sandboxed or cross-origin embed), where
 * navigating this frame is still better than going nowhere.
 */
export function navigateTop(url: string): void {
  try {
    (window.top ?? window).location.assign(url);
  } catch {
    window.location.assign(url);
  }
}

/**
 * Where the browser goes after the plugin has started a connection.
 *
 * When the plugin approved the connection itself (the merchant consented on the Connect
 * screen), that is the connected page, so WooCommerce's approve screen never appears. Only
 * a response that says so, with a URL, is believed; anything else - an older plugin, or one
 * that could not approve for this site - falls back to WooCommerce's screen exactly as before.
 */
export function connectDestination(response: {
  authorizationUrl: string;
  autoApproved?: boolean;
  redirectUrl?: string;
}): string {
  return response.autoApproved === true && response.redirectUrl
    ? response.redirectUrl
    : response.authorizationUrl;
}
