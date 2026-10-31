import { apiErrorMessage } from '../../../../shared/utils/api-response';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucideBox,
  LucideCheck,
  LucideCircleAlert,
  LucideClock,
  LucideFileText,
  LucideHourglass,
  LucideLayers,
  LucidePackage,
  LucideRefreshCw,
  LucideX,
} from '@lucide/angular';
import {
  CATALOG_SYNC_STAGE_DESCRIPTIONS,
  CATALOG_SYNC_STAGE_KEYS,
  CATALOG_SYNC_STAGE_LABELS,
  CatalogSyncCounterTile,
  CatalogSyncError,
  CatalogSyncStage,
  CatalogSyncStatusResponse,
  CatalogSyncStepState,
} from '../../models/catalog';
import { CatalogService } from '../../services/catalog-service/catalog-service';

const POLL_INTERVAL_MS = 800;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
]);

const STAGE_KEYS = CATALOG_SYNC_STAGE_KEYS;

const STAGE_LABELS = CATALOG_SYNC_STAGE_LABELS;

const STAGE_DESCRIPTIONS = CATALOG_SYNC_STAGE_DESCRIPTIONS;

const ERROR_STAGE_LABELS: Record<string, string> = {
  fetching: 'Fetching',
  normalizing: 'Normalization',
  storing: 'Storing',
};

const TICK_MS = 100;

const STEP_STARTS: readonly number[] = [0, 0.04, 0.45, 0.75];

const MIN_SECONDS_PER_PRODUCT = 0.04;

const MIN_RUN_SECONDS = 6;

const MAX_RUN_SECONDS = 25;

const RESUME_AFTER_MS = 8000;

const RESUME_AFTER_FRACTION = 0.05;

