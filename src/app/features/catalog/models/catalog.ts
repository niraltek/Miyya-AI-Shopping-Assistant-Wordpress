/**
 * Catalog-sync types, mirroring the shapes the backend serialises so this client and
 * the API agree on one contract. Ported from the React app's src/types/catalog.ts.
 */

export type CatalogSyncStatus =
  'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed';

export type CatalogSyncStage =
  'preparing' | 'fetching' | 'normalizing' | 'storing' | 'completed' | 'failed';

/** The four visible steps of a sync, in order — shared by the idle preview and the live run. */
export const CATALOG_SYNC_STAGE_KEYS: readonly CatalogSyncStage[] = [
  'preparing',
  'fetching',
  'normalizing',
  'storing',
];

export const CATALOG_SYNC_STAGE_LABELS: Record<string, string> = {
  preparing: 'Preparing',
  fetching: 'Fetching Products',
  normalizing: 'Normalizing',
  storing: 'Storing Catalog',
};

export const CATALOG_SYNC_STAGE_DESCRIPTIONS: Record<string, string> = {
  preparing: 'Checking store details and permissions',
  fetching: 'Loading products, categories and variations',
  normalizing: 'Processing product data',
  storing: 'Saving products to your catalog',
};

/** The reassurances shown beside a sync: on the idle card, and under the scope panel during a run. */
export const CATALOG_SYNC_TRUST_POINTS: readonly string[] = [
  'Read-only — your products, prices and stock are never modified',
  'Runs in the background; you can leave this page',
  'Failed products are recorded individually and can be retried',
];

export interface CatalogSyncError {
  id: string;
  sourceProductId?: number;
  pageNumber?: number;
  errorStage?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface CatalogSyncStatusResponse {
  syncRunId: string;
  status: CatalogSyncStatus;
  currentStage?: CatalogSyncStage;
  currentMessage?: string;
  expectedTotal?: number;
  pagesProcessed: number;
  lastPage?: number;
  productsReceived: number;
  productsCreated: number;
  productsUpdated: number;
  productsFailed: number;
  productsSkipped: number;
  startedAt?: string;
  completedAt?: string;
  errors: CatalogSyncError[];
}

export interface CatalogSyncStartResponse {
  syncRunId: string;
  status: CatalogSyncStatus;
}

/** Compact latest-sync summary embedded in the connection-status response. */
export interface CatalogSyncSummary {
  syncRunId: string;
  status: CatalogSyncStatus;
  productsCreated: number;
  productsUpdated: number;
  productsFailed: number;
  completedAt?: string;
}

/**
 * Body the backend returns with HTTP 409 when a sync is already running. The id lets
 * the UI jump straight to the in-flight run instead of reporting a dead-end error.
 */
export interface CatalogSyncAlreadyRunningBody {
  detail: string;
  syncRunId: string;
}

/* --- View models: UI-only shapes for the catalog-sync screens, not backend contracts. --- */

/** What `CatalogSyncComponent` (the consent screen) is currently able to render. */
export type CatalogSyncViewState = 'loading' | 'ready' | 'no-store';

export interface CatalogScopeItem {
  title: string;
  detail: string;
}

/** State of one step in `CatalogProgressComponent`'s stage stepper. */
export type CatalogSyncStepState = 'done' | 'active' | 'pending' | 'error';

/** One counter tile in the sync-progress stats grid. */
export interface CatalogSyncCounterTile {
  label: string;
  value: number;
  /** Which glyph the tile shows; the template maps each name to an icon. */
  icon: 'box' | 'file' | 'refresh' | 'alert' | 'hourglass' | 'layers';
  /** 'plain' stays neutral; 'good'/'bad' colour the number when it is non-zero. */
  tone: 'plain' | 'good' | 'bad';
}
