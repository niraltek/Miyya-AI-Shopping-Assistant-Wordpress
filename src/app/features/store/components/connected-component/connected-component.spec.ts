import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ConnectedComponent } from './connected-component';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { WebhookService } from '../../services/webhook-service/webhook-service';

const SETUP_URL = 'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-setup';

describe('ConnectedComponent', () => {
  const store = {
    name: 'elvora',
    storeUrl: 'https://shop.example.com',
    merchantEmail: 'a@b.c',
  };

  /** navigateTop() ends in window.top.location.assign; jsdom's top is this window. */
  function captureNavigation(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);
    return assign;
  }

  async function mount(
    webhookOutcome: 'registered' | 'skipped' | 'failed' = 'skipped',
    pending?: Promise<{ outcome: 'registered' }>,
  ) {
    TestBed.configureTestingModule({
      imports: [ConnectedComponent],
      providers: [provideHttpClient(), provideRouter([])],
    });
    const woo = TestBed.inject(WooCommerceService);
    vi.spyOn(woo, 'getIdentity').mockReturnValue({
      email: 'a@b.c',
      storeUrl: store.storeUrl,
    } as never);
    vi.spyOn(woo, 'getConnectionStatus').mockResolvedValue({
      status: 'connected',
      store,
    } as never);
    vi.spyOn(woo, 'rememberIdentity').mockImplementation(() => undefined);
    vi.spyOn(TestBed.inject(WebhookService), 'registerProductWebhooks').mockReturnValue(
      pending ??
        Promise.resolve({
          outcome: webhookOutcome,
        }),
    );

    const fixture = TestBed.createComponent(ConnectedComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.AIAssistantConfig = undefined;
  });

  it('offers one way forward - Continue setup - and no portal sign-in step', async () => {
    const fixture = await mount();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('WooCommerce Connected Successfully');
    expect(el.querySelector('[data-testid="connected-continue-setup"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="connected-complete-step"]')).toBeNull();
    expect(el.querySelector('[data-testid="connected-go-dashboard"]')).toBeNull();
    expect(el.textContent).not.toContain('Complete this step');
    expect(el.textContent).not.toContain('Merchant Portal');
  });

  it('hands the merchant to Miyya Setup, in the top window, when they press Continue setup', async () => {
    window.AIAssistantConfig = { route: '/woocommerce/connected', setupUrl: SETUP_URL };
    const assign = captureNavigation();
    const fixture = await mount();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="connected-continue-setup"]')!
      .click();

    expect(assign).toHaveBeenCalledWith(SETUP_URL);
  });

  it('continues to Miyya Setup by itself once the webhooks are registered', async () => {
    window.AIAssistantConfig = { route: '/woocommerce/connected', setupUrl: SETUP_URL };
    const assign = captureNavigation();
    const fixture = await mount('registered');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="connected-continuing"]'),
    ).not.toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(SETUP_URL);
  });

  it('waits for actual webhook registration before continuing, without a handoff delay', async () => {
    window.AIAssistantConfig = { route: '/woocommerce/connected', setupUrl: SETUP_URL };
    const assign = captureNavigation();
    let finish!: (result: { outcome: 'registered' }) => void;
    const fixture = await mount('registered', new Promise((resolve) => (finish = resolve)));
    expect(assign).not.toHaveBeenCalled();
    finish({ outcome: 'registered' });
    await fixture.whenStable();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(assign).toHaveBeenCalledWith(SETUP_URL);
  });

  it('stays put, with Retry beside the warning, when the webhooks could not be registered', async () => {
    window.AIAssistantConfig = { route: '/woocommerce/connected', setupUrl: SETUP_URL };
    const assign = captureNavigation();
    const fixture = await mount('failed');

    fixture.detectChanges();

    expect(assign).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Retry');
  });

  describe('while the backend is still verifying the store', () => {
    function mountWithStatuses(statuses: Array<'pending' | 'connected'>) {
      TestBed.configureTestingModule({
        imports: [ConnectedComponent],
        providers: [provideHttpClient(), provideRouter([])],
      });
      const woo = TestBed.inject(WooCommerceService);
      vi.spyOn(woo, 'getIdentity').mockReturnValue({
        email: 'a@b.c',
        storeUrl: store.storeUrl,
      } as never);
      const status = vi.spyOn(woo, 'getConnectionStatus');
      statuses.forEach((value, index) => {
        const result = { status: value, store: value === 'connected' ? store : undefined } as never;
        // the last answer repeats, like a backend that has settled
        if (index === statuses.length - 1) status.mockResolvedValue(result);
        else status.mockResolvedValueOnce(result);
      });
      vi.spyOn(woo, 'rememberIdentity').mockImplementation(() => undefined);
      vi.spyOn(TestBed.inject(WebhookService), 'registerProductWebhooks').mockResolvedValue({
        outcome: 'skipped',
      } as never);
      const fixture = TestBed.createComponent(ConnectedComponent);
      fixture.detectChanges();
      return { fixture, status };
    }

    it('waits through a slow verification instead of calling the store failed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval'] });
      // ten checks (about 15s) still pending - past the old 6s window - then connected
      const { fixture } = mountWithStatuses([...Array(10).fill('pending'), 'connected']);

      await vi.advanceTimersByTimeAsync(ConnectedComponent.VERIFY_DELAY_MS * 11);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'WooCommerce Connected Successfully',
      );
    });

    it('shows the backend error when connection verification fails', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval'] });
      const { fixture, status } = mountWithStatuses(['pending']);
      status.mockRejectedValue(
        new HttpErrorResponse({
          status: 503,
          error: { detail: 'Verification is temporarily paused.' },
        }),
      );
      await vi.advanceTimersByTimeAsync(ConnectedComponent.VERIFY_DELAY_MS);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Verification is temporarily paused.',
      );
    });

    it('keeps a pending verification pending instead of failing after a fixed time window', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval'] });
      const { fixture, status } = mountWithStatuses(['pending']);

      await vi.advanceTimersByTimeAsync(ConnectedComponent.VERIFY_DELAY_MS * 40);
      fixture.detectChanges();

      expect(status.mock.calls.length).toBeGreaterThan(20);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Verifying your store connection',
      );
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'WooCommerce Connected Successfully',
      );
    });

    it('stops checking when the verification screen is destroyed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval'] });
      const { fixture, status } = mountWithStatuses(['pending']);
      await vi.advanceTimersByTimeAsync(0);
      fixture.destroy();
      const calls = status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ConnectedComponent.VERIFY_DELAY_MS * 4);
      expect(status).toHaveBeenCalledTimes(calls);
    });
  });

  it('does not navigate by itself outside WordPress, where there is no setup page URL', async () => {
    const assign = captureNavigation();
    await mount('registered');

    expect(assign).not.toHaveBeenCalled();
  });

  it('retries the existing pending claim after approval without creating a replacement request', async () => {
    TestBed.configureTestingModule({
      imports: [ConnectedComponent],
      providers: [provideHttpClient(), provideRouter([])],
    });
    const woo = TestBed.inject(WooCommerceService);
    vi.spyOn(woo, 'getIdentity').mockReturnValue({ email: 'a@b.c', storeUrl: store.storeUrl });
    const status = vi
      .spyOn(woo, 'getConnectionStatus')
      .mockRejectedValueOnce(
        new HttpErrorResponse({
          status: 409,
          error: {
            detail: {
              code: 'STORE_IDENTITY_CONFLICT',
              message: 'Approve this destination.',
              handshakeId: 'pending-1',
            },
          },
        }),
      )
      .mockResolvedValueOnce({ status: 'connected', store } as never);
    const connect = vi.spyOn(woo, 'connectStore');
    vi.spyOn(TestBed.inject(WebhookService), 'registerProductWebhooks').mockResolvedValue({
      outcome: 'skipped',
    });
    const fixture = TestBed.createComponent(ConnectedComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Approve this destination.');
    fixture.nativeElement.querySelector('[data-testid="identity-retry"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(status).toHaveBeenCalledTimes(2);
    expect(connect).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('WooCommerce Connected Successfully');
  });
});
