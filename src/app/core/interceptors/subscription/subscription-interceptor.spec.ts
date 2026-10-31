import { TestBed } from '@angular/core/testing';
import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { firstValueFrom, of, throwError } from 'rxjs';
import { SubscriptionService } from '../../../features/billing/services/subscription-service/subscription-service';
import { subscriptionInterceptor } from './subscription-interceptor';

describe('subscriptionInterceptor', () => {
  const refresh = vi.fn();
  const interceptor: HttpInterceptorFn = (req, next) =>
    TestBed.runInInjectionContext(() => subscriptionInterceptor(req, next));

  beforeEach(() => {
    refresh.mockReset().mockResolvedValue(null);
    TestBed.configureTestingModule({
      providers: [{ provide: SubscriptionService, useValue: { refresh } }],
    });
  });

  it('should be created', () => {
    expect(interceptor).toBeTruthy();
  });

  it('passes successful responses through without refreshing billing', async () => {
    const request = new HttpRequest('GET', '/api/catalog');
    const response = new HttpResponse({ status: 200, body: { ready: true } });
    const next = vi.fn(() => of(response));

    expect(await firstValueFrom(interceptor(request, next))).toBe(response);
    expect(next).toHaveBeenCalledWith(request);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes billing on 402 and propagates the same error immediately', () => {
    const request = new HttpRequest('POST', '/api/catalog-sync', {});
    const error = new HttpErrorResponse({ status: 402, error: { message: 'Credits exhausted' } });
    refresh.mockReturnValue(new Promise(() => {}));
    let received: unknown;

    interceptor(request, () => throwError(() => error)).subscribe({
      error: (value: unknown) => {
        received = value;
      },
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(received).toBe(error);
  });

  it.each([400, 401, 403, 409, 500])('does not refresh billing for HTTP %s', async (status) => {
    const request = new HttpRequest('GET', '/api/catalog');
    const error = new HttpErrorResponse({ status });

    await expect(firstValueFrom(interceptor(request, () => throwError(() => error)))).rejects.toBe(
      error,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('preserves non-HTTP failures without refreshing billing', async () => {
    const request = new HttpRequest('GET', '/api/catalog');
    const error = new Error('Request failed');

    await expect(firstValueFrom(interceptor(request, () => throwError(() => error)))).rejects.toBe(
      error,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
