import { inject, Service } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { WebhookService } from '../webhook-service/webhook-service';
import {
  MerchantIdentity,
  WooCommerceConnectRequest,
  WooCommerceConnectResponse,
  WooCommerceConnectionStatusResponse,
} from '../../models/woocommerce';

const DEV_IDENTITY_STORAGE_KEY = 'aa_dev_identity';

function readDevIdentity(): Partial<MerchantIdentity> {
  try {
    const raw = localStorage.getItem(DEV_IDENTITY_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<MerchantIdentity>)
      : {};
  } catch {
    return {};
  }
}

@Service()
export class WooCommerceService {
  private readonly merchantApi = inject(MerchantApiService);
  private readonly webhooks = inject(WebhookService);
  private readonly identity = this.readIdentity();
  private connectionInFlight: Promise<WooCommerceConnectionStatusResponse> | null = null;

  private readIdentity(): MerchantIdentity {
    const value = window.AIAssistantConfig ?? readDevIdentity();
    return {
      email: typeof value.email === 'string' ? value.email : '',
      storeUrl: typeof value.storeUrl === 'string' ? value.storeUrl : '',
    };
  }

  connectStore(request: WooCommerceConnectRequest): Promise<WooCommerceConnectResponse> {
    return this.merchantApi.request('POST', 'connection/connect', {
      storeName: request.storeName,
      approvalMode: request.approvalMode,
      ...(request.connectionMode ? { connectionMode: request.connectionMode } : {}),
      ...(request.migrationSourceCode
        ? { migrationSourceCode: request.migrationSourceCode.trim() }
        : {}),
    });
  }

  getConnectionStatus(): Promise<WooCommerceConnectionStatusResponse> {
    this.connectionInFlight ??= this.merchantApi
      .request<WooCommerceConnectionStatusResponse>('GET', 'connection/status')
      .then((result) => {
        if (result.status === 'connected') {
          // PHP checks this status with its site token, recovering it first after
          // a reinstall. The page's injected hasSiteToken can predate that repair.
          this.webhooks.confirmSiteLink();
        }
        return result;
      })
      .finally(() => {
        this.connectionInFlight = null;
      });
    return this.connectionInFlight;
  }

  getIdentity(): MerchantIdentity {
    return this.identity;
  }

  rememberIdentity(email: string, storeUrl: string): void {
    if (window.AIAssistantConfig) {
      return;
    }
    this.identity.email = email;
    this.identity.storeUrl = storeUrl;
    try {
      localStorage.setItem(DEV_IDENTITY_STORAGE_KEY, JSON.stringify({ email, storeUrl }));
    } catch {}
  }
}
