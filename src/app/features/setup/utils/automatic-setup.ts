const STORAGE_PREFIX = 'aa_automatic_setup:';

/** Shared by both connect screens so the choice survives WooCommerce's full-page redirect. */
export function rememberAutomaticSetup(storeUrl: string, enabled: boolean): void {
  if (!storeUrl) return;
  try {
    const key = `${STORAGE_PREFIX}${encodeURIComponent(storeUrl)}`;
    if (enabled) localStorage.setItem(key, 'accepted');
    else localStorage.removeItem(key);
  } catch {}
}

export function readAutomaticSetup(storeUrl: string): boolean {
  if (!storeUrl) return false;
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${encodeURIComponent(storeUrl)}`) === 'accepted';
  } catch {
    return false;
  }
}
