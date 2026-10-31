import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideBoxes,
  LucideDatabase,
  LucideClock,
  LucideListChecks,
  LucidePackage,
  LucidePlugZap,
  LucideRefreshCw,
  LucideSparkles,
  LucideStore,
} from '@lucide/angular';
import { formatConnectedDate, formatStoreHost } from '../../../../shared/utils/validation';
import {
  CatalogCounts,
  EmbeddingIndexStatus,
  MerchantIndexStatusResponse,
} from '../../../catalog/models/embedding';
import { EmbeddingService } from '../../../catalog/services/embedding-service/embedding-service';
import { ConnectionStatus, MerchantStoreConnection } from '../../../store/models/woocommerce';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import {
  CatalogHealthView,
  IndexDisplayState,
  StatTone,
  StatusCardView,
} from '../../models/dashboard';

const INDEX_DISPLAY_LABELS: Record<IndexDisplayState, string> = {
  not_started: 'Not started',
  queued: 'Queued',
  syncing: 'Syncing…',
  indexing: 'Indexing…',
  ready: 'Ready',
  failed: 'Failed',
};

const INDEX_POLL_INTERVAL_MS = 2000;

const INDEX_FAST_POLL_WINDOW_MS = 30000;

const INDEX_SLOW_POLL_INTERVAL_MS = 10000;

const INDEX_STALE_POLL_WINDOW_MS = 120000;

const INDEX_STALE_POLL_INTERVAL_MS = 30000;

const INDEX_ERROR_MAX_INTERVAL_MS = 30000;

const DRIFT_POLL_INTERVAL_MS = 5000;

const DRIFT_GRACE_PERIOD_MS = 120000;

const ACTIVE_CATALOG_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

const ACTIVE_EMBEDDING_STATUSES: ReadonlySet<EmbeddingIndexStatus> = new Set([
  'queued',
  'indexing',
]);

const TONE_CLASSES: Record<StatTone, string> = {
  positive: 'from-emerald-400 to-emerald-600 shadow-emerald-500/25',
  neutral: 'from-accent-400 to-accent-600 shadow-accent-500/25',
  warning: 'from-amber-400 to-amber-600 shadow-amber-500/25',
};

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  checking: 'Checking…',
  connected: 'Connected',
  pending: 'Pending approval',
  failed: 'Not connected',
  revoked: 'Not connected',
};

