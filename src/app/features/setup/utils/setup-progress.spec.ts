import { CatalogSyncStatusResponse } from '../../catalog/models/catalog';
import {
  EmbeddingIndexStatusResponse,
  MerchantIndexStatusResponse,
} from '../../catalog/models/embedding';
import { SubscriptionStatus } from '../../billing/models/subscription';
import { MerchantStoreConnection } from '../../store/models/woocommerce';
import {
  deriveCatalogReadiness,
  deriveSetupCatalogProgress,
  deriveSteps,
  deriveTrialPhase,
  isCurrentRun,
} from './setup-progress';

const store = {
  storeUrl: 'https://shop.example.com',
  platform: 'woocommerce',
  status: 'connected',
  permission: 'read',
  connectedAt: '2026-10-10T10:00:00Z',
} as MerchantStoreConnection;

function run(overrides: Partial<CatalogSyncStatusResponse> = {}): CatalogSyncStatusResponse {
  return {
    syncRunId: 'run-1',
    status: 'completed',
    pagesProcessed: 1,
    productsReceived: 10,
    productsCreated: 10,
    productsUpdated: 0,
    productsFailed: 0,
    productsSkipped: 0,
    startedAt: '2026-10-10T10:05:00Z',
    errors: [],
    ...overrides,
  };
}

function embedding(
  overrides: Partial<EmbeddingIndexStatusResponse> = {},
): EmbeddingIndexStatusResponse {
  return {
    indexRunId: 'idx-1',
    status: 'ready',
    totalProducts: 10,
    processedProducts: 10,
    embeddedProducts: 10,
    updatedProducts: 0,
    unchangedProducts: 0,
    failedProducts: 0,
    progressPercent: 100,
    startedAt: '2026-10-10T10:06:00Z',
    ...overrides,
  };
}

function status(
  parts: Partial<MerchantIndexStatusResponse> & { synced?: number; indexed?: number } = {},
): MerchantIndexStatusResponse {
  const { synced = 10, indexed = 10, ...rest } = parts;
  return {
    catalogSync: run(),
    embeddingIndex: embedding(),
    catalogCounts: { productsSynced: synced, productsIndexed: indexed },
    ...rest,
  };
}

describe('deriveCatalogReadiness', () => {
  it('is idle before any import exists for this connection', () => {
    expect(deriveCatalogReadiness({ store, status: null, run: null })).toEqual({ state: 'idle' });
  });

  it('ignores a run that belongs to an earlier connection', () => {
    const old = run({ startedAt: '2026-10-01T09:00:00Z' });
    expect(isCurrentRun(old, store)).toBe(false);
    expect(
      deriveCatalogReadiness({ store, status: status({ catalogSync: old }), run: null }),
    ).toEqual({ state: 'idle' });
  });

  it('reports the import progress while it runs', () => {
    const result = deriveCatalogReadiness({
      store,
      status: null,
      run: run({ status: 'running', expectedTotal: 40, productsReceived: 10 }),
    });
    expect(result).toEqual({
      state: 'syncing',
      stage: 'import',
      processed: 10,
      total: 40,
      percent: 25,
    });
  });

  it('is not ready while the products are still being indexed', () => {
    const result = deriveCatalogReadiness({
      store,
      status: status({
        indexed: 3,
        embeddingIndex: embedding({
          status: 'indexing',
          processedProducts: 3,
          progressPercent: 30,
        }),
      }),
      run: null,
    });
    expect(result).toMatchObject({ state: 'syncing', stage: 'index', percent: 30 });
  });

  it('waits for the index run when the import has finished but nothing is indexed yet', () => {
    const result = deriveCatalogReadiness({
      store,
      status: status({ indexed: 0, embeddingIndex: undefined }),
      run: null,
    });
    expect(result).toMatchObject({ state: 'syncing', stage: 'index' });
  });

  it('does not trust an index run that predates this import', () => {
    const result = deriveCatalogReadiness({
      store,
      status: status({
        indexed: 0,
        embeddingIndex: embedding({ startedAt: '2026-10-10T10:01:00Z' }),
      }),
      run: null,
    });
    expect(result).toMatchObject({ state: 'syncing', stage: 'index' });
  });

  it('is ready once imported and indexed with nothing failed', () => {
    expect(deriveCatalogReadiness({ store, status: status(), run: null })).toEqual({
      state: 'ready',
      products: 10,
    });
  });

  it('is partial when some products failed, and counts what is usable', () => {
    const errors = [
      {
        id: 'e1',
        sourceProductId: 7,
        errorMessage: 'bad price',
        createdAt: '2026-10-10T10:05:30Z',
      },
    ];
    const result = deriveCatalogReadiness({
      store,
      status: status({
        indexed: 9,
        synced: 9,
        catalogSync: run({ status: 'completed_with_errors', productsFailed: 1, errors }),
      }),
      run: null,
    });
    expect(result).toEqual({ state: 'partial', usable: 9, failed: 1, errors });
  });

  it('fails when the import fails or the index fails, naming the stage', () => {
    expect(
      deriveCatalogReadiness({
        store,
        status: null,
        run: run({ status: 'failed', currentMessage: 'Store unreachable' }),
      }),
    ).toEqual({ state: 'failed', stage: 'import', message: 'Store unreachable' });

    expect(
      deriveCatalogReadiness({
        store,
        status: status({ embeddingIndex: embedding({ status: 'failed', error: 'quota' }) }),
        run: null,
      }),
    ).toEqual({ state: 'failed', stage: 'index', message: 'quota' });
  });

  it('is empty for a store with no products, and failed when every product failed', () => {
    expect(
      deriveCatalogReadiness({ store, status: status({ synced: 0, indexed: 0 }), run: null }),
    ).toEqual({ state: 'empty' });

    expect(
      deriveCatalogReadiness({
        store,
        status: status({
          synced: 0,
          indexed: 0,
          catalogSync: run({ status: 'completed_with_errors', productsFailed: 4 }),
        }),
        run: null,
      }),
    ).toMatchObject({ state: 'failed', stage: 'import' });
  });
});

