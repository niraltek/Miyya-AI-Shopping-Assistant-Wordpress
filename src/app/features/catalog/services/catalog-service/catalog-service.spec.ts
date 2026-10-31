import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { CatalogService } from './catalog-service';

describe('CatalogService', () => {
  let service: CatalogService;
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: MerchantApiService, useValue: { request } }],
    });
    service = TestBed.inject(CatalogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts a catalog sync using a write request', async () => {
    const run = { syncRunId: 'run-1', status: 'queued' };
    request.mockResolvedValue(run);

    await expect(service.start()).resolves.toBe(run);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'catalog/start');
  });

  it('keeps a run identifier within one URL path segment', async () => {
    const run = { syncRunId: 'run/one ?next=2', status: 'running' };
    request.mockResolvedValue(run);

    await expect(service.getStatus(run.syncRunId)).resolves.toBe(run);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'catalog/run/run%2Fone%20%3Fnext%3D2');
  });

  it('preserves the absence of an earlier catalog run', async () => {
    request.mockResolvedValue(null);

    await expect(service.getLatest()).resolves.toBeNull();
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'catalog/latest');
  });

  it('encodes an error identifier before requesting a retry', async () => {
    const run = { syncRunId: 'run-1', status: 'queued' };
    request.mockResolvedValue(run);

    await expect(service.retryError('error/1?retry=2')).resolves.toBe(run);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'catalog/retry/error%2F1%3Fretry%3D2');
  });

  it('preserves a rejected sync start for the component to handle', async () => {
    const error = new Error('A sync is already running');
    request.mockRejectedValue(error);

    await expect(service.start()).rejects.toBe(error);
  });
});
