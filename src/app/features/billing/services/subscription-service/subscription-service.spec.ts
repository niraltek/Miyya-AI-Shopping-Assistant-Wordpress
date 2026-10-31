import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import { SubscriptionStatus } from '../../models/subscription';
import { SubscriptionService } from './subscription-service';

function subscription(overrides: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    enforced: true,
    allowed: true,
    state: 'enabled',
    reason: 'active',
    subscriptionStatus: null,
    trialEndsAt: null,
    remainingTrialDays: 0,
    currentPeriodEnd: null,
    accessUntil: null,
    cancelAtPeriodEnd: false,
    manageUrl: 'https://portal.example/billing',
    creditsRemaining: 100,
    catalogReady: true,
    assistantReady: true,
    ...overrides,
  };
}

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  const request = vi.fn();
  const getConnectionStatus = vi.fn();

  beforeEach(() => {
    request.mockReset();
    getConnectionStatus.mockReset().mockResolvedValue({ status: 'connected' });
    TestBed.configureTestingModule({
      providers: [
        { provide: MerchantApiService, useValue: { request } },
        { provide: WooCommerceService, useValue: { getConnectionStatus } },
      ],
    });
    service = TestBed.inject(SubscriptionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('does not request a subscription until the store is connected', async () => {
    getConnectionStatus.mockResolvedValueOnce({ status: 'failed' });
    request.mockResolvedValue(subscription());
    await expect(service.load()).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(service.loaded()).toBe(true);
    request.mockResolvedValueOnce(subscription());
    await service.refresh();
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'subscription/status');
  });

  it('shares one load and publishes the settled status through its signals', async () => {
    const status = subscription();
    request.mockResolvedValue(status);

    expect(service.loaded()).toBe(false);
    expect(service.status()).toBeNull();
    const first = service.load();
    expect(service.load()).toBe(first);
    await expect(first).resolves.toBe(status);
    expect(service.loaded()).toBe(true);
    expect(service.status()).toBe(status);
    expect(service.blocked()).toBe(false);
    expect(service.notice()).toBeNull();
    expect(service.load()).toBe(first);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'subscription/status');
  });

  it('settles a failed lookup without rejecting and can refresh afterward', async () => {
    request.mockRejectedValueOnce(new Error('offline'));

    await expect(service.load()).resolves.toBeNull();
    expect(service.loaded()).toBe(true);
    expect(service.status()).toBeNull();
    expect(service.notice()).toBeNull();

    const status = subscription({
      allowed: false,
      reason: 'trial_expired',
      notice: {
        tone: 'error',
        title: 'Your free trial has ended',
        detail: 'Select a plan to continue.',
        actionLabel: 'Purchase Miyya',
      },
    });
    request.mockResolvedValueOnce(status);
    await expect(service.refresh()).resolves.toBe(status);
    expect(request).toHaveBeenCalledTimes(2);
    expect(service.blocked()).toBe(true);
    expect(service.notice()).toMatchObject({
      tone: 'error',
      title: 'Your free trial has ended',
      actionLabel: 'Purchase Miyya',
    });
  });

  it('shows no warning and does not block when enforcement is disabled', async () => {
    request.mockResolvedValue(
      subscription({ enforced: false, allowed: false, reason: 'trial_expired' }),
    );

    await service.load();

    expect(service.blocked()).toBe(false);
    expect(service.notice()).toBeNull();
  });

  it.each([
    [1, 'warning', 'Your trial ends tomorrow'],
    [3, 'warning', '3 days left in your trial'],
    [7, 'info', '7 days left in your trial'],
  ] as const)('shows the trial reminder for %i remaining days', async (days, tone, title) => {
    request.mockResolvedValue(
      subscription({
        reason: 'trial_active',
        remainingTrialDays: days,
        notice: {
          tone,
          title,
          detail: 'A reminder from the backend.',
          actionLabel: 'Manage billing',
        },
      }),
    );

    await service.load();

    expect(service.blocked()).toBe(false);
    expect(service.notice()).toMatchObject({ tone, title, actionLabel: 'Manage billing' });
  });

  it.each([
    ['credits_exhausted', 'warning', 'Recharge credits'],
    ['trial_usage_limit', 'warning', 'Purchase Miyya'],
    ['trial_daily_limit', 'info', 'Manage billing'],
  ] as const)(
    'explains a usage refusal without treating %s as a missing subscription',
    async (reason, tone, actionLabel) => {
      request.mockResolvedValue(
        subscription({
          reason,
          notice: {
            tone,
            title: 'Backend usage notice',
            detail: 'The backend explains this limit.',
            actionLabel,
          },
        }),
      );

      await service.load();

      expect(service.blocked()).toBe(false);
      expect(service.notice()).toMatchObject({ tone, actionLabel });
    },
  );

  it('updates the notice when a blocked subscription becomes active', async () => {
    request.mockResolvedValueOnce(
      subscription({
        allowed: false,
        reason: 'no_subscription',
        notice: {
          tone: 'info',
          title: 'Backend activation notice',
          detail: 'Choose a plan on the server.',
          actionLabel: 'Choose a plan',
        },
      }),
    );
    await service.load();
    expect(service.blocked()).toBe(true);
    expect(service.notice()?.actionLabel).toBe('Choose a plan');

    request.mockResolvedValueOnce(subscription());
    await service.refresh();

    expect(service.blocked()).toBe(false);
    expect(service.notice()).toBeNull();
  });
});
