import { StoreUrlValidationResult } from '../../features/store/models/woocommerce';

const GENERIC_ERROR = 'Please enter a valid WooCommerce store URL.';

/**
 * Validates and normalizes a merchant-entered WooCommerce store URL.
 *
 * - Adds `https://` when no protocol is given.
 * - Rejects protocols other than http/https.
 * - Requires a plausible hostname (a dot, or `localhost` for local dev stores).
 * - Strips a trailing slash from the path.
 */
export function validateStoreUrl(input: string): StoreUrlValidationResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { valid: false, error: 'Please enter your WooCommerce store URL.' };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, error: GENERIC_ERROR };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: GENERIC_ERROR };
  }

  const hostname = parsed.hostname;
  const isLocalDevHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const looksLikeDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    hostname,
  );

  if (!isLocalDevHost && !looksLikeDomain) {
    return { valid: false, error: GENERIC_ERROR };
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');

  return {
    valid: true,
    url: `${parsed.protocol}//${parsed.host}${normalizedPath}${parsed.search}`,
  };
}

/** Strips the protocol and trailing slash for compact display, e.g. "https://store.com/" -> "store.com". */
export function formatStoreHost(storeUrl: string): string {
  try {
    return new URL(storeUrl).host;
  } catch {
    return storeUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

export function formatConnectedDate(iso?: string): string {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
