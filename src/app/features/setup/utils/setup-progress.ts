import { CatalogSyncStatusResponse } from '../../catalog/models/catalog';
import { SubscriptionStatus } from '../../billing/models/subscription';
import {
  CatalogReadiness,
  CatalogReadinessInput,
  SetupCatalogProgress,
  SetupFacts,
  SetupStepId,
  SetupStepView,
  TrialPhase,
} from '../models/setup';
import { MerchantStoreConnection } from '../../store/models/woocommerce';

/**
 * Pure derivations behind the Miyya Setup screen. Kept out of the component so the
 * decisions that matter - is the catalog genuinely search-ready, which step is next - can
 * be tested without a DOM, a timer or a backend.
 */

const STEP_COPY: readonly { id: SetupStepId; title: string; summary: string }[] = [
  { id: 'connect', title: 'Connect store', summary: 'Authorize Miyya to access your store' },
  { id: 'catalog', title: 'Sync catalog', summary: 'Sync your products with Miyya' },
  { id: 'trial', title: 'Free trial', summary: 'Activate your free trial' },
  { id: 'preview', title: 'Test chat', summary: 'Preview and test Miyya' },
  { id: 'launch', title: 'Launch check', summary: 'Check that everything is ready to launch' },
  { id: 'live', title: 'Go live', summary: 'Make Miyya available to your shoppers' },
];

/**
 * The stepper. A step counts as done only when every step before it is - connection lost
 * means nothing after it is reported green, however true its own fact still is - and
 * exactly one step is `current`: the first that is not done.
 */
export function deriveSteps(facts: SetupFacts): SetupStepView[] {
  const flags: Record<SetupStepId, boolean> = {
    connect: facts.connected,
    catalog: facts.catalogDone,
    trial: facts.planDone,
    preview: facts.chatVerified,
    launch: facts.launchChecked,
    live: facts.live,
  };

  let allBefore = true;
  let currentAssigned = false;

  return STEP_COPY.map((copy) => {
    const done = allBefore && flags[copy.id];
    const current = !done && !currentAssigned;
    if (current) currentAssigned = true;
    allBefore = done;

    return { ...copy, done, current };
  });
}

