import { inject, Service } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { PortalAccessResponse } from '../../models/setup';
import { apiErrorMessage } from '../../../../shared/utils/api-response';

@Service()
export class PortalAccessService {
  private readonly merchantApi = inject(MerchantApiService);

  async billingLoginUrl(): Promise<string> {
    return this.loginUrl('/layout/billing');
  }

  async storesLoginUrl(): Promise<string> {
    return this.loginUrl('/layout/store');
  }

  private async loginUrl(returnUrl: string): Promise<string> {
    const result = await this.merchantApi.request<PortalAccessResponse>('GET', 'portal/access');
    if (!result.email || !result.portalLoginUrl) {
      throw new Error(apiErrorMessage(result));
    }
    let loginUrl: URL;
    try {
      loginUrl = new URL(result.portalLoginUrl);
      if (!['http:', 'https:'].includes(loginUrl.protocol)) throw new Error();
    } catch {
      throw new Error(apiErrorMessage(result));
    }
    loginUrl.searchParams.set('email', result.email);
    loginUrl.searchParams.set('returnUrl', returnUrl);
    return loginUrl.toString();
  }
}
