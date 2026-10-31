import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { SetupComponent } from './setup-component';
import { CatalogSyncStatusResponse } from '../../../catalog/models/catalog';
import { MerchantIndexStatusResponse } from '../../../catalog/models/embedding';
import { LaunchCheckItem, SetupState } from '../../models/setup';
import { SubscriptionStatus } from '../../../billing/models/subscription';
import { MerchantStoreConnection } from '../../../store/models/woocommerce';
import { CatalogService } from '../../../catalog/services/catalog-service/catalog-service';
import { ChatLauncher } from '../../../chat/services/chat-launcher/chat-launcher';
import { EmbeddingService } from '../../../catalog/services/embedding-service/embedding-service';
import { PortalAccessService } from '../../services/portal-access-service/portal-access-service';
import { SetupService } from '../../services/setup-service/setup-service';
import { SubscriptionService } from '../../../billing/services/subscription-service/subscription-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';

const STORE: MerchantStoreConnection = {
  storeUrl: 'https://shop.example.com',
  platform: 'woocommerce',
  status: 'connected',
  permission: 'read',
  connectedAt: '2026-10-10T10:00:00Z',
  catalogStatus: false,
};

const NO_PLAN: SubscriptionStatus = {
  enforced: true,
  allowed: false,
  state: 'disabled',
  reason: 'no_subscription',
  subscriptionStatus: null,
  trialEndsAt: null,
  remainingTrialDays: 0,
  currentPeriodEnd: null,
  accessUntil: null,
  cancelAtPeriodEnd: false,
  manageUrl: 'https://portal.example.com/layout/billing',
  creditsRemaining: 0,
  catalogReady: true,
  assistantReady: false,
};
const TRIAL: SubscriptionStatus = {
  ...NO_PLAN,
  allowed: true,
  state: 'enabled',
  reason: 'trial_active',
  remainingTrialDays: 14,
  creditsRemaining: 2000,
  assistantReady: true,
};

const STATE: SetupState = {
  startedAt: '2026-10-10T09:59:00Z',
  chatVerifiedAt: null,
  launchedAt: null,
  legacy: false,
  visibility: 'admins',
  storefrontUrl: 'https://shop.example.com/',
};

function run(overrides: Partial<CatalogSyncStatusResponse> = {}): CatalogSyncStatusResponse {
  return {
    syncRunId: 'run-1',
    status: 'completed',
    pagesProcessed: 1,
    productsReceived: 10,
    productsCreated: 10,
    productsUpdated: 0,
    productsFailed: 0,
    productsSkipped: 0,
    startedAt: '2026-10-10T10:05:00Z',
    errors: [],
    ...overrides,
  };
}

function readyIndex(
  overrides: Partial<MerchantIndexStatusResponse> = {},
): MerchantIndexStatusResponse {
  return {
    catalogSync: run(),
    embeddingIndex: {
      indexRunId: 'idx-1',
      status: 'ready',
      totalProducts: 10,
      processedProducts: 10,
      embeddedProducts: 10,
      updatedProducts: 0,
      unchangedProducts: 0,
      failedProducts: 0,
      progressPercent: 100,
      startedAt: '2026-10-10T10:06:00Z',
    },
    catalogCounts: { productsSynced: 10, productsIndexed: 10 },
    ...overrides,
  };
}

function check(id: string, passed: boolean): LaunchCheckItem {
  return {
    id,
    label: `Check ${id}`,
    passed,
    detail: `${id} detail`,
    fix: passed ? '' : `Fix ${id}`,
  };
}

interface World {
  connection?: { status: string; store?: Partial<MerchantStoreConnection> } | 'unreachable';
  index?: MerchantIndexStatusResponse | null;
  plan?: SubscriptionStatus | null;
  state?: SetupState;
  /** Makes `POST catalog/start` fail, as the backend does with a 409 for a run in flight. */
  startError?: unknown;
}

