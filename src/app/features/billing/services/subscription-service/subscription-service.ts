import { computed, inject, Service, signal } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import { SubscriptionNotice, SubscriptionStatus } from '../../models/subscription';

@Service()
export class SubscriptionService {
  private readonly merchantApi = inject(MerchantApiService);
  private readonly woocommerce = inject(WooCommerceService);
  private readonly state = signal<SubscriptionStatus | null>(null);
  private readonly settled = signal(false);
  private inFlight: Promise<SubscriptionStatus | null> | null = null;
  readonly status = this.state.asReadonly();
  readonly loaded = this.settled.asReadonly();
  readonly blocked = computed(() => {
    const value = this.state();
    return !!value && value.enforced && !value.allowed;
  });

  load(): Promise<SubscriptionStatus | null> {
    this.inFlight ??= this.woocommerce
      .getConnectionStatus()
      .then((connection) =>
        connection.status === 'connected'
          ? this.merchantApi.request<SubscriptionStatus>('GET', 'subscription/status')
          : null,
      )
      .then((value) => {
        this.state.set(value);
        return value;
      })
      .catch(() => {
        this.state.set(null);
        return null;
      })
      .finally(() => this.settled.set(true));
    return this.inFlight;
  }

  refresh(): Promise<SubscriptionStatus | null> {
    this.inFlight = null;
    return this.load();
  }
  readonly notice = computed<SubscriptionNotice | null>(() => {
    const value = this.state();
    return value?.enforced ? (value.notice ?? null) : null;
  });
}
