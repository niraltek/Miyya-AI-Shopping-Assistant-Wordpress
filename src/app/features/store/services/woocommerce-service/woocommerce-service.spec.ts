import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { WebhookService } from '../webhook-service/webhook-service';
import { WooCommerceService } from './woocommerce-service';

describe('WooCommerceService', () => {
  let service: WooCommerceService;
  const request = vi.fn();
  const storageKey = 'aa_dev_identity';

  beforeEach(() => {
    delete window.AIAssistantConfig;
    localStorage.removeItem(storageKey);
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: MerchantApiService, useValue: { request } }],
    });
  });

  afterEach(() => {
    delete window.AIAssistantConfig;
    localStorage.removeItem(storageKey);
  });

  it('should be created', () => {
    service = TestBed.inject(WooCommerceService);
    expect(service).toBeTruthy();
  });

  it('prefers the injected WordPress identity over saved development identity', () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ email: 'old@example.com', storeUrl: 'https://old.example' }),
    );
    window.AIAssistantConfig = {
      route: '/dashboard',
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
    };
    service = TestBed.inject(WooCommerceService);

    expect(service.getIdentity()).toEqual({
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
    });
  });

  it('restores the development identity after returning from store authorization', () => {
    const identity = { email: 'merchant@example.com', storeUrl: 'https://store.example' };
    localStorage.setItem(storageKey, JSON.stringify(identity));
    service = TestBed.inject(WooCommerceService);

    expect(service.getIdentity()).toEqual(identity);
  });

  it('recovers from malformed development identity storage', () => {
    localStorage.setItem(storageKey, '{not json');
    service = TestBed.inject(WooCommerceService);

    expect(service.getIdentity()).toEqual({ email: '', storeUrl: '' });
  });

  it.each(['null', '[]', '7', '{"email":42,"storeUrl":true}'])(
    'does not invent an identity from invalid saved data: %s',
    (saved) => {
      localStorage.setItem(storageKey, saved);
      expect(TestBed.inject(WooCommerceService).getIdentity()).toEqual({ email: '', storeUrl: '' });
    },
  );

  it('does not fill missing WordPress identity fields from development storage', () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ email: 'old@example.com', storeUrl: 'https://old.example' }),
    );
    window.AIAssistantConfig = { route: '/connect', storeUrl: 'https://current.example' };
    expect(TestBed.inject(WooCommerceService).getIdentity()).toEqual({
      email: '',
      storeUrl: 'https://current.example',
    });
  });

  it('remembers standalone identity in memory and storage', () => {
    service = TestBed.inject(WooCommerceService);
    service.rememberIdentity('new@example.com', 'https://new.example');

    expect(service.getIdentity()).toEqual({
      email: 'new@example.com',
      storeUrl: 'https://new.example',
    });
    expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toEqual(service.getIdentity());
  });

  it('does not replace injected WordPress identity with a remembered identity', () => {
    window.AIAssistantConfig = {
      route: '/dashboard',
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
    };
    service = TestBed.inject(WooCommerceService);
    service.rememberIdentity('other@example.com', 'https://other.example');

    expect(service.getIdentity()).toEqual({
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
    });
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('connects with consent options while keeping identity and return URLs out of the proxy body', async () => {
    service = TestBed.inject(WooCommerceService);
    const response = {
      authorizationUrl: '',
      autoApproved: true,
      redirectUrl: 'https://store.example/connected',
    };
    request.mockResolvedValue(response);

    await expect(
      service.connectStore({
        email: 'merchant@example.com',
        storeUrl: 'https://store.example',
        storeName: 'Example store',
        returnUrl: 'https://store.example/admin',
        approvalMode: 'automatic',
      }),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'connection/connect', {
      storeName: 'Example store',
      approvalMode: 'automatic',
    });
  });

  it('reads connection status through the authenticated plugin API', async () => {
    service = TestBed.inject(WooCommerceService);
    const response = { status: 'pending' };
    request.mockResolvedValue(response);

    await expect(service.getConnectionStatus()).resolves.toBe(response);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'connection/status');
  });

  it('forwards an explicit legacy migration source code to the nonce-protected WordPress route', async () => {
    request.mockResolvedValue({ authorizationUrl: 'https://store.example/authorize' });
    await TestBed.inject(WooCommerceService).connectStore({
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
      approvalMode: 'manual',
      connectionMode: 'connect',
      migrationSourceCode: ' ORIGINAL-SHOP ',
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'connection/connect', {
      storeName: undefined,
      approvalMode: 'manual',
      connectionMode: 'connect',
      migrationSourceCode: 'ORIGINAL-SHOP',
    });
  });

  it('forwards the explicitly selected separate-store mode through the WordPress proxy', async () => {
    request.mockResolvedValue({ authorizationUrl: 'https://store.example/authorize' });
    await TestBed.inject(WooCommerceService).connectStore({
      email: 'merchant@example.com',
      storeUrl: 'https://store.example',
      approvalMode: 'manual',
      connectionMode: 'separate',
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'connection/connect', {
      storeName: undefined,
      approvalMode: 'manual',
      connectionMode: 'separate',
    });
  });

  it('shares an in-flight connection check across the connect form, banner and chat', async () => {
    service = TestBed.inject(WooCommerceService);
    let finish!: (value: { status: string }) => void;
    request.mockResolvedValue({ status: 'failed' });
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = service.getConnectionStatus();
    const second = service.getConnectionStatus();
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    finish({ status: 'failed' });
    await first;
    request.mockResolvedValueOnce({ status: 'connected' });
    await service.getConnectionStatus();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('preserves connection refusals for the connect screen', async () => {
    window.AIAssistantConfig = { route: '/settings', hasSiteToken: false };
    service = TestBed.inject(WooCommerceService);
    const error = new Error('Connection refused');
    request.mockRejectedValue(error);

    await expect(service.getConnectionStatus()).rejects.toBe(error);
    expect(TestBed.inject(WebhookService).isSiteLinked()).toBe(false);
  });

  it.each(['failed', 'pending', 'revoked'])(
    'does not claim a restored secure link from a %s status',
    async (status) => {
      window.AIAssistantConfig = { route: '/settings', hasSiteToken: false };
      service = TestBed.inject(WooCommerceService);
      request.mockResolvedValue({ status });

      await service.getConnectionStatus();

      expect(TestBed.inject(WebhookService).isSiteLinked()).toBe(false);
    },
  );
});
