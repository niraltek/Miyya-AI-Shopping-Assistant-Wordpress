/**
 * View models for `DashboardComponent`. These are UI shapes, not API contracts — the
 * dashboard folds the catalog-sync and embedding-index status enums the backend returns
 * (see `models/catalog.ts` and `models/embedding.ts`) onto one small set of display
 * states, then describes each card it renders as plain data.
 */

/** One stable display state the technical-status cards render, collapsing both the
 * catalog-sync and embedding-index backend status enums onto the same small set. */
export type IndexDisplayState = 'not_started' | 'queued' | 'syncing' | 'indexing' | 'ready' | 'failed';

/**
 * Steady-state health of the catalog, which is what the dashboard shows the other 99%
 * of the time — a sync run is a brief event, being up to date is the normal condition.
 *
 * 'unknown' is a real state, not a fallback: when the store can't be reached there is no
 * honest comparison to draw, so the UI shows the local count alone rather than inventing
 * a total to compare against.
 */
export type CatalogHealthState = 'unknown' | 'up_to_date' | 'catching_up' | 'behind';

export interface CatalogHealthView {
  state: CatalogHealthState;
  headline: string;
  detail: string;
  /** Products in the store that aren't in the catalog yet. 0 unless state is behind/catching_up. */
  pendingCount: number;
  /** Catalog products with no current embedding — searchable lags synced by design. */
  unindexedCount: number;
  showResync: boolean;
}

export interface StatusCardView {
  label: string;
  state: IndexDisplayState;
  stateLabel: string;
  processed?: number;
  total?: number;
  progressPercent?: number;
  failedCount?: number;
  completedAt?: string;
  showRetry: boolean;
}

/** Drives the icon chip's gradient, so a card's colour reflects real state. */
export type StatTone = 'positive' | 'neutral' | 'warning';
