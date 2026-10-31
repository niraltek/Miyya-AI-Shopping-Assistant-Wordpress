import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from './merchant-api-service';

describe('MerchantApiService', () => {
  let service: MerchantApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    delete window.AIAssistantConfig;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MerchantApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    delete window.AIAssistantConfig;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('sends the WordPress nonce, cookie credentials and request body to the plugin API', async () => {
    window.AIAssistantConfig = {
      route: '/setup',
      merchantApiUrl: 'https://store.example/wp-json/miyya/v1/',
      restNonce: 'fresh-nonce',
    };
    const result = service.request('POST', 'setup/state', { chatVerified: false });
    const request = http.expectOne('https://store.example/wp-json/miyya/v1/setup/state');

    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-WP-Nonce')).toBe('fresh-nonce');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({ chatVerified: false });
    request.flush({ chatVerified: false });

    await expect(result).resolves.toEqual({ chatVerified: false });
  });

  it.each([
    undefined,
    { route: '/setup', merchantApiUrl: 'https://store.example/api/' },
    { route: '/setup', restNonce: 'nonce' },
  ])('rejects incomplete WordPress configuration without making a request (%j)', async (config) => {
    window.AIAssistantConfig = config;
    const request = vi.spyOn(TestBed.inject(HttpClient), 'request');

    await expect(service.request('GET', 'connection/status')).rejects.toThrow(
      'Open Miyya in WordPress administration',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves HTTP failures so the calling screen can handle them', async () => {
    window.AIAssistantConfig = {
      route: '/setup',
      merchantApiUrl: 'https://store.example/api/',
      restNonce: 'nonce',
    };
    const result = service.request('GET', 'connection/status');
    const assertion = expect(result).rejects.toMatchObject({
      status: 403,
      error: { code: 'rest_forbidden' },
    });
    http
      .expectOne('https://store.example/api/connection/status')
      .flush({ code: 'rest_forbidden' }, { status: 403, statusText: 'Forbidden' });

    await assertion;
  });
});
