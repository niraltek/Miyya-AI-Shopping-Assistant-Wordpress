import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCheck,
  LucideEyeOff,
  LucideGlobe,
  LucideMoon,
  LucideShieldCheck,
  LucideSun,
} from '@lucide/angular';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { AccentName } from '../../../../shared/models/theme';
import { ThemeService } from '../../../../shared/services/theme-service/theme-service';
import { formatStoreHost } from '../../../../shared/utils/validation';
import {
  DEFAULT_WIDGET_LAYOUT,
  WIDGET_LAYOUT_GROUPS,
  WidgetLayoutFormat,
  isWidgetLayoutFormat,
  WidgetLayoutSettingsResponse,
} from '../../models/widget-layout';
import {
  DEFAULT_WIDGET_VISIBILITY,
  WIDGET_VISIBILITY_OPTIONS,
  WidgetVisibilityMode,
  isWidgetVisibilityMode,
  WidgetVisibilitySettingsResponse,
} from '../../models/widget-visibility';
import { WebhookService } from '../../services/webhook-service/webhook-service';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';

@Component({
  imports: [
    RouterLink,
    LucideArrowRight,
    LucideCheck,
    LucideEyeOff,
    LucideGlobe,
    LucideMoon,
    LucideShieldCheck,
    LucideSun,
  ],
  selector: 'app-settings-component',
  styleUrl: './settings-component.scss',
  templateUrl: './settings-component.html',
})
export class SettingsComponent implements OnInit {
  protected readonly theme = inject(ThemeService);
  private readonly woocommerce = inject(WooCommerceService);
  private readonly webhooks = inject(WebhookService);
  private readonly merchantApi = inject(MerchantApiService);
  private readonly router = inject(Router);
  protected readonly checkingConnection = signal(true);
  protected readonly isConnected = signal(false);
  protected readonly storeHost = signal('');
  protected readonly confirmingDisconnect = signal(false);
  protected readonly isDisconnecting = signal(false);
  protected readonly disconnectError = signal<string | null>(null);
  protected readonly disconnectNeedsReconnect = signal(false);
  protected readonly siteLinked = computed(() => this.webhooks.isSiteLinked());
  protected readonly layoutGroups = WIDGET_LAYOUT_GROUPS;
  protected readonly designFormat = signal<WidgetLayoutFormat>(DEFAULT_WIDGET_LAYOUT);
  protected readonly isLayoutLoading = signal(true);
  protected readonly isSavingLayout = signal(false);
  protected readonly layoutError = signal<string | null>(null);
  protected readonly visibilityOptions = WIDGET_VISIBILITY_OPTIONS;
  protected readonly visibilityMode = signal<WidgetVisibilityMode>(DEFAULT_WIDGET_VISIBILITY);
  protected readonly isVisibilityLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    void this.loadLiveWebsiteVisibility();
    void this.loadDesignFormat();
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) {
      this.checkingConnection.set(false);
      return;
    }
    try {
      const result = await this.woocommerce.getConnectionStatus();
      this.isConnected.set(result.status === 'connected');
      this.storeHost.set(result.store ? formatStoreHost(result.store.storeUrl) : '');
    } catch {
      this.isConnected.set(false);
    } finally {
      this.checkingConnection.set(false);
    }
  }

  protected selectAccent(name: AccentName): void {
    this.theme.setAccent(name);
  }

  protected onCustomColorInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.theme.setCustomColor(value);
  }

  protected async selectDesignFormat(format: WidgetLayoutFormat): Promise<void> {
    if (this.isSavingLayout() || this.isLayoutLoading() || this.designFormat() === format) return;
    const previous = this.designFormat();
    this.designFormat.set(format);
    this.isSavingLayout.set(true);
    this.layoutError.set(null);
    try {
      const result = await this.merchantApi.request<WidgetLayoutSettingsResponse>(
        'POST',
        'widget/layout',
        { layout: format },
      );
      this.designFormat.set(isWidgetLayoutFormat(result.layout) ? result.layout : format);
    } catch (error) {
      this.designFormat.set(previous);
      this.layoutError.set(apiErrorMessage(error));
    } finally {
      this.isSavingLayout.set(false);
    }
  }

  private async loadDesignFormat(): Promise<void> {
    try {
      const result = await this.merchantApi.request<WidgetLayoutSettingsResponse>(
        'GET',
        'widget/layout',
      );
      if (isWidgetLayoutFormat(result.layout)) {
        this.designFormat.set(result.layout);
      }
    } catch (error) {
      this.layoutError.set(apiErrorMessage(error));
    } finally {
      this.isLayoutLoading.set(false);
    }
  }

  protected async selectVisibility(mode: WidgetVisibilityMode): Promise<void> {
    if (this.isSaving() || this.isVisibilityLoading() || this.visibilityMode() === mode) return;
    const previousMode = this.visibilityMode();
    this.visibilityMode.set(mode);
    this.isSaving.set(true);
    this.saveError.set(null);
    try {
      const result = await this.merchantApi.request<WidgetVisibilitySettingsResponse>(
        'POST',
        'widget/visibility',
        { mode },
      );
      this.visibilityMode.set(isWidgetVisibilityMode(result.mode) ? result.mode : mode);
    } catch (error) {
      this.visibilityMode.set(previousMode);
      this.saveError.set(apiErrorMessage(error));
    } finally {
      this.isSaving.set(false);
    }
  }

  private async loadLiveWebsiteVisibility(): Promise<void> {
    try {
      const result = await this.merchantApi.request<WidgetVisibilitySettingsResponse>(
        'GET',
        'widget/visibility',
      );
      if (isWidgetVisibilityMode(result.mode)) {
        this.visibilityMode.set(result.mode);
      } else if (typeof result.enabled === 'boolean') {
        this.visibilityMode.set(result.enabled ? 'everyone' : 'hidden');
      }
    } catch (error) {
      this.saveError.set(apiErrorMessage(error));
    } finally {
      this.isVisibilityLoading.set(false);
    }
  }

  protected askDisconnect(): void {
    this.disconnectError.set(null);
    this.disconnectNeedsReconnect.set(false);
    this.confirmingDisconnect.set(true);
  }

  protected cancelDisconnect(): void {
    this.confirmingDisconnect.set(false);
  }

  protected async confirmDisconnect(): Promise<void> {
    if (this.isDisconnecting()) return;
    this.isDisconnecting.set(true);
    this.disconnectError.set(null);
    this.disconnectNeedsReconnect.set(false);
    try {
      const result = await this.webhooks.disconnectStore();
      if (!result.ok) {
        if (result.reason === 'no_site_token' || result.reason === 'site_token_rejected') {
          this.disconnectNeedsReconnect.set(true);
        }
        this.disconnectError.set(apiErrorMessage(result));
        return;
      }
      this.isConnected.set(false);
      this.confirmingDisconnect.set(false);
      this.router.navigateByUrl('/connect');
    } catch (error) {
      this.disconnectError.set(apiErrorMessage(error));
    } finally {
      this.isDisconnecting.set(false);
    }
  }

  protected goToReconnect(): void {
    this.confirmingDisconnect.set(false);
    this.router.navigate(['/connect']);
  }
}
