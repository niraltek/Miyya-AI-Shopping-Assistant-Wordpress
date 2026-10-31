import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucideArrowRight,
  LucideCheck,
  LucideExternalLink,
  LucideLayers,
  LucideLink,
  LucidePackage,
  LucideRefreshCw,
  LucideSettings,
  LucideStore,
} from '@lucide/angular';
import { formatStoreHost } from '../../../../shared/utils/validation';
import { MerchantStoreConnection } from '../../../store/models/woocommerce';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import {
  CATALOG_SYNC_TRUST_POINTS,
  CatalogSyncAlreadyRunningBody,
  CatalogSyncViewState,
} from '../../models/catalog';
import { CatalogCounts } from '../../models/embedding';
import { CatalogService } from '../../services/catalog-service/catalog-service';
import { EmbeddingService } from '../../services/embedding-service/embedding-service';
import { CatalogProgressComponent } from '../catalog-progress-component/catalog-progress-component';
import { CatalogSyncScopeComponent } from '../catalog-sync-scope-component/catalog-sync-scope-component';

const ACTIVE_SYNC_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

const FINISHED_SYNC_STATUSES: ReadonlySet<string> = new Set(['completed', 'completed_with_errors']);

@Component({
  imports: [
    CatalogProgressComponent,
    CatalogSyncScopeComponent,
    DatePipe,
    LucideArrowRight,
    LucideCheck,
    LucideExternalLink,
    LucideLayers,
    LucideLink,
    LucidePackage,
    LucideRefreshCw,
    LucideSettings,
    LucideStore,
  ],
  selector: 'app-catalog-sync-component',
  styleUrl: './catalog-sync-component.scss',
  templateUrl: './catalog-sync-component.html',
})
export class CatalogSyncComponent implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly embeddings = inject(EmbeddingService);
  private readonly woocommerce = inject(WooCommerceService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly viewState = signal<CatalogSyncViewState>('loading');
  protected readonly store = signal<MerchantStoreConnection | null>(null);
  protected readonly isStarting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly activeRunId = signal<string | null>(null);
  private readonly syncedThisVisit = signal(false);
  protected readonly lastSyncedAt = signal<string | null>(null);
  protected readonly counts = signal<CatalogCounts | null>(null);
  protected readonly catalogproductImageSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/catalog-product.png';
  protected readonly trustPoints = CATALOG_SYNC_TRUST_POINTS;
  protected readonly alreadySynced = computed(
    () => this.store()?.catalogStatus === true || this.syncedThisVisit(),
  );

  async ngOnInit(): Promise<void> {
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) {
      this.viewState.set('no-store');
      return;
    }
    try {
      const result = await this.woocommerce.getConnectionStatus();
      if (result.status === 'connected' && result.store) {
        this.store.set(result.store);
        const latest = await this.loadLatest();
        const running = latest && ACTIVE_SYNC_STATUSES.has(latest.status) ? latest.syncRunId : null;
        this.activeRunId.set(this.route.snapshot.paramMap.get('syncRunId') ?? running);
        if (latest && FINISHED_SYNC_STATUSES.has(latest.status) && latest.completedAt) {
          this.lastSyncedAt.set(latest.completedAt);
        }
        this.viewState.set('ready');
        void this.loadCounts();
        if (window.AIAssistantConfig?.autoSync && !this.activeRunId()) {
          this.dropAutoSyncFlag();
          await this.confirm();
        }
      } else {
        this.viewState.set('no-store');
      }
    } catch {
      this.viewState.set('no-store');
    }
  }

  private dropAutoSyncFlag(): void {
    try {
      const top = window.top;
      if (!top || top === window) return;
      const url = new URL(top.location.href);
      if (!url.searchParams.has('aaAutoSync')) return;
      url.searchParams.delete('aaAutoSync');
      top.history.replaceState(top.history.state, '', url.toString());
    } catch {}
  }

  private async loadLatest() {
    try {
      return await this.catalog.getLatest();
    } catch {
      return null;
    }
  }

  private async loadCounts(): Promise<void> {
    try {
      this.counts.set((await this.embeddings.getStatus()).catalogCounts ?? null);
    } catch {}
  }

  protected storeLabel(): string {
    const store = this.store();
    if (!store) return '';
    return store.name || formatStoreHost(store.storeUrl);
  }

  protected storeHost(): string {
    const store = this.store();
    return store ? formatStoreHost(store.storeUrl) : '';
  }

  protected async confirm(): Promise<void> {
    if (this.isStarting()) return;
    this.error.set(null);
    this.isStarting.set(true);
    try {
      const result = await this.catalog.start();
      this.activeRunId.set(result.syncRunId);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        const body = err.error as CatalogSyncAlreadyRunningBody | undefined;
        if (body?.syncRunId) {
          this.activeRunId.set(body.syncRunId);
          return;
        }
      }
      this.error.set(apiErrorMessage(err));
    } finally {
      this.isStarting.set(false);
    }
  }

  protected resetToIdle(): void {
    this.syncedThisVisit.set(true);
    this.activeRunId.set(null);
    void this.refreshAfterRun();
    if (this.route.snapshot.paramMap.has('syncRunId')) {
      void this.router.navigateByUrl('/catalog-sync', { replaceUrl: true });
    }
  }

  private async refreshAfterRun(): Promise<void> {
    const latest = await this.loadLatest();
    if (latest && FINISHED_SYNC_STATUSES.has(latest.status) && latest.completedAt) {
      this.lastSyncedAt.set(latest.completedAt);
    }
    await this.loadCounts();
  }

  protected goToConnect(): void {
    this.router.navigate(['/connect']);
  }

  protected goToSettings(): void {
    this.router.navigateByUrl('/settings');
  }
}