/** Parses an ISO timestamp, or returns null when it is missing or unreadable. */
function time(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether a sync run belongs to the connection that exists now.
 *
 * Run history outlives a disconnect (the products do not), so after a reconnect the last
 * run is an earlier connection's. Showing it as current would report a catalog that has
 * not been imported yet - and stop the first import from starting. A run is current when
 * it began no earlier than the connection; an unreadable timestamp is given the benefit
 * of the doubt, since hiding a real run is the worse mistake.
 */
export function isCurrentRun(
  run: CatalogSyncStatusResponse | null | undefined,
  store: MerchantStoreConnection | null,
): run is CatalogSyncStatusResponse {
  if (!run) return false;
  const started = time(run.startedAt);
  const connected = time(store?.connectedAt);
  return started === null || connected === null || started >= connected;
}

/**
 * The setup screen has one bar for two independent jobs: importing the WooCommerce
 * catalog and making that imported catalog searchable. Their native percentages both
 * begin at zero, so showing either one directly made the bar appear to go backwards at
 * the hand-off (for example, import 89% -> indexing 85%).
 *
 * Reserve most of the journey for the import and the final fifth for AI indexing. This
 * is a display model only: product counters remain the source of truth in the copy
 * below the bar. A component also retains the highest value it has rendered, which
 * protects the UI from an eventually-consistent poll returning an older count.
 */
export function deriveSetupCatalogProgress(
  readiness: Extract<CatalogReadiness, { state: 'syncing' }>,
): SetupCatalogProgress {
  const stagePercent = readiness.percent;
  const fraction = stagePercent === null ? 0 : Math.max(0, Math.min(99, stagePercent)) / 100;

  if (readiness.stage === 'import') {
    return {
      stage: 'import',
      stagePercent,
      overallPercent: Math.round(fraction * 80),
    };
  }

  return {
    stage: 'index',
    stagePercent,
    overallPercent: Math.min(99, 80 + Math.round(fraction * 19)),
  };
}

function percentOf(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(99, Math.round((done / total) * 100));
}

/**
 * Is the catalog search-ready?
 *
 * Ready needs both halves: the import finished, and the imported products were indexed for
 * AI search. A finished import with an index still running is `syncing`, not ready - the
 * chat would answer from a catalog it cannot search yet.
 */
export function deriveCatalogReadiness(input: CatalogReadinessInput): CatalogReadiness {
  const { store, status } = input;
  const counts = status?.catalogCounts;
  const retained = isCurrentRun(status?.catalogSync, store) ? status!.catalogSync! : null;
  const sync = input.run ?? retained;

  if (!sync) {
    // No run information, but the connection says the first import completed (history
    // pruned, or a fresh page that has not fetched it yet): the live counts decide.
    if (store?.catalogStatus && (counts?.productsIndexed ?? 0) > 0) {
      return { state: 'ready', products: counts?.productsSynced ?? counts!.productsIndexed };
    }
    return { state: 'idle' };
  }

  if (sync.status === 'queued' || sync.status === 'running') {
    const total = sync.expectedTotal ?? null;
    return {
      state: 'syncing',
      stage: 'import',
      processed: sync.productsReceived,
      total,
      percent: percentOf(sync.productsReceived, total),
    };
  }

  if (sync.status === 'failed') {
    return {
      state: 'failed',
      stage: 'import',
      message: sync.currentMessage || 'The product import did not finish.',
    };
  }

  const synced = counts?.productsSynced ?? sync.productsCreated + sync.productsUpdated;
  const indexed = counts?.productsIndexed ?? 0;
  const failedCount = Math.max(sync.productsFailed, sync.errors?.length ?? 0);

  if (synced === 0) {
    return failedCount > 0
      ? {
          state: 'failed',
          stage: 'import',
          message: `None of the ${failedCount} products could be imported.`,
        }
      : { state: 'empty' };
  }

  // An index run left over from an earlier connection says nothing about this catalog.
  const embeddingStart = time(status?.embeddingIndex?.startedAt);
  const syncStart = time(sync.startedAt);
  const embedding =
    status?.embeddingIndex &&
    (embeddingStart === null || syncStart === null || embeddingStart >= syncStart)
      ? status.embeddingIndex
      : null;

  if (embedding?.status === 'failed') {
    return {
      state: 'failed',
      stage: 'index',
      message: embedding.error || 'Indexing the products for AI search did not finish.',
    };
  }

  const indexing =
    embedding?.status === 'queued' ||
    embedding?.status === 'indexing' ||
    // The import is over but its index run has not been created yet, or has not embedded
    // anything: still preparing, not finished.
    (indexed === 0 && embedding?.status !== 'ready');

  if (indexing) {
    const total = embedding?.totalProducts ?? synced;
    return {
      state: 'syncing',
      stage: 'index',
      processed: embedding?.processedProducts ?? indexed,
      total,
      percent: embedding?.progressPercent ?? percentOf(indexed, total),
    };
  }

  if (sync.status === 'completed_with_errors' || failedCount > 0) {
    return { state: 'partial', usable: indexed, failed: failedCount, errors: sync.errors ?? [] };
  }

  return { state: 'ready', products: synced };
}

/** What the free-trial step shows. `loaded` is false until the entitlement was asked for. */
export function deriveTrialPhase(status: SubscriptionStatus | null, loaded: boolean): TrialPhase {
  if (!status) return loaded ? 'unknown' : 'loading';
  if (status.storeLinkStatus === 'pending' || status.reason === 'awaiting_owner_approval')
    return 'approval_required';
  if (status.storeLinkStatus === 'rejected') return 'approval_rejected';
  // Billing switched off: the product works for everyone and there is nothing to start.
  if (!status.enforced) return 'not_required';
  if (status.reason === 'account_frozen') return 'frozen';
  if (status.allowed) return 'active';
  if (status.reason === 'trial_waitlisted') return 'waitlisted';
  if (status.reason === 'trial_expired') return 'expired';
  return 'available';
}
