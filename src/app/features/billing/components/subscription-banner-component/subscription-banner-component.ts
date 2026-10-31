import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { Component, computed, inject, signal } from '@angular/core';
import { LucideCircleAlert, LucideDynamicIcon, LucideInfo } from '@lucide/angular';
import { PortalAccessService } from '../../../setup/services/portal-access-service/portal-access-service';
import { SubscriptionService } from '../../services/subscription-service/subscription-service';

@Component({
  selector: 'app-subscription-banner-component',
  imports: [LucideDynamicIcon],
  templateUrl: './subscription-banner-component.html',
  styleUrl: './subscription-banner-component.scss',
})
export class SubscriptionBannerComponent {
  private readonly subscription = inject(SubscriptionService);
  private readonly portalAccess = inject(PortalAccessService);
  protected readonly infoIcon = LucideInfo.icon;
  protected readonly alertIcon = LucideCircleAlert.icon;
  protected readonly notice = this.subscription.notice;
  protected readonly manageUrl = computed(() => this.subscription.status()?.manageUrl ?? '#');
  protected readonly isOpeningBillingPortal = signal(false);
  protected readonly billingPortalError = signal<string | null>(null);

  constructor() {
    void this.subscription.load();
  }

  protected async openBilling(event: MouseEvent): Promise<void> {
    event.preventDefault();
    if (this.isOpeningBillingPortal()) return;
    const portalWindow = window.open('', '_blank');
    if (portalWindow) portalWindow.opener = null;
    this.isOpeningBillingPortal.set(true);
    this.billingPortalError.set(null);
    try {
      const url = await this.portalAccess.billingLoginUrl();
      if (portalWindow && !portalWindow.closed) {
        portalWindow.location.replace(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      portalWindow?.close();
      this.billingPortalError.set(apiErrorMessage(error));
    } finally {
      this.isOpeningBillingPortal.set(false);
    }
  }
}
