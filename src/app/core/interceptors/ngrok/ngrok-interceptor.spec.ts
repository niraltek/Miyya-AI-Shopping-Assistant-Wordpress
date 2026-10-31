import { TestBed } from '@angular/core/testing';
import { HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { ngrokInterceptor } from './ngrok-interceptor';

describe('ngrokInterceptor', () => {
  const interceptor: HttpInterceptorFn = (req, next) =>
    TestBed.runInInjectionContext(() => ngrokInterceptor(req, next));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(interceptor).toBeTruthy();
  });

  it.each([
    'https://shop.ngrok.io/api/products',
    'https://shop.ngrok-free.app/api/products',
    'https://shop.ngrok.dev/api/products',
    'https://shop.NGROK-FREE.APP/api/products',
  ])('adds the bypass header only to a matching ngrok host: %s', (url) => {
    const request = new HttpRequest('GET', url);
    const next = vi.fn((_request: HttpRequest<unknown>) => of(new HttpResponse({ status: 200 })));

    interceptor(request, next).subscribe();

    const forwarded = next.mock.calls[0][0] as HttpRequest<unknown>;
    expect(forwarded.headers.get('ngrok-skip-browser-warning')).toBe('true');
    expect(forwarded.url).toBe(request.url);
    expect(request.headers.has('ngrok-skip-browser-warning')).toBe(false);
  });

  it.each([
    '/api/products',
    'https://example.com/api/products',
    'https://shop.ngrok.io.evil.test/api/products',
    'https://notngrok.io/api/products',
    'http://[invalid',
  ])('leaves other request hosts unchanged: %s', (url) => {
    const request = new HttpRequest('GET', url);
    const next = vi.fn((_request: HttpRequest<unknown>) => of(new HttpResponse({ status: 200 })));

    interceptor(request, next).subscribe();

    expect(next).toHaveBeenCalledWith(request);
    expect(request.headers.has('ngrok-skip-browser-warning')).toBe(false);
  });
});