@Component({
  imports: [
    DatePipe,
    LucideBox,
    LucideCheck,
    LucideCircleAlert,
    LucideClock,
    LucideFileText,
    LucideHourglass,
    LucideLayers,
    LucidePackage,
    LucideRefreshCw,
    LucideX,
  ],
  selector: 'app-catalog-progress-component',
  styleUrl: './catalog-progress-component.scss',
  templateUrl: './catalog-progress-component.html',
})
export class CatalogProgressComponent implements OnInit, OnDestroy {
  private readonly catalog = inject(CatalogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly syncRunId = input<string | null>(null);
  readonly restart = output<void>();
  protected readonly embedded = computed(() => this.syncRunId() !== null);
  protected readonly status = signal<CatalogSyncStatusResponse | null>(null);
  protected readonly notFound = signal(false);
  protected readonly retryingId = signal<string | null>(null);
  protected readonly retryError = signal<string | null>(null);
  private readonly displayed = signal(0);
  private readonly visualIndex = computed(() => {
    const shown = this.displayed();
    if (shown >= 1 && this.isCompleted()) return STAGE_KEYS.length;
    let index = 0;
    STEP_STARTS.forEach((start, i) => {
      if (shown >= start) index = i;
    });
    return index;
  });
  protected readonly stageKeys = STAGE_KEYS;
  protected readonly stageLabels = STAGE_LABELS;
  protected readonly stageTimes = signal<Readonly<Record<number, Date>>>({});
  protected readonly skeletonRows = [72, 58, 80, 45];
  private readonly now = signal(Date.now());
  private clockTimer?: ReturnType<typeof setInterval>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private firstSight = true;
  private stopped = false;
  protected readonly isFailed = computed(() => this.status()?.status === 'failed');
  protected readonly isCompleted = computed(() => {
    const value = this.status()?.status;
    return value === 'completed' || value === 'completed_with_errors';
  });
  protected readonly failedStageIndex = computed(() => {
    const status = this.status();
    if (!status) return 0;
    const fromError = status.errors[0]?.errorStage;
    const errorIndex = fromError ? STAGE_KEYS.indexOf(fromError as CatalogSyncStage) : -1;
    if (errorIndex >= 0) return errorIndex;
    const currentIndex = status.currentStage ? STAGE_KEYS.indexOf(status.currentStage) : -1;
    return currentIndex >= 0 ? currentIndex : 0;
  });
  protected readonly percent = computed(() => Math.round(this.displayed() * 100));
  private readonly progressDetail = computed(() => {
    const status = this.status();
    const total = status?.expectedTotal ?? 0;
    if (!status || total <= 0) return null;
    const stored =
      status.productsCreated +
      status.productsUpdated +
      status.productsSkipped +
      status.productsFailed;
    return `${Math.min(total, stored)} of ${total} products synced…`;
  });
  protected readonly headline = computed(() => {
    if (!this.status()) return 'Loading…';
    if (this.isFailed()) return 'Catalog sync failed';
    if (this.isCompleted() && this.visualIndex() >= STAGE_KEYS.length) {
      return 'Catalog sync completed';
    }
    return this.progressDetail() ?? 'Preparing…';
  });
  protected readonly showSummary = computed(
    () => this.isCompleted() && this.visualIndex() >= STAGE_KEYS.length,
  );
  protected readonly isFinished = computed(() => this.isFailed() || this.showSummary());
  protected readonly elapsedLabel = computed(() => {
    const status = this.status();
    const started = status?.startedAt ? Date.parse(status.startedAt) : NaN;
    if (!status || Number.isNaN(started)) return null;
    const ended =
      this.isFinished() && status.completedAt ? Date.parse(status.completedAt) : this.now();
    const seconds = Math.max(
      0,
      Math.floor(((Number.isNaN(ended) ? this.now() : ended) - started) / 1000),
    );
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes} min ${seconds % 60} sec` : `${seconds} sec`;
  });
  protected readonly errors = computed(() => this.status()?.errors ?? []);
  protected readonly counters = computed<readonly CatalogSyncCounterTile[]>(() => {
    const status = this.status();
    if (!status) {
      return [];
    }
    const live: CatalogSyncCounterTile[] = [
      { label: 'Received', value: status.productsReceived, icon: 'box', tone: 'plain' },
      { label: 'Created', value: status.productsCreated, icon: 'file', tone: 'good' },
      { label: 'Updated', value: status.productsUpdated, icon: 'refresh', tone: 'good' },
    ];
    if (!this.showSummary() && !this.isFailed()) {
      return live;
    }
    return [
      ...live,
      { label: 'Failed', value: status.productsFailed, icon: 'alert', tone: 'bad' },
      { label: 'Skipped', value: status.productsSkipped, icon: 'hourglass', tone: 'plain' },
      { label: 'Pages', value: status.pagesProcessed, icon: 'layers', tone: 'plain' },
    ];
  });

  ngOnInit(): void {
    const syncRunId = this.syncRunId() ?? this.route.snapshot.paramMap.get('syncRunId');
    if (!syncRunId) {
      this.notFound.set(true);
      return;
    }
    this.clockTimer = setInterval(() => {
      if (!this.isFinished()) this.now.set(Date.now());
    }, 1000);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    void this.poll(syncRunId);
  }

  ngOnDestroy(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  protected stepState(index: number): CatalogSyncStepState {
    if (this.isFailed()) {
      const failed = this.failedStageIndex();
      if (index < failed) return 'done';
      return index === failed ? 'error' : 'pending';
    }
    if (index < this.visualIndex()) return 'done';
    return index === this.visualIndex() ? 'active' : 'pending';
  }

  protected stepDetail(index: number): string {
    if (index > 0 && this.stepState(index) === 'active') {
      const live = this.progressDetail();
      if (live) return live;
    }
    return STAGE_DESCRIPTIONS[STAGE_KEYS[index]];
  }

  protected errorLabel(error: CatalogSyncError): string {
    const stage = error.errorStage
      ? ERROR_STAGE_LABELS[error.errorStage] || error.errorStage
      : 'Error';
    return error.sourceProductId ? `${stage} · Product ${error.sourceProductId}` : stage;
  }

  protected async retry(error: CatalogSyncError): Promise<void> {
    if (this.retryingId()) return;
    this.retryingId.set(error.id);
    this.retryError.set(null);
    try {
      this.status.set(await this.catalog.retryError(error.id));
    } catch (error) {
      this.retryError.set(apiErrorMessage(error));
    } finally {
      this.retryingId.set(null);
    }
  }

  protected goToDashboard(): void {
    this.router.navigateByUrl('/dashboard');
  }

  protected startNewSync(): void {
    if (this.embedded()) {
      this.restart.emit();
      return;
    }
    this.router.navigateByUrl('/catalog-sync');
  }

  private async poll(syncRunId: string): Promise<void> {
    if (this.stopped) return;
    try {
      const result = await this.catalog.getStatus(syncRunId);
      if (this.stopped) return;
      this.status.set(result);
      if (this.firstSight) {
        this.firstSight = false;
        this.settleOnFirstSight(result);
      }
      if (!TERMINAL_STATUSES.has(result.status)) {
        this.pollTimer = setTimeout(() => void this.poll(syncRunId), POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (this.stopped) return;
      if (err instanceof HttpErrorResponse && err.status === 404) {
        this.notFound.set(true);
        return;
      }
      this.pollTimer = setTimeout(() => void this.poll(syncRunId), POLL_INTERVAL_MS);
    }
  }

  private targetFraction(status: CatalogSyncStatusResponse): number {
    if (status.status === 'completed' || status.status === 'completed_with_errors') return 1;
    const total = status.expectedTotal ?? 0;
    if (total <= 0) return status.productsReceived > 0 ? STEP_STARTS[1] : 0.02;
    const fetched = Math.min(status.productsReceived, total);
    const stored = Math.min(
      status.productsCreated +
        status.productsUpdated +
        status.productsSkipped +
        status.productsFailed,
      total,
    );
    const done = (0.35 * fetched + 0.65 * stored) / total;
    return Math.min(0.99, STEP_STARTS[1] + (0.99 - STEP_STARTS[1]) * done);
  }

  private settleOnFirstSight(status: CatalogSyncStatusResponse): void {
    const target = this.targetFraction(status);
    const started = status.startedAt ? Date.parse(status.startedAt) : NaN;
    const old = !Number.isNaN(started) && Date.now() - started > RESUME_AFTER_MS;
    const wellAlong = !TERMINAL_STATUSES.has(status.status) && target > RESUME_AFTER_FRACTION;
    if (wellAlong || old) {
      this.displayed.set(target);
    }
  }

  private tick(): void {
    const status = this.status();
    if (!status || this.stopped || this.isFailed()) return;
    const target = this.targetFraction(status);
    const current = this.displayed();
    if (target <= current) return;
    const runSeconds = Math.max(
      MIN_RUN_SECONDS,
      Math.min(MAX_RUN_SECONDS, (status.expectedTotal ?? 0) * MIN_SECONDS_PER_PRODUCT),
    );
    const longestStep = TICK_MS / 1000 / runSeconds;
    const gap = target - current;
    const next = gap < 0.002 ? target : current + Math.min(gap * 0.25, longestStep);
    const before = this.visualIndex();
    this.displayed.set(next);
    for (let finished = before; finished < this.visualIndex(); finished++) {
      this.stageTimes.update((times) => ({ ...times, [finished]: new Date() }));
    }
  }
}