describe('deriveSetupCatalogProgress', () => {
  it('maps the import and indexing jobs onto one forward-only journey', () => {
    const importing = deriveSetupCatalogProgress({
      state: 'syncing',
      stage: 'import',
      processed: 89,
      total: 100,
      percent: 89,
    });
    const indexing = deriveSetupCatalogProgress({
      state: 'syncing',
      stage: 'index',
      processed: 85,
      total: 100,
      percent: 85,
    });

    expect(importing.overallPercent).toBe(71);
    expect(indexing.overallPercent).toBe(96);
    expect(indexing.overallPercent).toBeGreaterThan(importing.overallPercent);
  });

  it('holds the stage boundary when indexing has not reported a count yet', () => {
    expect(
      deriveSetupCatalogProgress({
        state: 'syncing',
        stage: 'index',
        processed: 0,
        total: 10,
        percent: null,
      }),
    ).toMatchObject({ overallPercent: 80, stagePercent: null });
  });
});

describe('deriveTrialPhase', () => {
  const base: SubscriptionStatus = {
    enforced: true,
    allowed: false,
    state: 'disabled',
    reason: 'no_subscription',
    subscriptionStatus: null,
    trialEndsAt: null,
    remainingTrialDays: 0,
    currentPeriodEnd: null,
    accessUntil: null,
    cancelAtPeriodEnd: false,
    manageUrl: 'https://portal.example.com/layout/billing',
    creditsRemaining: 0,
    catalogReady: true,
    assistantReady: false,
  };

  it('distinguishes not asked yet from could not be read', () => {
    expect(deriveTrialPhase(null, false)).toBe('loading');
    expect(deriveTrialPhase(null, true)).toBe('unknown');
  });

  it('needs no trial when billing is switched off', () => {
    expect(deriveTrialPhase({ ...base, enforced: false, allowed: true }, true)).toBe(
      'not_required',
    );
  });

  it('maps each entitlement reason onto its own phase', () => {
    expect(deriveTrialPhase(base, true)).toBe('available');
    expect(deriveTrialPhase({ ...base, allowed: true, reason: 'trial_active' }, true)).toBe(
      'active',
    );
    expect(deriveTrialPhase({ ...base, allowed: true, reason: 'paid' }, true)).toBe('active');
    expect(deriveTrialPhase({ ...base, reason: 'trial_waitlisted' }, true)).toBe('waitlisted');
    expect(deriveTrialPhase({ ...base, reason: 'trial_expired' }, true)).toBe('expired');
    expect(deriveTrialPhase({ ...base, reason: 'account_frozen' }, true)).toBe('frozen');
  });

  it('requires account approval for a new domain even when billing is disabled', () => {
    expect(
      deriveTrialPhase({ ...base, storeLinkStatus: 'pending' } as SubscriptionStatus, true),
    ).toBe('approval_required');
    expect(
      deriveTrialPhase(
        {
          ...base,
          enforced: false,
          allowed: true,
          storeLinkStatus: 'pending',
        } as SubscriptionStatus,
        true,
      ),
    ).toBe('approval_required');
    expect(
      deriveTrialPhase({ ...base, storeLinkStatus: 'linked' } as SubscriptionStatus, true),
    ).toBe('available');
  });
});

describe('deriveSteps', () => {
  const none = {
    connected: false,
    catalogDone: false,
    planDone: false,
    chatVerified: false,
    launchChecked: false,
    live: false,
  };

  it('makes the first unfinished step the current one', () => {
    const steps = deriveSteps({ ...none, connected: true });
    expect(steps.filter((step) => step.done).map((step) => step.id)).toEqual(['connect']);
    expect(steps.find((step) => step.current)?.id).toBe('catalog');
  });

  it('never reports a step done after one that is not', () => {
    const steps = deriveSteps({ ...none, connected: false, catalogDone: true, planDone: true });
    expect(steps.some((step) => step.done)).toBe(false);
    expect(steps[0].current).toBe(true);
  });

  it('has no current step once everything is done', () => {
    const steps = deriveSteps({
      connected: true,
      catalogDone: true,
      planDone: true,
      chatVerified: true,
      launchChecked: true,
      live: true,
    });
    expect(steps.every((step) => step.done)).toBe(true);
    expect(steps.some((step) => step.current)).toBe(false);
  });
});
