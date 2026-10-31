/**
 * Embedding-index types, mirroring app/schemas/embedding.py so this client and the API
 * agree on one contract. Modeled directly on models/catalog.ts's shapes.
 */

import { CatalogSyncStatusResponse } from './catalog';

export type EmbeddingIndexStatus = 'queued' | 'indexing' | 'ready' | 'failed';

export interface EmbeddingIndexStatusResponse {
  indexRunId: string;
  status: EmbeddingIndexStatus;
  totalProducts?: number;
  processedProducts: number;
  embeddedProducts: number;
  updatedProducts: number;
  unchangedProducts: number;
  failedProducts: number;
  progressPercent: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Live catalog counts, counted per request — as opposed to the per-run figures on
 * CatalogSyncStatusResponse, which describe one sync attempt and never change again.
 *
 * This distinction is the whole point of the type. Webhooks keep the catalog current
 * without ever writing a sync run, so on a healthy store the run figures start going
 * stale the moment the first product is edited; a store that synced 72 products and then
 * added one would keep reporting "72 products" forever if the UI read the run.
 */
export interface CatalogCounts {
  /**
   * What the merchant's own store reports having. Undefined means UNKNOWN — the store
   * couldn't be reached, isn't connected, or rejected the credentials — never zero.
   * Treat it as "no comparison available" and show the local counts alone; rendering it
   * as 0 turns a network blip into a false "everything is out of sync" warning.
   */
  productsInStore?: number;
  productsSynced: number;
  productsIndexed: number;
}

/** Either run half is undefined when that process has never run for this merchant.
 *  catalogCounts is always present once a connection resolves. */
export interface MerchantIndexStatusResponse {
  catalogSync?: CatalogSyncStatusResponse;
  embeddingIndex?: EmbeddingIndexStatusResponse;
  catalogCounts?: CatalogCounts;
}

export interface EmbeddingReindexResponse {
  indexRunId: string;
  status: EmbeddingIndexStatus;
}
