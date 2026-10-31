import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { EmbeddingService } from './embedding-service';

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: MerchantApiService, useValue: { request } }],
    });
    service = TestBed.inject(EmbeddingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reads the current indexing and catalog status without starting work', async () => {
    const status = { embedding: null, catalogSync: null };
    request.mockResolvedValue(status);

    await expect(service.getStatus()).resolves.toBe(status);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'embeddings/status');
  });

  it('requests a reindex using a write request', async () => {
    const result = { status: 'queued' };
    request.mockResolvedValue(result);

    await expect(service.reindex()).resolves.toBe(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'embeddings/reindex');
  });

  it('preserves a reindex refusal for the screen to explain', async () => {
    const error = new Error('Catalog not ready');
    request.mockRejectedValue(error);

    await expect(service.reindex()).rejects.toBe(error);
  });
});
