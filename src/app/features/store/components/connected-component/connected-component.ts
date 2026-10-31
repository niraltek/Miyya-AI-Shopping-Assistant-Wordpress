import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideArrowRight,
  LucideCheck,
  LucideChevronDown,
  LucideKey,
  LucideTriangleAlert,
} from '@lucide/angular';
import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { navigateTop } from '../../../../core/utils/navigation';
import { formatConnectedDate, formatStoreHost } from '../../../../shared/utils/validation';
import { WebhookSetupState } from '../../models/webhook';
import {
  ConnectedViewState,
  ConnectionDetailRow,
  MerchantStoreConnection,
  StoreIdentityConflict,
} from '../../models/woocommerce';
import { WebhookService } from '../../services/webhook-service/webhook-service';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { storeIdentityConflict } from '../../utils/connection-conflict';
import { StoreIdentityConflictComponent } from '../store-identity-conflict-component/store-identity-conflict-component';

@Component({
  imports: [
    LucideArrowRight,
    LucideCheck,
    LucideChevronDown,
    LucideKey,
    LucideTriangleAlert,
    StoreIdentityConflictComponent,
  ],
  selector: 'app-connected-component',
  styleUrl: './connected-component.scss',
  templateUrl: './connected-component.html',
})
export class ConnectedComponent implements OnInit, OnDestroy {
  private readonly woocommerce = inject(WooCommerceService);
  private readonly webhooks = inject(WebhookService);
  private readonly router = inject(Router);
  private provisionToken: string | null = null;
  protected readonly viewState = signal<ConnectedViewState>('checking');
  protected readonly connectionError = signal<string | null>(null);
  protected readonly identityConflict = signal<StoreIdentityConflict | null>(null);
  protected readonly store = signal<MerchantStoreConnection | null>(null);
  protected readonly showDetails = signal(false);
  protected readonly webhookSetup = signal<WebhookSetupState>('pending');
  protected readonly isRetryingWebhookSetup = signal(false);
  protected readonly webhookSetupError = signal<string | null>(null);
  protected readonly details = computed<ConnectionDetailRow[]>(() => {
    const store = this.store();
    if (!store) {
      return [];
    }
    return [
      ...(store.name ? [{ label: 'Name', value: store.name }] : []),
      { label: 'Store', value: formatStoreHost(store.storeUrl) },
      { label: 'Platform', value: 'WooCommerce' },
      { label: 'Permission', value: 'Read Only' },
      { label: 'Status', value: 'Connected' },
    ];
  });
  protected readonly continuing = signal(false);
  private verificationTimer?: ReturnType<typeof setInterval>;
  private verifying = false;
  private destroyed = false;
  static readonly VERIFY_DELAY_MS = 1500;

  private scheduleContinue(): void {
    if (window.AIAssistantConfig?.setupUrl) this.continueSetup();
  }

  protected continueSetup(): void {
    if (this.destroyed || this.continuing()) return;
    this.continuing.set(true);
    const setupUrl = window.AIAssistantConfig?.setupUrl;
    if (setupUrl) {
      navigateTop(setupUrl);
      return;
    }
    this.router.navigateByUrl('/setup');
  }
  protected readonly connectedDate = computed(() => formatConnectedDate(this.store()?.connectedAt));
  protected readonly maskedKey = computed(
    () => this.store()?.maskedConsumerKey ?? `ck_${'*'.repeat(12)}`,
  );
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      void this.verifyConnection();
    }
  };

  ngOnInit(): void {
    window.addEventListener('pageshow', this.onPageShow);
    void this.verifyConnection();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener('pageshow', this.onPageShow);
    clearInterval(this.verificationTimer);
  }

  private async verifyConnection(): Promise<void> {
    if (this.destroyed || this.verifying) return;
    this.verifying = true;
    this.viewState.set('checking');
    this.connectionError.set(null);
    this.identityConflict.set(null);
    const params = new URLSearchParams(window.location.search);
    const identity = this.woocommerce.getIdentity();
    const config = window.AIAssistantConfig;
    const email = params.get('email') ?? config?.email ?? identity.email;
    const storeUrl = params.get('storeUrl') ?? config?.storeUrl ?? identity.storeUrl;
    this.provisionToken = config?.provisionToken ?? params.get('aaProvisionToken');
    try {
      const result = await this.woocommerce.getConnectionStatus();
      if (this.destroyed) return;
      if (result.status === 'connected' && result.store) {
        clearInterval(this.verificationTimer);
        this.verificationTimer = undefined;
        this.woocommerce.rememberIdentity(email, storeUrl);
        this.store.set(result.store);
        this.viewState.set('connected');
        await this.attemptWebhookRegistration();
        if (!this.destroyed && this.webhookSetup() !== 'unavailable') this.scheduleContinue();
        return;
      }
      if (result.status !== 'pending') {
        clearInterval(this.verificationTimer);
        this.verificationTimer = undefined;
        this.viewState.set('failed');
        return;
      }
      // Refresh pending work until the server reports a terminal state. Elapsed time
      // alone cannot tell us that verification failed.
      this.verificationTimer ??= setInterval(
        () => void this.verifyConnection(),
        ConnectedComponent.VERIFY_DELAY_MS,
      );
    } catch (error) {
      if (this.destroyed) return;
      clearInterval(this.verificationTimer);
      this.verificationTimer = undefined;
      this.identityConflict.set(storeIdentityConflict(error));
      this.connectionError.set(apiErrorMessage(error));
      this.viewState.set('failed');
    } finally {
      this.verifying = false;
    }
  }

  private async attemptWebhookRegistration(): Promise<void> {
    const result = await this.webhooks.registerProductWebhooks(this.provisionToken);
    if (this.destroyed) return;
    if (result.outcome === 'registered') {
      this.webhookSetupError.set(null);
      this.webhookSetup.set('registered');
      return;
    }
    if (result.outcome === 'skipped') {
      return;
    }
    this.webhookSetupError.set(result.message ?? null);
    this.webhookSetup.set('unavailable');
  }

  protected async retryWebhookSetup(): Promise<void> {
    if (this.isRetryingWebhookSetup()) return;
    this.isRetryingWebhookSetup.set(true);
    this.webhookSetup.set('pending');
    try {
      await this.attemptWebhookRegistration();
      if (!this.destroyed && this.webhookSetup() !== 'unavailable') this.scheduleContinue();
    } finally {
      this.isRetryingWebhookSetup.set(false);
    }
  }

  protected toggleDetails(): void {
    this.showDetails.update((shown) => !shown);
  }

  protected retry(): void {
    this.continueSetup();
  }

  protected checkApproval(): void {
    void this.verifyConnection();
  }

  protected startMigration(): void {
    void this.router.navigateByUrl('/connect');
  }
}