@Component({
  imports: [
    DatePipe,
    RouterLink,
    LucideArrowRight,
    LucideBoxes,
    LucideDatabase,
    LucideClock,
    LucideListChecks,
    LucidePackage,
    LucidePlugZap,
    LucideRefreshCw,
    LucideSparkles,
    LucideStore,
  ],
  selector: 'app-dashboard-component',
  styleUrl: './dashboard-component.scss',
  templateUrl: './dashboard-component.html',
  host: {
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly woocommerce = inject(WooCommerceService);
  private readonly embeddingService = inject(EmbeddingService);
  private readonly connectionStatus = signal<ConnectionStatus>('checking');
  protected readonly connectionError = signal(false);
  protected readonly store = signal<MerchantStoreConnection | null>(null);
  protected readonly indexStatus = signal<MerchantIndexStatusResponse | null>(null);
  protected readonly isReindexing = signal(false);
  protected readonly reindexError = signal<string | null>(null);
  private indexPollTimer?: ReturnType<typeof setTimeout>;
  private indexPollInFlight = false;
  private activePollStartedAt: number | null = null;
  private lastProgressSignature = '';
  private consecutivePollFailures = 0;
  private firstSyncSeenActive = false;
  private destroyed = false;
  private readonly driftFirstSeenAt = signal<number | null>(null);
  protected readonly isConnected = computed(() => this.connectionStatus() === 'connected');
  protected readonly hasCompletedInitialCatalogSync = computed(
    () => this.store()?.catalogStatus === true,
  );
  protected readonly storeStatusLabel = computed(() =>
    this.connectionError() ? 'Unable to check' : CONNECTION_LABEL[this.connectionStatus()],
  );
  protected readonly connectedStoreHost = computed(() => {
    const store = this.store();
    return store ? formatStoreHost(store.storeUrl) : '';
  });
  protected readonly productsCount = computed(
    () => this.indexStatus()?.catalogCounts?.productsSynced ?? 0,
  );
  protected readonly productsHint = computed(() => {
    if (this.connectionError()) return 'Catalog status unavailable.';
    const counts = this.indexStatus()?.catalogCounts;
    if (!counts || counts.productsSynced === 0) {
      return 'No products synced yet.';
    }
    return this.catalogHealth().detail;
  });
  protected readonly lastSyncAt = computed(() =>
    this.hasCompletedInitialCatalogSync()
      ? (this.indexStatus()?.catalogSync?.completedAt ?? null)
      : null,
  );
  protected readonly lastSyncValue = computed(() =>
    this.hasCompletedInitialCatalogSync()
      ? formatConnectedDate(this.indexStatus()?.catalogSync?.completedAt)
      : 'Never synced',
  );
  protected readonly lastSyncHint = computed(() =>
    this.connectionError() ? 'Sync status unavailable.' :
    this.hasCompletedInitialCatalogSync() && this.indexStatus()?.catalogSync?.completedAt
      ? 'Last synced'
      : "Your store hasn't been synced yet.",
  );
  protected readonly catalogHealth = computed<CatalogHealthView>(() => {
    const counts = this.indexStatus()?.catalogCounts;
    if (!this.hasCompletedInitialCatalogSync() || !counts) {
      return {
        state: 'unknown',
        headline: 'Catalog',
        detail: 'Checking your store…',
        pendingCount: 0,
        unindexedCount: 0,
        showResync: false,
      };
    }
    const unindexed = Math.max(0, counts.productsSynced - counts.productsIndexed);
    if (counts.productsInStore === undefined) {
      return {
        state: 'unknown',
        headline: `${counts.productsSynced} products synced`,
        detail: "We couldn't reach your store to compare.",
        pendingCount: 0,
        unindexedCount: unindexed,
        showResync: true,
      };
    }
    const pending = Math.max(0, counts.productsInStore - counts.productsSynced);
    if (pending === 0) {
      return {
        state: 'up_to_date',
        headline: `${counts.productsSynced} products`,
        detail:
          unindexed > 0
            ? `${unindexed} still being indexed for search`
            : 'Synced automatically — up to date',
        pendingCount: 0,
        unindexedCount: unindexed,
        showResync: false,
      };
    }
    const firstSeen = this.driftFirstSeenAt();
    const isStale = firstSeen !== null && Date.now() - firstSeen >= DRIFT_GRACE_PERIOD_MS;
    if (!isStale) {
      return {
        state: 'catching_up',
        headline: `${counts.productsSynced} of ${counts.productsInStore} products`,
        detail: `${pending} just changed — syncing now`,
        pendingCount: pending,
        unindexedCount: unindexed,
        showResync: false,
      };
    }
    return {
      state: 'behind',
      headline: `${counts.productsSynced} of ${counts.productsInStore} products`,
      detail: `${pending} ${pending === 1 ? 'product hasn' : 'products haven'}'t synced`,
      pendingCount: pending,
      unindexedCount: unindexed,
      showResync: true,
    };
  });
  protected readonly isLoading = computed(() => this.connectionStatus() === 'checking');

  protected toneClass(tone: StatTone): string {
    return TONE_CLASSES[tone];
  }
  protected readonly skeletonCards = [0, 1, 2];
  protected readonly airobotImageSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/airobot.png';
  protected readonly catalogSyncCard = computed<StatusCardView>(() => {
    const catalog = this.indexStatus()?.catalogSync;
    const counts = this.indexStatus()?.catalogCounts;
    if (!(this.hasCompletedInitialCatalogSync() || this.catalogRunActive()) || !catalog) {
      return {
        label: 'Catalog Sync',
        state: 'not_started',
        stateLabel: INDEX_DISPLAY_LABELS.not_started,
        showRetry: false,
      };
    }
    const state: IndexDisplayState =
      catalog.status === 'queued'
        ? 'queued'
        : catalog.status === 'running'
          ? 'syncing'
          : catalog.status === 'failed'
            ? 'failed'
            : 'ready';
    return {
      label: 'Catalog Sync',
      state,
      stateLabel: INDEX_DISPLAY_LABELS[state],
      processed:
        state === 'ready'
          ? (counts?.productsSynced ?? catalog.productsReceived)
          : catalog.productsReceived,
      total:
        state === 'ready'
          ? (counts?.productsInStore ?? catalog.expectedTotal)
          : catalog.expectedTotal,
      completedAt: catalog.completedAt,
      showRetry: false,
    };
  });
  protected readonly embeddingIndexCard = computed<StatusCardView>(() => {
    const embedding = this.indexStatus()?.embeddingIndex;
    const counts = this.indexStatus()?.catalogCounts;
    if (!(this.hasCompletedInitialCatalogSync() || this.embeddingRunActive()) || !embedding) {
      return {
        label: 'AI Search Index',
        state: 'not_started',
        stateLabel: INDEX_DISPLAY_LABELS.not_started,
        showRetry: false,
      };
    }
    const state: IndexDisplayState =
      embedding.status === 'queued'
        ? 'queued'
        : embedding.status === 'indexing'
          ? 'indexing'
          : embedding.status === 'failed'
            ? 'failed'
            : 'ready';
    return {
      label: 'AI Search Index',
      state,
      stateLabel: INDEX_DISPLAY_LABELS[state],
      processed:
        state === 'ready'
          ? (counts?.productsIndexed ?? embedding.processedProducts)
          : embedding.processedProducts,
      total:
        state === 'ready'
          ? (counts?.productsSynced ?? embedding.totalProducts)
          : embedding.totalProducts,
      progressPercent: embedding.progressPercent,
      failedCount: embedding.failedProducts,
      completedAt: embedding.completedAt,
      showRetry: state === 'failed',
    };
  });
  private readonly catalogRunActive = computed(() => {
    const catalog = this.indexStatus()?.catalogSync;
    return catalog ? ACTIVE_CATALOG_STATUSES.has(catalog.status) : false;
  });
  private readonly embeddingRunActive = computed(() => {
    const embedding = this.indexStatus()?.embeddingIndex;
    return embedding ? ACTIVE_EMBEDDING_STATUSES.has(embedding.status) : false;
  });

  private isIndexingActive(): boolean {
    if (!this.indexStatus()) return false;
    return this.catalogRunActive() || this.embeddingRunActive();
  }

  private async reloadStoreAfterFirstSync(status: MerchantIndexStatusResponse): Promise<void> {
    if (this.hasCompletedInitialCatalogSync()) return;
    const catalogStatus = status.catalogSync?.status;
    if (catalogStatus && ACTIVE_CATALOG_STATUSES.has(catalogStatus)) {
      this.firstSyncSeenActive = true;
      return;
    }
    if (!this.firstSyncSeenActive) return;
    this.firstSyncSeenActive = false;
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) return;
    try {
      const result = await this.woocommerce.getConnectionStatus();
      this.store.set(result.store ?? null);
    } catch {}
  }

  private trackDrift(counts?: CatalogCounts): void {
    if (!this.hasCompletedInitialCatalogSync()) {
      this.driftFirstSeenAt.set(null);
      return;
    }
    const behind =
      counts !== undefined &&
      counts.productsInStore !== undefined &&
      counts.productsInStore > counts.productsSynced;
    if (!behind) {
      this.driftFirstSeenAt.set(null);
      return;
    }
    if (this.driftFirstSeenAt() === null) {
      this.driftFirstSeenAt.set(Date.now());
    }
  }

  private progressSignature(): string {
    const status = this.indexStatus();
    return [
      status?.catalogSync?.status,
      status?.catalogSync?.productsReceived,
      status?.embeddingIndex?.status,
      status?.embeddingIndex?.processedProducts,
    ].join('|');
  }

  private nextPollDelay(): number | null {
    if (this.isIndexingActive()) {
      const progress = this.progressSignature();
      if (progress !== this.lastProgressSignature) {
        this.lastProgressSignature = progress;
        this.activePollStartedAt = Date.now();
      }
      this.activePollStartedAt ??= Date.now();
      const activeFor = Date.now() - this.activePollStartedAt;
      if (activeFor < INDEX_FAST_POLL_WINDOW_MS) return INDEX_POLL_INTERVAL_MS;
      if (activeFor < INDEX_STALE_POLL_WINDOW_MS) return INDEX_SLOW_POLL_INTERVAL_MS;
      return INDEX_STALE_POLL_INTERVAL_MS;
    }
    this.activePollStartedAt = null;
    this.lastProgressSignature = '';
    if (this.driftFirstSeenAt() !== null) return DRIFT_POLL_INTERVAL_MS;
    const counts = this.indexStatus()?.catalogCounts;
    if (
      this.hasCompletedInitialCatalogSync() &&
      counts &&
      counts.productsIndexed < counts.productsSynced
    ) {
      return DRIFT_POLL_INTERVAL_MS;
    }
    return null;
  }

  async ngOnInit(): Promise<void> {
    this.connectionError.set(false);
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) {
      this.connectionStatus.set('failed');
      return;
    }
    try {
      const result = await this.woocommerce.getConnectionStatus();
      this.connectionStatus.set(result.status);
      this.store.set(result.store ?? null);
    } catch {
      this.connectionError.set(true);
      this.connectionStatus.set('failed');
    }
    if (this.connectionStatus() === 'connected') {
      void this.pollIndexStatus();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearIndexPollTimer();
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.clearIndexPollTimer();
      return;
    }
    if (!this.destroyed && this.connectionStatus() === 'connected') {
      void this.pollIndexStatus();
    }
  }

  protected async retryIndexing(): Promise<void> {
    if (this.isReindexing()) return;
    this.isReindexing.set(true);
    this.reindexError.set(null);
    try {
      await this.embeddingService.reindex();
      void this.pollIndexStatus();
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        void this.pollIndexStatus();
        return;
      }
      this.reindexError.set(apiErrorMessage(err));
    } finally {
      this.isReindexing.set(false);
    }
  }

  private async pollIndexStatus(): Promise<void> {
    if (this.destroyed || document.visibilityState === 'hidden' || this.indexPollInFlight) {
      return;
    }
    this.clearIndexPollTimer();
    this.indexPollInFlight = true;
    try {
      const result = await this.embeddingService.getStatus();
      if (this.destroyed) return;
      await this.reloadStoreAfterFirstSync(result);
      if (this.destroyed) return;
      this.consecutivePollFailures = 0;
      this.indexStatus.set(result);
      this.trackDrift(result.catalogCounts);
      const delay = this.nextPollDelay();
      if (delay !== null) {
        this.indexPollTimer = setTimeout(() => void this.pollIndexStatus(), delay);
      }
    } catch {
      if (this.destroyed) return;
      this.consecutivePollFailures += 1;
      const delay = Math.min(
        INDEX_ERROR_MAX_INTERVAL_MS,
        INDEX_POLL_INTERVAL_MS * 2 ** (this.consecutivePollFailures - 1),
      );
      this.indexPollTimer = setTimeout(() => void this.pollIndexStatus(), delay);
    } finally {
      this.indexPollInFlight = false;
    }
  }

  private clearIndexPollTimer(): void {
    if (this.indexPollTimer) {
      clearTimeout(this.indexPollTimer);
      this.indexPollTimer = undefined;
    }
  }

  protected formatCompletedAt(iso?: string): string {
    return formatConnectedDate(iso);
  }
}