describe('SetupComponent', () => {
  let woo: {
    getConnectionStatus: ReturnType<typeof vi.fn>;
    getIdentity: ReturnType<typeof vi.fn>;
    connectStore: ReturnType<typeof vi.fn>;
    rememberIdentity: ReturnType<typeof vi.fn>;
  };
  let catalog: {
    start: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    retryError: ReturnType<typeof vi.fn>;
  };
  let embeddings: { getStatus: ReturnType<typeof vi.fn>; reindex: ReturnType<typeof vi.fn> };
  let setup: Record<
    'getState' | 'setChatVerified' | 'confirmLaunch' | 'getLaunchCheck' | 'launch' | 'startTrial',
    ReturnType<typeof vi.fn>
  >;
  let planStatus: ReturnType<typeof signal<SubscriptionStatus | null>>;
  let subscription: {
    status: unknown;
    loaded: unknown;
    load: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
  let portalAccess: { billingLoginUrl: ReturnType<typeof vi.fn> };
  let launcher: ChatLauncher;
  let assign: ReturnType<typeof vi.fn>;

  /** Lets every promise the component chains on resolve, then renders. */
  async function settle(fixture: { detectChanges(): void }): Promise<void> {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    }
  }

  async function mount(world: World = {}, beforeInit?: () => void) {
    const connection = world.connection ?? { status: 'connected', store: STORE };
    woo = {
      getConnectionStatus:
        connection === 'unreachable'
          ? vi.fn().mockRejectedValue(new Error('offline'))
          : vi.fn().mockResolvedValue({
              status: connection.status,
              store: connection.store ? { ...STORE, ...connection.store } : undefined,
            }),
      getIdentity: vi.fn().mockReturnValue({
        email: 'a@b.c',
        storeUrl:
          connection !== 'unreachable'
            ? (connection.store?.storeUrl ?? STORE.storeUrl)
            : STORE.storeUrl,
      }),
      connectStore: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://shop.example.com/wc-auth/v1/authorize?x=1',
      }),
      rememberIdentity: vi.fn(),
    };
    catalog = {
      start: world.startError
        ? vi.fn().mockRejectedValue(world.startError)
        : vi.fn().mockResolvedValue({ syncRunId: 'run-1', status: 'queued' }),
      getStatus: vi
        .fn()
        .mockResolvedValue(run({ status: 'running', expectedTotal: 40, productsReceived: 10 })),
      retryError: vi.fn().mockResolvedValue(run()),
    };
    embeddings = {
      getStatus: vi
        .fn()
        .mockResolvedValue(
          world.index === undefined
            ? { catalogCounts: { productsSynced: 0, productsIndexed: 0 } }
            : world.index,
        ),
      reindex: vi.fn().mockResolvedValue({ indexRunId: 'idx-2', status: 'queued' }),
    };
    let savedState = world.state ?? STATE;
    setup = {
      getState: vi.fn().mockImplementation(async () => savedState),
      setChatVerified: vi.fn().mockImplementation((verified: boolean) =>
        Promise.resolve(
          (savedState = {
            ...savedState,
            chatVerifiedAt: verified ? '2026-10-10T11:00:00Z' : null,
          }),
        ),
      ),
      confirmLaunch: vi.fn().mockImplementation(
        async () =>
          (savedState = {
            ...savedState,
            launchedAt: '2026-10-10T12:00:00Z',
            visibility: 'everyone',
          }),
      ),
      getLaunchCheck: vi.fn().mockResolvedValue({
        passed: true,
        checks: [check('connection', true), check('catalog', true)],
      }),
      launch: vi.fn().mockImplementation(async () => ({
        published: true,
        verified: true,
        verification: 'verified',
        message: 'Miyya is live on your storefront.',
        storefrontUrl: 'https://shop.example.com/',
        state: (savedState = {
          ...savedState,
          launchedAt: '2026-10-10T12:00:00Z',
          visibility: 'everyone',
        }),
      })),
      startTrial: vi.fn().mockResolvedValue({ trialId: 't1', status: 'active' }),
    };
    planStatus = signal(world.plan === undefined ? NO_PLAN : world.plan);
    subscription = {
      status: planStatus.asReadonly(),
      loaded: signal(true).asReadonly(),
      load: vi.fn().mockResolvedValue(null),
      refresh: vi.fn().mockImplementation(async () => planStatus()),
    };
    portalAccess = {
      billingLoginUrl: vi.fn().mockResolvedValue('https://portal.example.com/login?otp=sent'),
    };

    TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [
        provideRouter([]),
        { provide: WooCommerceService, useValue: woo },
        { provide: CatalogService, useValue: catalog },
        { provide: EmbeddingService, useValue: embeddings },
        { provide: SetupService, useValue: setup },
        { provide: SubscriptionService, useValue: subscription },
        { provide: PortalAccessService, useValue: portalAccess },
      ],
    });
    launcher = TestBed.inject(ChatLauncher);
    launcher.close();

    assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);

    beforeInit?.();
    const fixture = TestBed.createComponent(SetupComponent);
    fixture.detectChanges();
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const panel = (el: HTMLElement, step: string) =>
    el.querySelector(`[data-testid="setup-panel-${step}"]`);
  const click = (el: HTMLElement, testId: string) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();

  it.each(['no_subscription', 'trial_expired', 'credits_exhausted'])(
    'allows widget-only configuration when service reports %s', async (reason) => {
      const { fixture, el } = await mount({ plan: { ...NO_PLAN, reason } });
      click(el, 'setup-widget-only');
      await settle(fixture);
      expect(setup.startTrial).not.toHaveBeenCalled();
      expect(setup.getLaunchCheck).toHaveBeenCalled();
      expect(panel(el, 'launch')).not.toBeNull();
    },
  );

  it.each([
    ['smtp_accepted', 'Welcome email sent'],
    ['pending', 'Welcome email pending'],
    ['not_required', 'Welcome email not needed'],
  ] as const)('shows welcome email status %s without action controls', async (status, label) => {
    const { el } = await mount({
      connection: {
        status: 'connected',
        store: {
          catalogStatus: true,
          portalInviteStatus: status,
          merchantEmail: 'owner@example.com',
        },
      },
      index: readyIndex(),
    });
    const card = el.querySelector('[data-testid="welcome-email-status"]');
    expect(card?.textContent).toContain(label);
    expect(card?.querySelector('button, a')).toBeNull();
    expect(el.textContent).not.toContain('Email sign-in code');
    expect(el.textContent).not.toContain('Open portal');
  });

  it('shows the actual indexing configuration error', async () => {
    const { fixture, el } = await mount();
    embeddings.reindex.mockRejectedValue(
      new HttpErrorResponse({
        status: 503,
        error: {
          detail: { code: 'RATES_MISSING', message: 'Configure indexing rates in Billing Admin.' },
        },
      }),
    );
    await (fixture.componentInstance as unknown as { reindex(): Promise<void> }).reindex();
    fixture.detectChanges();
    expect(el.textContent).toContain('Configure indexing rates in Billing Admin.');
  });

  it('explains the retry wait when indexing is rate limited', async () => {
    const { fixture, el } = await mount();
    embeddings.reindex.mockRejectedValue(
      new HttpErrorResponse({
        status: 429,
        headers: new HttpHeaders({ 'Retry-After': '125' }),
        error: { message: 'Indexing is paused. Retry after 125 seconds.' },
      }),
    );
    await (fixture.componentInstance as unknown as { reindex(): Promise<void> }).reindex();
    fixture.detectChanges();
    expect(el.textContent).toContain('Indexing is paused. Retry after 125 seconds.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.AIAssistantConfig = undefined;
    localStorage.clear();
  });

  describe('1. connect', () => {
    it('starts on the Connect step for a store that is not connected', async () => {
      const { el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      expect(panel(el, 'connect')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-connect"]')!.textContent).toContain(
        'Connect my store',
      );
      expect(el.textContent).toContain('Read-only: nothing in your store is ever changed');
      expect(catalog.start).not.toHaveBeenCalled();
    });

    it('sends the merchant to WooCommerce after the manual option is chosen, in the top window, with this site as the return page', async () => {
      window.AIAssistantConfig = {
        route: '/setup',
        connectedUrl: 'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-connected',
        storeName: 'Elvora',
      };
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(el, 'setup-confirm-connect');
      await settle(fixture);

      expect(woo.connectStore).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.c',
          storeUrl: 'https://shop.example.com',
          storeName: 'Elvora',
          returnUrl: 'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-connected',
          approvalMode: 'manual',
        }),
      );
      expect(assign).toHaveBeenCalledWith('https://shop.example.com/wc-auth/v1/authorize?x=1');
    });

    it('skips the WooCommerce approve screen when the plugin approved the connection itself', async () => {
      const connected =
        'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-connected&aaProvisionToken=abc';
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });
      woo.connectStore.mockResolvedValue({
        authorizationUrl: 'https://shop.example.com/wc-auth/v1/authorize?x=1',
        autoApproved: true,
        redirectUrl: connected,
      });

      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(el, 'setup-confirm-connect');
      await settle(fixture);

      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(connected);
    });

    it('falls back to the WooCommerce approve screen when the plugin could not approve', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });
      woo.connectStore.mockResolvedValue({
        authorizationUrl: 'https://shop.example.com/wc-auth/v1/authorize?x=1',
        autoApproved: false,
        autoApproveReason: 'woocommerce_unavailable',
      });

      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(el, 'setup-confirm-connect');
      await settle(fixture);

      expect(assign).toHaveBeenCalledWith('https://shop.example.com/wc-auth/v1/authorize?x=1');
    });

    it('states the read-only access in words right above the button that connects', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      click(el, 'setup-connect');
      await settle(fixture);

      const consent = el.querySelector('[data-testid="setup-consent"]')!;
      expect(consent.textContent).toContain('read');
      expect(consent.textContent).toContain('cannot add, change or delete anything');
      expect(el.querySelector('[data-testid="setup-confirm-connect"]')!.textContent).toContain(
        'Allow & connect',
      );
      expect(consent.textContent).toContain('Allow & connect');
    });

    it('opens the Terms as a dialog over the connect options and closes it again', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      click(el, 'setup-connect');
      await settle(fixture);
      expect(el.querySelector('app-terms-component')).toBeNull();

      click(el, 'setup-open-terms');
      fixture.detectChanges();

      const terms = el.querySelector<HTMLElement>('app-terms-component')!;
      expect(terms.querySelector('[role="dialog"]')!.textContent).toContain(
        'Store connection and your data',
      );
      expect(terms.querySelector('nav')).toBeNull();
      expect(terms.querySelector('a[href="https://niraltek.com/privacy-policy/"]')).not.toBeNull();
      // The connection is approved for the merchant, so the Terms must say so.
      expect(terms.querySelector('[data-testid="terms-auto-approval"]')!.textContent).toContain(
        'approved automatically',
      );
      expect(terms.textContent).toContain("WooCommerce's own Approve screen");
      // Opening the terms must not tick the acceptance checkbox they sit next to.
      expect(el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);

      click(terms, 'terms-close');
      fixture.detectChanges();
      expect(el.querySelector('app-terms-component')).toBeNull();
      expect(el.querySelector('#connection-choice-title')).not.toBeNull();
    });

    it('closes the Terms with Escape', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-open-terms');
      fixture.detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      expect(el.querySelector('app-terms-component')).toBeNull();
    });

    it('requires connection and data-use authorization for both approval modes', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      click(el, 'setup-connect');
      await settle(fixture);

      expect(
        (el.querySelector('[data-testid="setup-confirm-connect"]') as HTMLButtonElement).disabled,
      ).toBe(true);

      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      expect(
        (el.querySelector('[data-testid="setup-confirm-connect"]') as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(woo.connectStore).not.toHaveBeenCalled();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect((el.querySelector('[data-testid="setup-confirm-connect"]') as HTMLButtonElement).disabled).toBe(false);
    });

    it('continues from an accepted one-click choice through chat confirmation and launch', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: TRIAL,
      });
      await settle(fixture);

      expect(setup.setChatVerified).toHaveBeenCalledWith(true);
      expect(setup.getLaunchCheck).toHaveBeenCalled();
      expect(setup.launch).toHaveBeenCalled();
    });

    it.each(['https://first-shop.example.com', 'https://second-shop.example.com'])(
      'completes all six automatic steps for %s using the same owner email without portal approval',
      async (storeUrl) => {
        const domains = ['https://first-shop.example.com', 'https://second-shop.example.com'];
        for (const domain of domains) {
          localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(domain)}`, 'accepted');
        }
        const { fixture, el } = await mount(
          {
            connection: { status: 'connected', store: { storeUrl, catalogStatus: true } },
            index: readyIndex(),
            plan: { ...NO_PLAN, storeLinkStatus: 'linked' },
            state: { ...STATE, storefrontUrl: `${storeUrl}/` },
          },
          () =>
            setup.startTrial.mockImplementation(async () => {
              planStatus.set({ ...TRIAL, storeLinkStatus: 'linked' });
              return { trialId: 'trial-for-this-store', status: 'active' };
            }),
        );
        await settle(fixture);
        expect(el.textContent).toContain(new URL(storeUrl).host);
        expect(setup.startTrial).toHaveBeenCalledOnce();
        expect(setup.setChatVerified).toHaveBeenCalledWith(true);
        expect(setup.launch).toHaveBeenCalledOnce();
        expect(el.querySelector('[data-testid="setup-owner-approval"]')).toBeNull();
        expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="setup-progress"]')?.textContent).toContain('6 of 6');
        expect(
          localStorage.getItem(`aa_automatic_setup:${encodeURIComponent(storeUrl)}`),
        ).toBeNull();
        const otherDomain = domains.find((domain) => domain !== storeUrl)!;
        expect(localStorage.getItem(`aa_automatic_setup:${encodeURIComponent(otherDomain)}`)).toBe(
          'accepted',
        );
      },
    );

    it('shows each automatic card while its real request is pending, without a step delay', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      let finishChat!: (state: SetupState) => void;
      let finishCheck!: (result: object) => void;
      let finishLaunch!: (result: object) => void;
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: TRIAL,
        },
        () => {
          setup.setChatVerified.mockReturnValue(
            new Promise<SetupState>((resolve) => (finishChat = resolve)),
          );
          setup.getLaunchCheck.mockReturnValue(new Promise((resolve) => (finishCheck = resolve)));
          setup.launch.mockReturnValue(new Promise((resolve) => (finishLaunch = resolve)));
        },
      );
      expect(panel(el, 'preview')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-automatic-progress"]')).not.toBeNull();
      expect(setup.getLaunchCheck).not.toHaveBeenCalled();

      finishChat({ ...STATE, chatVerifiedAt: '2026-10-10T11:00:00Z' });
      await settle(fixture);
      expect(panel(el, 'launch')).not.toBeNull();
      expect(setup.launch).not.toHaveBeenCalled();

      finishCheck({ passed: true, checks: [check('chat', true)] });
      await settle(fixture);
      expect(panel(el, 'live')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-live"]')).toBeNull();
      finishLaunch({
        published: true,
        verified: true,
        verification: 'verified',
        state: {
          ...STATE,
          chatVerifiedAt: '2026-10-10T11:00:00Z',
          launchedAt: '2026-10-10T12:00:00Z',
          visibility: 'everyone',
        },
      });
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-progress"]')?.textContent).toContain('6 of 6');
      expect(
        localStorage.getItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`),
      ).toBeNull();
    });

    it('shows an automatic step failure and resumes the remaining steps after retry', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: TRIAL,
        },
        () => setup.setChatVerified.mockRejectedValueOnce(new Error('Could not save chat setup.')),
      );
      expect(panel(el, 'preview')).not.toBeNull();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(
        'Could not save chat setup',
      );
      expect(setup.launch).not.toHaveBeenCalled();
      click(el, 'setup-retry-automatic');
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('resumes Automatic when the merchant completes the previously failed preview manually', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: TRIAL,
        },
        () => setup.setChatVerified.mockRejectedValueOnce(new Error('Please retry.')),
      );
      click(el, 'setup-open-preview');
      await settle(fixture);
      click(el, 'setup-chat-yes');
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('keeps Manual on each decision card until the merchant continues', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: TRIAL,
      });
      expect(panel(el, 'preview')).not.toBeNull();
      expect(setup.setChatVerified).not.toHaveBeenCalled();
      click(el, 'setup-open-preview');
      await settle(fixture);
      click(el, 'setup-chat-yes');
      await settle(fixture);
      expect(panel(el, 'launch')).not.toBeNull();
      expect(setup.launch).not.toHaveBeenCalled();
      click(el, 'setup-continue');
      await settle(fixture);
      expect(panel(el, 'live')).not.toBeNull();
      expect(setup.launch).not.toHaveBeenCalled();
      click(el, 'setup-enable');
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('waits for catalog indexing before activating the trial and completing Automatic', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex({
            embeddingIndex: {
              ...readyIndex().embeddingIndex!,
              status: 'indexing',
              progressPercent: 30,
              processedProducts: 3,
            },
          }),
        },
        () =>
          setup.startTrial.mockImplementation(async () => {
            planStatus.set(TRIAL);
            return { trialId: 't1', status: 'active' };
          }),
      );
      expect(panel(el, 'catalog')).not.toBeNull();
      expect(setup.startTrial).not.toHaveBeenCalled();
      expect(setup.setChatVerified).not.toHaveBeenCalled();
      embeddings.getStatus.mockResolvedValue(readyIndex());
      (fixture.componentInstance as unknown as { onVisibilityChange(): void }).onVisibilityChange();
      await settle(fixture);
      expect(setup.startTrial).toHaveBeenCalledOnce();
      expect(el.querySelector('[data-testid="setup-progress"]')?.textContent).toContain('6 of 6');
    });

    it('holds Automatic at the trial card while waitlisted and resumes when the plan becomes active', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: { ...NO_PLAN, reason: 'trial_waitlisted' },
      });
      expect(panel(el, 'trial')).not.toBeNull();
      expect(setup.setChatVerified).not.toHaveBeenCalled();
      planStatus.set(TRIAL);
      (fixture.componentInstance as unknown as { onVisibilityChange(): void }).onVisibilityChange();
      await settle(fixture);
      expect(setup.startTrial).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('does not publish when a real launch check fails and continues after the check is fixed', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: TRIAL,
        },
        () =>
          setup.getLaunchCheck.mockResolvedValueOnce({
            passed: false,
            checks: [check('webhooks', false)],
          }),
      );
      expect(panel(el, 'launch')).not.toBeNull();
      expect(setup.launch).not.toHaveBeenCalled();
      click(el, 'setup-recheck');
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('does not start later automatic steps after leaving setup during an in-flight request', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      let finish!: (state: SetupState) => void;
      const { fixture } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: TRIAL,
        },
        () =>
          setup.setChatVerified.mockReturnValue(
            new Promise<SetupState>((resolve) => (finish = resolve)),
          ),
      );
      fixture.destroy();
      finish({ ...STATE, chatVerifiedAt: '2026-10-10T11:00:00Z' });
      for (let i = 0; i < 12; i++) await Promise.resolve();
      expect(setup.getLaunchCheck).not.toHaveBeenCalled();
      expect(setup.launch).not.toHaveBeenCalled();
    });

    it.each(['setup-enable', 'setup-confirm-seen'])(
      'clears an automatic launch warning after recovery with %s',
      async (recovery) => {
        localStorage.setItem(
          `aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`,
          'accepted',
        );
        const { fixture, el } = await mount(
          {
            connection: { status: 'connected', store: { catalogStatus: true } },
            index: readyIndex(),
            plan: TRIAL,
          },
          () =>
            setup.launch.mockResolvedValueOnce({
              published: true,
              verified: false,
              verification: 'not_found',
              message: 'Clear the page cache and retry.',
              state: { ...STATE, chatVerifiedAt: '2026-10-10T11:00:00Z', visibility: 'everyone' },
            }),
        );
        expect(el.querySelector('[data-testid="setup-retry-automatic"]')).not.toBeNull();
        click(el, recovery);
        await settle(fixture);
        expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="setup-retry-automatic"]')).toBeNull();
        expect(el.querySelector('[data-testid="setup-progress"]')?.textContent).toContain('6 of 6');
      },
    );

    it('shows the data-safety reassurance before a store is connected', async () => {
      const { el } = await mount({
        connection: { status: 'failed' },
        state: { ...STATE, startedAt: null },
      });

      const reassurance = el.querySelector('[data-testid="setup-data-safety"]')!;
      expect(reassurance.textContent).toContain('How your data is used');
      expect(reassurance.textContent).toContain('secure read-only access');
      expect(reassurance.textContent).toContain('OpenAI');
      expect(reassurance.textContent).not.toContain('do not sell or share');
    });

    it('offers Retry connection when a connect was begun but never completed', async () => {
      const { el } = await mount({ connection: { status: 'failed' } });

      expect(el.textContent).toContain("The connection wasn't completed");
      expect(el.querySelector('[data-testid="setup-connect"]')!.textContent).toContain(
        'Retry connection',
      );
    });

    it('shows a way to try again when starting the connection fails', async () => {
      const { fixture, el } = await mount({ connection: { status: 'failed' } });
      woo.connectStore.mockRejectedValue(
        new HttpErrorResponse({
          status: 400,
          error: { detail: 'The store URL could not be verified.' },
        }),
      );

      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(el, 'setup-confirm-connect');
      await settle(fixture);

      expect(el.querySelector('[role="alert"]')!.textContent).toContain(
        'The store URL could not be verified.',
      );
      expect(el.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
        'The store URL could not be verified.',
      );
      expect(
        (el.querySelector('[data-testid="setup-connect"]') as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('locks setup connection options and shows progress inside the popup while connecting', async () => {
      let finish!: (response: object) => void;
      const { fixture, el } = await mount({ connection: { status: 'failed' } }, () =>
        woo.connectStore.mockReturnValue(new Promise((resolve) => (finish = resolve))),
      );
      click(el, 'setup-connect');
      await settle(fixture);
      click(el, 'setup-mode-manual');
      fixture.detectChanges();
      const consent = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(el, 'setup-confirm-connect');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="setup-confirm-connect"]')?.textContent).toContain(
        'Connecting',
      );
      expect(
        el.querySelector<HTMLButtonElement>('[data-testid="setup-mode-automatic"]')!.disabled,
      ).toBe(true);
      expect(
        el.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.disabled,
      ).toBe(true);
      finish({ authorizationUrl: 'https://shop.example.com/wc-auth/v1/authorize' });
      await settle(fixture);
    });

    it('shows that the store is being verified while the backend finishes', async () => {
      const { el } = await mount({ connection: { status: 'pending' } });

      expect(el.querySelector('[data-testid="setup-connect-pending"]')).not.toBeNull();
      expect(el.textContent).toContain('Verifying your store and linking your Miyya account');
    });
  });

  describe('2. catalog', () => {
    it('starts the catalog sync by itself once connected, exactly once', async () => {
      const { fixture, el } = await mount();
      await settle(fixture);

      expect(catalog.start).toHaveBeenCalledTimes(1);
      expect(panel(el, 'catalog')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-syncing"]')!.textContent).toContain(
        'Importing your catalog',
      );
      expect(el.querySelector('[data-testid="setup-syncing"]')!.textContent).toContain('10 of 40');
    });

    it('follows the sync that is already running when the backend answers 409', async () => {
      const { el } = await mount({
        startError: new HttpErrorResponse({
          status: 409,
          error: { detail: 'running', syncRunId: 'run-9' },
        }),
      });

      expect(catalog.getStatus).toHaveBeenCalledWith('run-9');
      expect(el.querySelector('[data-testid="setup-syncing"]')).not.toBeNull();
      expect(el.querySelector('[role="alert"]')).toBeNull();
    });

    it('offers a manual start when the automatic one fails', async () => {
      const { el } = await mount({
        startError: new HttpErrorResponse({
          status: 500,
          error: { detail: 'Catalog import is temporarily unavailable.' },
        }),
      });

      expect(el.querySelector('[role="alert"]')!.textContent).toContain(
        'Catalog import is temporarily unavailable.',
      );
      expect(el.querySelector('[data-testid="setup-start-sync"]')).not.toBeNull();
    });

    it('waits for the AI search index before calling the catalog ready', async () => {
      const { el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex({
          catalogCounts: { productsSynced: 10, productsIndexed: 3 },
          embeddingIndex: {
            ...readyIndex().embeddingIndex!,
            status: 'indexing',
            processedProducts: 3,
            progressPercent: 30,
          },
        }),
      });

      expect(panel(el, 'catalog')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-syncing"]')!.textContent).toContain(
        'Making your catalog searchable',
      );
      expect(catalog.start).not.toHaveBeenCalled();
    });

    it('lists the issues of a partly imported catalog and retries each failed product', async () => {
      const errors = [
        {
          id: 'e1',
          sourceProductId: 7,
          errorMessage: 'bad price',
          createdAt: '2026-10-10T10:05:30Z',
        },
        { id: 'e2', sourceProductId: 9, errorMessage: 'no sku', createdAt: '2026-10-10T10:05:31Z' },
      ];
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex({
          catalogSync: run({ status: 'completed_with_errors', productsFailed: 2, errors }),
          catalogCounts: { productsSynced: 8, productsIndexed: 8 },
        }),
      });

      const partial = el.querySelector('[data-testid="setup-catalog-partial"]')!;
      expect(partial.textContent).toContain('8 products are ready');
      expect(partial.textContent).toContain("2 couldn't be imported");
      expect(partial.textContent).toContain('Product #7');
      expect(partial.textContent).toContain('bad price');

      click(el, 'setup-retry-failed');
      await settle(fixture);

      expect(catalog.retryError).toHaveBeenCalledTimes(2);
      expect(catalog.retryError).toHaveBeenCalledWith('e1');
      expect(catalog.retryError).toHaveBeenCalledWith('e2');
    });

    it('moves on to the free trial when the merchant continues with the usable products', async () => {
      const errors = [
        {
          id: 'e1',
          sourceProductId: 7,
          errorMessage: 'bad price',
          createdAt: '2026-10-10T10:05:30Z',
        },
      ];
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex({
          catalogSync: run({ status: 'completed_with_errors', productsFailed: 1, errors }),
          catalogCounts: { productsSynced: 9, productsIndexed: 9 },
        }),
      });

      expect(panel(el, 'trial')).toBeNull();
      click(el, 'setup-accept-catalog');
      await settle(fixture);

      expect(panel(el, 'trial')).not.toBeNull();
    });

    it('shows a failed import with a retry', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: false } },
        index: readyIndex({
          catalogSync: run({ status: 'failed', currentMessage: 'Store unreachable' }),
        }),
      });

      expect(el.querySelector('[data-testid="setup-catalog-failed"]')!.textContent).toContain(
        'Store unreachable',
      );
      expect(catalog.start).not.toHaveBeenCalled();
      expect(fixture).toBeTruthy();
    });
  });

  describe('3. free trial', () => {
    it('waits for owner approval without sending a trial request, then resumes Automatic after approval', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { fixture, el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
          plan: { ...NO_PLAN, storeLinkStatus: 'pending' } as SubscriptionStatus,
        },
        () =>
          setup.startTrial.mockImplementation(async () => {
            planStatus.set({ ...TRIAL, storeLinkStatus: 'linked' } as SubscriptionStatus);
            return { trialId: 't1', status: 'active' };
          }),
      );
      expect(el.querySelector('[data-testid="setup-owner-approval"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-activate-trial"]')).toBeNull();
      expect(el.querySelector('[data-testid="setup-retry-automatic"]')).toBeNull();
      expect(setup.startTrial).not.toHaveBeenCalled();
      planStatus.set({ ...NO_PLAN, storeLinkStatus: 'linked' } as SubscriptionStatus);
      (fixture.componentInstance as unknown as { onVisibilityChange(): void }).onVisibilityChange();
      await settle(fixture);
      expect(setup.startTrial).toHaveBeenCalledOnce();
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('turns an older backend approval refusal into an actionable waiting card', async () => {
      localStorage.setItem(`aa_automatic_setup:${encodeURIComponent(STORE.storeUrl)}`, 'accepted');
      const { el } = await mount(
        {
          connection: { status: 'connected', store: { catalogStatus: true } },
          index: readyIndex(),
        },
        () =>
          setup.startTrial.mockRejectedValue(
            new HttpErrorResponse({
              status: 422,
              error: {
                detail: {
                  code: 'TRIAL_INELIGIBLE',
                  message: 'Approve this store in the portal.',
                  details: { reason: 'awaiting_owner_approval' },
                },
              },
            }),
          ),
      );
      expect(el.querySelector('[data-testid="setup-owner-approval"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-activate-trial"]')).toBeNull();
      expect(el.querySelector('[data-testid="setup-retry-automatic"]')).toBeNull();
      expect(setup.startTrial).toHaveBeenCalledOnce();
    });

    it('keeps Manual waiting for trial activation after owner approval', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: { ...NO_PLAN, storeLinkStatus: 'pending' } as SubscriptionStatus,
      });
      expect(el.querySelector('[data-testid="setup-owner-approval"]')).not.toBeNull();
      planStatus.set({ ...NO_PLAN, storeLinkStatus: 'linked' } as SubscriptionStatus);
      (fixture.componentInstance as unknown as { onVisibilityChange(): void }).onVisibilityChange();
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-activate-trial"]')).not.toBeNull();
      expect(setup.startTrial).not.toHaveBeenCalled();
    });

    const readyStore = { status: 'connected', store: { catalogStatus: true } };

    it('offers to activate the trial once the catalog is search-ready', async () => {
      const { el } = await mount({ connection: readyStore, index: readyIndex() });

      expect(panel(el, 'trial')).not.toBeNull();
      expect(el.textContent).toContain('Catalog ready');
      expect(el.querySelector('[data-testid="setup-activate-trial"]')).not.toBeNull();
    });

    it('starts the trial through the plugin and re-reads the plan', async () => {
      const { fixture, el } = await mount({ connection: readyStore, index: readyIndex() });
      subscription.refresh.mockImplementation(async () => {
        planStatus.set(TRIAL);
        return TRIAL;
      });

      click(el, 'setup-activate-trial');
      await settle(fixture);

      expect(setup.startTrial).toHaveBeenCalledTimes(1);
      expect(subscription.refresh).toHaveBeenCalled();
      // The trial is active, so setup has moved on to the private chat.
      expect(panel(el, 'preview')).not.toBeNull();
    });

    it("shows the billing service's own reason when the trial is refused", async () => {
      const { fixture, el } = await mount({ connection: readyStore, index: readyIndex() });
      setup.startTrial.mockRejectedValue(
        new HttpErrorResponse({
          status: 409,
          error: {
            detail: {
              code: 'TRIAL_ALREADY_USED',
              message: 'A free trial was already used for this merchant or store.',
            },
          },
        }),
      );

      click(el, 'setup-activate-trial');
      await settle(fixture);

      expect(el.querySelector('[data-testid="setup-trial-error"]')!.textContent).toContain(
        'A free trial was already used',
      );
      expect(panel(el, 'trial')).not.toBeNull();
    });

    it('tells a waitlisted store that its trial starts by itself', async () => {
      const { el } = await mount({
        connection: readyStore,
        index: readyIndex(),
        plan: { ...NO_PLAN, reason: 'trial_waitlisted' },
      });

      expect(el.querySelector('[data-testid="setup-trial-waitlisted"]')!.textContent).toContain(
        'starts',
      );
      expect(el.querySelector('[data-testid="setup-activate-trial"]')).toBeNull();
    });

    it('skips the step when billing is not enabled on this account', async () => {
      const { el } = await mount({
        connection: readyStore,
        index: readyIndex(),
        plan: {
          ...NO_PLAN,
          enforced: false,
          allowed: true,
          state: 'enabled',
          reason: 'billing_disabled',
        },
      });

      expect(panel(el, 'preview')).not.toBeNull();
    });
  });

  describe('4. private chat preview', () => {
    const active = {
      connection: { status: 'connected', store: { catalogStatus: true } },
      index: readyIndex(),
      plan: TRIAL,
    };

    it('opens the chat only the merchant can see and asks whether it works', async () => {
      const { fixture, el } = await mount(active);

      expect(panel(el, 'preview')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-chat-question"]')).toBeNull();

      click(el, 'setup-open-preview');
      await settle(fixture);

      expect(launcher.isOpen()).toBe(true);
      expect(el.querySelector('[data-testid="setup-chat-question"]')).not.toBeNull();
    });

    it('records a yes and moves on to the launch check', async () => {
      const { fixture, el } = await mount(active);
      click(el, 'setup-open-preview');
      await settle(fixture);

      click(el, 'setup-chat-yes');
      await settle(fixture);

      expect(setup.setChatVerified).toHaveBeenCalledWith(true);
      expect(setup.getLaunchCheck).toHaveBeenCalled();
      expect(panel(el, 'launch')).not.toBeNull();
    });

    it('on a no, checks the catalog and lets the merchant retry and test again', async () => {
      const { fixture, el } = await mount(active);
      click(el, 'setup-open-preview');
      await settle(fixture);

      click(el, 'setup-chat-no');
      await settle(fixture);

      expect(setup.setChatVerified).toHaveBeenCalledWith(false);
      const help = el.querySelector('[data-testid="setup-troubleshooting"]')!;
      expect(help.textContent).toContain('10 products are synced and 10 indexed');
      expect(panel(el, 'preview')).not.toBeNull();

      launcher.close();
      click(el, 'setup-test-again');
      await settle(fixture);
      expect(launcher.isOpen()).toBe(true);
    });
  });

  describe('5. launch check', () => {
    const verified: World = {
      connection: { status: 'connected', store: { catalogStatus: true } },
      index: readyIndex(),
      plan: TRIAL,
      state: { ...STATE, chatVerifiedAt: '2026-10-10T11:00:00Z' },
    };

    it('runs the check on arrival and continues once everything passes', async () => {
      const { fixture, el } = await mount(verified);

      expect(setup.getLaunchCheck).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[data-testid="setup-check-connection"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-check-catalog"]')).not.toBeNull();

      click(el, 'setup-continue');
      await settle(fixture);

      expect(panel(el, 'live')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-enable"]')).not.toBeNull();
    });

    it('names what failed, how to fix it, and lets the merchant retry', async () => {
      const { fixture, el } = await mount(verified);
      setup.getLaunchCheck.mockResolvedValue({
        passed: false,
        checks: [check('connection', true), check('catalog', false)],
      });

      click(el, 'setup-recheck');
      await settle(fixture);

      const failing = el.querySelector('[data-testid="setup-check-catalog"]')!;
      expect(failing.textContent).toContain('Fix catalog');
      expect(el.querySelector('[data-testid="setup-continue"]')).toBeNull();
      expect(el.textContent).toContain('1 of 2 checks passed');
      expect(el.querySelector('[data-testid="setup-recheck"]')!.textContent).toContain(
        'Retry launch check',
      );
    });

    it('sends the merchant to the step that fixes a failing check', async () => {
      const { fixture, el } = await mount(verified);
      setup.getLaunchCheck.mockResolvedValue({ passed: false, checks: [check('catalog', false)] });
      click(el, 'setup-recheck');
      await settle(fixture);

      el.querySelector<HTMLButtonElement>('[data-testid="setup-check-catalog"] button')!.click();
      await settle(fixture);

      expect(panel(el, 'catalog')).not.toBeNull();
    });
  });

  describe('6. go live', () => {
    const checked: World = {
      connection: { status: 'connected', store: { catalogStatus: true } },
      index: readyIndex(),
      plan: TRIAL,
      state: { ...STATE, chatVerifiedAt: '2026-10-10T11:00:00Z' },
    };

    /** What the plugin reports mid-launch: the chat confirmation survives, only visibility moves. */
    const published = { ...checked.state!, visibility: 'everyone' as const };

    async function atEnable() {
      const mounted = await mount(checked);
      click(mounted.el, 'setup-continue');
      await settle(mounted.fixture);
      return mounted;
    }

    it('publishes, verifies, and then shows the public-chat and usage guidance', async () => {
      const { fixture, el } = await atEnable();

      click(el, 'setup-enable');
      await settle(fixture);

      expect(setup.launch).toHaveBeenCalledTimes(1);
      const live = el.querySelector('[data-testid="setup-live"]')!;
      expect(live.textContent).toContain('Miyya is live on your storefront');
      expect(el.textContent).toContain('Verify the public chat');
      expect(el.textContent).toContain('Monitor usage');
      expect(el.textContent).toContain('14 days left');
      expect(el.textContent).toContain('2000 credits remaining');
      expect(
        el.querySelector<HTMLAnchorElement>('[data-testid="setup-open-storefront"]')!.href,
      ).toBe('https://shop.example.com/');
    });

    it('says published-but-not-seen plainly and offers a retry instead of claiming success', async () => {
      const { fixture, el } = await atEnable();
      setup.launch.mockResolvedValue({
        published: true,
        verified: false,
        verification: 'not_found',
        message:
          'Miyya is published, but it did not appear on the storefront yet. A page cache may still be serving the old page: purge it and try again.',
        storefrontUrl: 'https://shop.example.com/',
        state: published,
      });

      click(el, 'setup-enable');
      await settle(fixture);

      expect(el.querySelector('[data-testid="setup-live"]')).toBeNull();
      expect(el.querySelector('[data-testid="setup-launch-unverified"]')!.textContent).toContain(
        'purge it',
      );
      expect(el.querySelector('[data-testid="setup-enable"]')!.textContent).toContain('Retry');

      // And the retry works.
      setup.launch.mockResolvedValue({
        published: true,
        verified: true,
        verification: 'verified',
        message: 'ok',
        state: { ...published, launchedAt: '2026-10-10T12:00:00Z' },
      });
      click(el, 'setup-enable');
      await settle(fixture);
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('lets the merchant confirm by eye when the server cannot load its own storefront', async () => {
      const { fixture, el } = await atEnable();
      setup.launch.mockResolvedValue({
        published: true,
        verified: false,
        verification: 'unreachable',
        message: 'could not load',
        storefrontUrl: 'https://shop.example.com/',
        state: published,
      });
      click(el, 'setup-enable');
      await settle(fixture);

      click(el, 'setup-confirm-seen');
      await settle(fixture);

      expect(setup.confirmLaunch).toHaveBeenCalled();
      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
    });

    it('shows an error with a retry when publishing fails outright', async () => {
      const { fixture, el } = await atEnable();
      setup.launch.mockRejectedValue(
        new HttpErrorResponse({
          status: 500,
          error: { detail: { message: 'The store could not be published. Try again shortly.' } },
        }),
      );

      click(el, 'setup-enable');
      await settle(fixture);

      expect(el.querySelector('[data-testid="setup-launch-error"]')!.textContent).toContain(
        'The store could not be published. Try again shortly.',
      );
      expect((el.querySelector('[data-testid="setup-enable"]') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it('returns to the launch check when the checks stopped passing before publishing', async () => {
      const { fixture, el } = await atEnable();
      setup.launch.mockRejectedValue(
        new HttpErrorResponse({
          status: 409,
          error: {
            published: false,
            verified: false,
            verification: 'checks_failed',
            message: 'x',
            checks: [check('plan', false)],
          },
        }),
      );

      click(el, 'setup-enable');
      await settle(fixture);

      expect(panel(el, 'launch')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-check-plan"]')!.textContent).toContain(
        'Fix plan',
      );
    });
  });

  describe('a store that is already live', () => {
    it('is shown as finished, with no catalog sync started and no steps asked again', async () => {
      const { el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: TRIAL,
        state: { ...STATE, startedAt: null, legacy: true, visibility: 'everyone' },
      });

      expect(el.querySelector('[data-testid="setup-live"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="setup-progress"]')!.textContent).toContain(
        '6 of 6 complete',
      );
      expect(catalog.start).not.toHaveBeenCalled();
      expect(setup.getLaunchCheck).not.toHaveBeenCalled();
    });

    it('asks to enable Miyya again when the merchant later hid the widget', async () => {
      const { el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
        plan: TRIAL,
        state: {
          ...STATE,
          chatVerifiedAt: 'x',
          launchedAt: '2026-10-10T12:00:00Z',
          visibility: 'hidden',
        },
      });

      // Launched once, but hidden since: the last step is open again.
      expect(el.querySelector('[data-testid="setup-live"]')).toBeNull();
    });
  });

  describe('stepper', () => {
    it('lets the merchant reopen a finished step and return to the current one', async () => {
      const { fixture, el } = await mount({
        connection: { status: 'connected', store: { catalogStatus: true } },
        index: readyIndex(),
      });
      expect(panel(el, 'trial')).not.toBeNull();

      click(el, 'setup-step-connect');
      await settle(fixture);
      expect(panel(el, 'connect')).not.toBeNull();
      expect(el.textContent).toContain('Store connected');

      click(el, 'setup-continue');
      await settle(fixture);
      expect(panel(el, 'trial')).not.toBeNull();
    });

    it('does not open a step that is not reachable yet', async () => {
      const { fixture, el } = await mount({ connection: { status: 'failed' } });

      click(el, 'setup-step-live');
      await settle(fixture);

      expect(panel(el, 'connect')).not.toBeNull();
      expect(
        (el.querySelector('[data-testid="setup-step-live"]') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('falls back to the Connect step when the connection cannot be read at all', async () => {
      const { el } = await mount({ connection: 'unreachable' });

      expect(panel(el, 'connect')).not.toBeNull();
    });
  });
});
