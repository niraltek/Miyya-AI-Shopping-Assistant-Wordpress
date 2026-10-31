import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { PortalAccessService } from './portal-access-service';
import { REQUEST_FAILED_MESSAGE } from '../../../../shared/utils/api-response';

describe('PortalAccessService', () => {
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [PortalAccessService, { provide: MerchantApiService, useValue: { request } }],
    });
  });

  it('opens the configured portal without requesting another password', async () => {
    request.mockResolvedValue({
      codeSent: true,
      email: 'merchant@example.com',
      portalLoginUrl: 'http://localhost:4300/login',
    });

    const url = new URL(await TestBed.inject(PortalAccessService).billingLoginUrl());

    expect(request).toHaveBeenCalledWith('GET', 'portal/access');
    expect(url.origin).toBe('http://localhost:4300');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.has('otp')).toBe(false);
    expect(url.searchParams.get('email')).toBe('merchant@example.com');
    expect(url.searchParams.get('returnUrl')).toBe('/layout/billing');
  });

  it('rejects a missing portal URL', async () => {
    request.mockResolvedValue({ email: 'merchant@example.com', portalLoginUrl: '' });

    await expect(TestBed.inject(PortalAccessService).billingLoginUrl()).rejects.toThrow(
      REQUEST_FAILED_MESSAGE,
    );
  });

  it('opens store approvals through the portal login instead of the billing screen', async () => {
    request.mockResolvedValue({
      email: 'owner@example.com',
      portalLoginUrl: 'https://portal.example.com/login',
    });
    const service = TestBed.inject(PortalAccessService) as unknown as {
      storesLoginUrl(): Promise<string>;
    };
    const url = new URL(await service.storesLoginUrl());
    expect(url.origin).toBe('https://portal.example.com');
    expect(url.searchParams.get('email')).toBe('owner@example.com');
    expect(url.searchParams.get('returnUrl')).toBe('/layout/store');
  });

  it('rejects a portal URL that cannot be safely opened as a web page', async () => {
    request.mockResolvedValue({
      email: 'merchant@example.com',
      portalLoginUrl: 'javascript:alert(1)',
    });
    await expect(TestBed.inject(PortalAccessService).billingLoginUrl()).rejects.toThrow(
      REQUEST_FAILED_MESSAGE,
    );
  });
});
