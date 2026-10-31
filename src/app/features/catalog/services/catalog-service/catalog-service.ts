import { Service, inject } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { CatalogSyncStartResponse, CatalogSyncStatusResponse } from '../../models/catalog';

@Service()
export class CatalogService {
  private readonly merchantApi = inject(MerchantApiService);

  start(): Promise<CatalogSyncStartResponse> {
    return this.merchantApi.request('POST', 'catalog/start');
  }

  getStatus(syncRunId: string): Promise<CatalogSyncStatusResponse> {
    return this.merchantApi.request('GET', `catalog/run/${encodeURIComponent(syncRunId)}`);
  }

  getLatest(): Promise<CatalogSyncStatusResponse | null> {
    return this.merchantApi.request('GET', 'catalog/latest');
  }

  retryError(errorId: string): Promise<CatalogSyncStatusResponse> {
    return this.merchantApi.request('POST', `catalog/retry/${encodeURIComponent(errorId)}`);
  }
}
