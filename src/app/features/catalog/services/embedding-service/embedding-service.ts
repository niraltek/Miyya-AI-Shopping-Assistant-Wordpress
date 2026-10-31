import { Service, inject } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { EmbeddingReindexResponse, MerchantIndexStatusResponse } from '../../models/embedding';

@Service()
export class EmbeddingService {
  private readonly merchantApi = inject(MerchantApiService);

  getStatus(): Promise<MerchantIndexStatusResponse> {
    return this.merchantApi.request('GET', 'embeddings/status');
  }

  reindex(): Promise<EmbeddingReindexResponse> {
    return this.merchantApi.request('POST', 'embeddings/reindex');
  }
}
