import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowRight,
  LucideCheck,
  LucideClipboardCheck,
  LucideEye,
  LucideShieldCheck,
  LucideSettings,
  LucideKeyRound,
  LucideTriangleAlert,
  LucideX,
  LucideZap,
} from '@lucide/angular';
import { connectDestination, navigateTop } from '../../../../core/utils/navigation';
import { formatStoreHost, validateStoreUrl } from '../../../../shared/utils/validation';
import { TermsComponent } from '../../../setup/components/terms-component/terms-component';
import { rememberAutomaticSetup } from '../../../setup/utils/automatic-setup';
import { ConnectStatus, StoreIdentityConflict } from '../../models/woocommerce';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { storeIdentityConflict } from '../../utils/connection-conflict';
import { StoreIdentityConflictComponent } from '../store-identity-conflict-component/store-identity-conflict-component';

const MISSING_IDENTITY_MESSAGE =
  'This page could not read your WordPress account details. Please reload the admin page.';

@Component({
  imports: [
    FormsModule,
    LucideArrowRight,
    LucideCheck,
    LucideClipboardCheck,
    LucideEye,
    LucideShieldCheck,
    LucideSettings,
    LucideKeyRound,
    LucideTriangleAlert,
    LucideX,
    LucideZap,
    TermsComponent,
    StoreIdentityConflictComponent,
  ],
  selector: 'app-connect-component',
  styleUrl: './connect-component.scss',
  templateUrl: './connect-component.html',
})
export class ConnectComponent implements OnInit {
  private readonly woocommerce = inject(WooCommerceService);
  protected readonly checkingConnection = signal(true);
  protected readonly connectionCheckFailed = signal(false);
  protected readonly identityConflict = signal<StoreIdentityConflict | null>(null);
  protected readonly resolvingIdentity = signal(false);
  protected readonly hasPendingMigration = computed(() => !!this.identityConflict()?.handshakeId);
  protected readonly isConnected = signal(false);
  private readonly detectedStoreUrl = window.AIAssistantConfig?.storeUrl?.trim() ?? '';
  private readonly detectedStoreName = window.AIAssistantConfig?.storeName?.trim() ?? '';
  protected readonly connectStoreImageSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/connecting-store.png';
  protected readonly logoSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/miyya-logo.svg';
  protected readonly logoWhiteSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/miyya-logo-white.png';
  protected readonly storeName = signal(this.detectedStoreName);
  protected readonly storeUrl = signal(this.detectedStoreUrl);
  protected readonly fieldError = signal<string | null>(null);
  protected readonly status = signal<ConnectStatus>('idle');
  protected readonly showConnectionChoice = signal(false);
  protected readonly connectionMode = signal<'automatic' | 'manual'>('automatic');
  protected readonly termsAccepted = signal(false);
  protected readonly showTerms = signal(false);
  protected readonly hasDetectedUrl = this.detectedStoreUrl !== '';
  protected readonly hostMismatch = computed(() => {
    if (!this.hasDetectedUrl) {
      return false;
    }
    const typed = this.storeUrl().trim();
    if (!typed) {
      return false;
    }
    const result = validateStoreUrl(typed);
    return result.valid && !!result.url
      ? formatStoreHost(result.url).toLowerCase() !==
          formatStoreHost(this.detectedStoreUrl).toLowerCase()
      : false;
  });
  protected readonly detectedHost = computed(() =>
    this.detectedStoreUrl ? formatStoreHost(this.detectedStoreUrl) : '',
  );

  protected useDetectedStore(): void {
    this.storeUrl.set(this.detectedStoreUrl);
    if (!this.storeName().trim()) {
      this.storeName.set(this.detectedStoreName);
    }
    this.fieldError.set(null);
    if (this.status() === 'error') {
      this.status.set('idle');
    }
  }
  protected readonly isBusy = computed(
    () =>
      this.checkingConnection() ||
      this.resolvingIdentity() ||
      this.status() === 'connecting' ||
      this.status() === 'redirecting',
  );

  async ngOnInit(): Promise<void> {
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) {
      this.checkingConnection.set(false);
      return;
    }
    this.checkingConnection.set(true);
    this.connectionCheckFailed.set(false);
    this.identityConflict.set(null);
    this.fieldError.set(null);
    try {
      const result = await this.woocommerce.getConnectionStatus();
      if (result.status === 'connected' && result.store) {
        this.isConnected.set(true);
      }
    } catch (error) {
      const conflict = storeIdentityConflict(error);
      this.identityConflict.set(conflict);
      this.connectionCheckFailed.set(!conflict);
      this.fieldError.set(apiErrorMessage(error));
    } finally {
      this.checkingConnection.set(false);
    }
  }

  protected onUrlInput(value: string): void {
    this.storeUrl.set(value);
    if (this.fieldError()) {
      this.fieldError.set(null);
    }
    if (this.status() === 'error') {
      this.status.set('idle');
    }
  }

  protected openConnectionChoice(): void {
    if (this.isBusy() || this.isConnected()) {
      return;
    }
    if (this.connectionCheckFailed()) {
      void this.ngOnInit();
      return;
    }
    const result = validateStoreUrl(this.storeUrl());
    if (!result.valid || !result.url) {
      this.fieldError.set(result.error ?? 'Please enter a valid WooCommerce store URL.');
      return;
    }
    const { email } = this.woocommerce.getIdentity();
    if (!email) {
      this.fieldError.set(MISSING_IDENTITY_MESSAGE);
      this.status.set('error');
      return;
    }
    this.fieldError.set(null);
    this.connectionMode.set('automatic');
    this.termsAccepted.set(false);
    this.showConnectionChoice.set(true);
  }

  protected closeConnectionChoice(): void {
    if (!this.isBusy()) this.showConnectionChoice.set(false);
  }

  protected selectConnectionMode(mode: 'automatic' | 'manual'): void {
    if (this.isBusy()) return;
    this.connectionMode.set(mode);
  }

  protected setTermsAccepted(accepted: boolean): void {
    if (this.isBusy()) return;
    this.termsAccepted.set(accepted);
  }

  protected canConnectFromChoice(): boolean {
    return this.termsAccepted();
  }

  protected openTerms(): void {
    if (this.isBusy()) return;
    this.showTerms.set(true);
  }

  protected closeTerms(): void {
    this.showTerms.set(false);
  }

  protected async connect(): Promise<void> {
    if (!this.canConnectFromChoice() || this.isBusy() || this.isConnected()) return;
    const result = validateStoreUrl(this.storeUrl());
    if (!result.valid || !result.url) return;
    const { email } = this.woocommerce.getIdentity();
    if (!email) return;
    this.fieldError.set(null);
    this.status.set('connecting');
    try {
      const response = await this.woocommerce.connectStore({
        email,
        storeUrl: result.url,
        storeName: this.storeName().trim() || formatStoreHost(result.url),
        returnUrl: window.AIAssistantConfig?.connectedUrl,
        approvalMode: this.connectionMode(),
        connectionMode: this.connectionMode() === 'automatic' ? 'separate' : 'connect',
      });
      this.woocommerce.rememberIdentity(email, result.url);
      rememberAutomaticSetup(
        this.woocommerce.getIdentity().storeUrl || result.url,
        this.connectionMode() === 'automatic',
      );
      this.status.set('redirecting');
      navigateTop(connectDestination(response));
    } catch (error) {
      this.status.set('error');
      this.fieldError.set(apiErrorMessage(error));
    }
  }
}
