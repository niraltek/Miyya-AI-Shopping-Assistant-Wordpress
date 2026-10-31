import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ChatMessage } from '../../models/chat';
import { ComparisonTable, Product } from '../../models/product';
import { CopilotService } from '../../services/copilot-service/copilot-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import { SubscriptionService } from '../../../billing/services/subscription-service/subscription-service';
import { MerchantStoreConnection } from '../../../store/models/woocommerce';
import { SubscriptionStatus } from '../../../billing/models/subscription';
import { DUMMY_PRODUCTS } from '../../utils/dummy-products';
import { ChatComponent } from './chat-component';

/**
 * WordPress paints #wpadminbar at z-index 99999 and the admin menu at 100000
 * (wp-includes/css/admin-bar.css, wp-admin/css/common.css). Anything that covers
 * wp-admin chrome has to outrank both.
 */
const WP_MAX_CHROME_Z_INDEX = 100000;

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let compiled: HTMLElement;
  let copilot: ReturnType<typeof fakeCopilot>;

  /**
   * Stands in for the real client so a turn can be left in flight and resolved on cue.
   * `isConfigured` is true; when it is false the component has no way to answer at all,
   * since the copilot is the only source of answers.
   */
  function fakeCopilot() {
    return {
      isConfigured: true,
      getReadiness: vi.fn().mockResolvedValue({
        ready: true,
        status: 'ready',
        message: 'The store assistant is ready.',
      }),
      streamMessage: vi.fn().mockReturnValue(new Promise(() => {})),
      endConversation: vi.fn().mockResolvedValue(undefined),
      resumeStoredSession: vi.fn().mockReturnValue(false),
      forgetStoredSession: vi.fn(),
      getConversation: vi.fn().mockRejectedValue(new Error('no stored conversation')),
      // Resolves to null: these specs render the widget off a product page, which is the
      // case the header's "Online" branch covers.
      getPageProduct: vi.fn().mockResolvedValue(null),
      productsFromBlocks: vi.fn().mockReturnValue([]),
      comparisonFromBlocks: vi.fn().mockReturnValue(null),
      suggestionsFromBlocks: vi.fn().mockReturnValue([]),
      categoriesFromBlocks: vi.fn().mockReturnValue([]),
      textFromBlocks: vi.fn().mockReturnValue('Here are some shoes.'),
      getCatalogCapabilities: vi.fn().mockRejectedValue(new Error('no catalog in specs')),
    };
  }

  /** Opens the panel through the launcher bubble, the way a merchant would. */
  async function openPanel(): Promise<void> {
    compiled.querySelector<HTMLButtonElement>('[aria-label="Open Miyya chat"]')!.click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    copilot = fakeCopilot();

    // The component reads/writes its own open-state key directly on the real
    // sessionStorage (see OPEN_STATE_KEY) rather than through a mockable service, so a
    // panel left open by one test would otherwise auto-reopen the very next component
    // this file constructs.
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [provideHttpClient(), { provide: CopilotService, useValue: copilot }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    compiled = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not request billing or cross-origin readiness or poll for a disconnected store', async () => {
    TestBed.resetTestingModule();
    copilot = fakeCopilot();
    const refresh = vi.fn().mockResolvedValue(null);
    const polling = vi.spyOn(globalThis, 'setInterval');
    try {
      await TestBed.configureTestingModule({
        imports: [ChatComponent],
        providers: [
          { provide: CopilotService, useValue: copilot },
          {
            provide: WooCommerceService,
            useValue: {
              getConnectionStatus: vi.fn().mockResolvedValue({ status: 'failed' }),
            },
          },
          {
            provide: SubscriptionService,
            useValue: {
              refresh,
              status: vi.fn().mockReturnValue(null),
            },
          },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ChatComponent);
      component = fixture.componentInstance;
      compiled = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
      expect(refresh).not.toHaveBeenCalled();
      expect(copilot.getReadiness).not.toHaveBeenCalled();
      expect(polling.mock.calls.some((call) => call[1] === 3000)).toBe(false);
      expect((component as unknown as { readiness(): { status: string } }).readiness().status).toBe(
        'store_not_connected',
      );
    } finally {
      polling.mockRestore();
    }
  });

  it('starts as a launcher bubble with the panel closed', () => {
    expect(compiled.querySelector('[aria-label="Open Miyya chat"]')).not.toBeNull();
    expect(compiled.querySelector('textarea')).toBeNull();
  });

  it('shows the backend refusal message when a chat request fails', async () => {
    copilot.streamMessage.mockRejectedValue(
      new HttpErrorResponse({
        status: 403,
        error: { detail: { message: 'This store is paused for maintenance.' } },
      }),
    );
    await openPanel();
    (component as unknown as { sendMessage(text: string): void }).sendMessage('Show me shoes');
    await fixture.whenStable();
    expect(compiled.textContent).toContain('This store is paused for maintenance.');
  });

  it('resumes polling after a billing refusal and preserves the conversation on recovery', async () => {
    await openPanel();
    const polling = vi.spyOn(globalThis, 'setInterval');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      copilot.getReadiness.mockResolvedValue({
        ready: false,
        status: 'credits_exhausted',
        message: 'Add credits to continue.',
      });
      copilot.streamMessage.mockRejectedValue(
        new HttpErrorResponse({
          status: 402,
          error: { detail: { message: 'Add credits to continue.' } },
        }),
      );
      (component as unknown as { sendMessage(text: string): void }).sendMessage('Find shoes');
      await fixture.whenStable();
      expect(compiled.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
      const timer = polling.mock.calls.find((call) => call[1] === 3000);
      expect(timer).toBeDefined();
      copilot.getReadiness.mockResolvedValue({
        ready: true,
        status: 'ready',
        message: 'Welcome back.',
      });
      (timer![0] as () => void)();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(compiled.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
      });
      expect(compiled.textContent).toContain('Find shoes');
      expect(copilot.resumeStoredSession).toHaveBeenCalledTimes(1);
      expect(copilot.getPageProduct).toHaveBeenCalledTimes(1);
    } finally {
      polling.mockRestore();
      visibility.mockRestore();
    }
  });

  it('opens the panel when the bubble is clicked', async () => {
    await openPanel();

    expect(compiled.querySelector('[aria-label="Open Miyya chat"]')).toBeNull();
    expect(compiled.querySelector('textarea')).not.toBeNull();
    expect(compiled.querySelector('[title="Close"]')).not.toBeNull();
  });

  it('keeps chat disabled and explains the unfinished setup stage', async () => {
    fixture.destroy();
    copilot.getReadiness.mockResolvedValue({
      ready: false,
      status: 'catalog_sync_required',
      message: "This store's product catalog is still being prepared.",
    });
    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    compiled = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    await openPanel();

    const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(compiled.textContent).toContain("This store's product catalog is still being prepared.");
    expect(compiled.textContent).toContain('Unavailable');
    expect(textarea.disabled).toBe(true);
    expect(compiled.querySelector<HTMLButtonElement>('[title="Send"]')!.disabled).toBe(true);
    expect(copilot.streamMessage).not.toHaveBeenCalled();
  });

  describe('the wp-admin first-run checklist', () => {
    const ACTIVE_PLAN: SubscriptionStatus = {
      enforced: true,
      allowed: true,
      state: 'enabled',
      reason: 'trial_active',
      subscriptionStatus: null,
      trialEndsAt: null,
      remainingTrialDays: 10,
      currentPeriodEnd: null,
      accessUntil: null,
      cancelAtPeriodEnd: false,
      manageUrl: 'https://portal.example/layout/billing',
      creditsRemaining: 1000,
      catalogReady: true,
      assistantReady: true,
    };

    async function createWith(
      store: Partial<MerchantStoreConnection> | null,
      status: SubscriptionStatus | null,
    ): Promise<void> {
      const remaining =
        Number(!status || !['enabled', 'grace'].includes(status.state)) +
        Number(!store?.catalogStatus);
      const backendStatus = {
        ...(status ?? ACTIVE_PLAN),
        setupMessage:
          remaining === 0
            ? null
            : remaining === 1
              ? "You're one step away from using Miyya. Finish setup in Miyya Setup."
              : 'Finish the last 2 setup steps in Miyya Setup to start using Miyya.',
      };
      TestBed.resetTestingModule();
      copilot = fakeCopilot();
      sessionStorage.clear();

      await TestBed.configureTestingModule({
        imports: [ChatComponent],
        providers: [
          { provide: CopilotService, useValue: copilot },
          {
            provide: WooCommerceService,
            useValue: {
              getConnectionStatus: vi
                .fn()
                .mockResolvedValue(
                  store ? { status: 'connected', store } : { status: 'connected' },
                ),
            },
          },
          {
            provide: SubscriptionService,
            useValue: {
              load: vi.fn().mockResolvedValue(backendStatus),
              refresh: vi.fn().mockResolvedValue(backendStatus),
              status: vi.fn().mockReturnValue(backendStatus),
            },
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ChatComponent);
      component = fixture.componentInstance;
      compiled = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    }

    // Backend readiness (mocked `ready: true` via fakeCopilot) says nothing about this —
    // it's a wp-admin-only check layered on top, the same two conditions Miyya Setup
    // derives its position from.
    it('blocks the composer and names how many steps are left', async () => {
      await createWith({ catalogStatus: false }, null);
      await openPanel();

      const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(textarea.disabled).toBe(true);
      expect(compiled.querySelector<HTMLButtonElement>('[title="Send"]')!.disabled).toBe(true);
      expect(compiled.textContent).toContain('Setup needed');
      expect(compiled.textContent).toContain('Finish the last 2 setup steps');
    });

    // Regression: the setup check used to be consulted only AFTER the backend's own
    // readiness came back `ready: true`. Right after connecting, that backend readiness
    // legitimately reads not-ready for a while — verification runs in a background
    // worker — which meant the chat showed a flat "not connected yet" instead of the
    // Miyya Setup's own, more specific progress while the merchant was mid-setup.
    it('leads with the setup check, without waiting on the backend to agree first', async () => {
      await createWith({ catalogStatus: false }, null);
      await openPanel();

      expect(copilot.getReadiness).not.toHaveBeenCalled();
      expect(compiled.textContent).toContain('Finish the last 2 setup steps');
      expect(compiled.textContent).not.toContain('not connected yet');
    });

    it('says "one step away" when only the last step remains', async () => {
      await createWith({ catalogStatus: false }, ACTIVE_PLAN);
      await openPanel();

      expect(compiled.textContent).toContain("You're one step away from using Miyya");
    });

    it('lets the merchant chat once every step is done', async () => {
      await createWith({ catalogStatus: true }, ACTIVE_PLAN);
      await openPanel();

      const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(textarea.disabled).toBe(false);
      expect(compiled.textContent).toContain('Online');
      expect(compiled.textContent).not.toContain('Setup needed');
    });

    // Regression: this component is mounted once by the layout and stays alive for the
    // whole wp-admin session — connecting the store, activating a plan and syncing the
    // catalog all happen without ever reloading it. It used to only check once, at
    // startup, so finishing the setup while the chat was already open left it stuck
    // showing "Unavailable" until the merchant manually refreshed the page.
    it('recovers on its own once the last setup step finishes, without a reload', async () => {
      let catalogDone = false;

      TestBed.resetTestingModule();
      copilot = fakeCopilot();
      sessionStorage.clear();

      await TestBed.configureTestingModule({
        imports: [ChatComponent],
        providers: [
          { provide: CopilotService, useValue: copilot },
          {
            provide: WooCommerceService,
            useValue: {
              getConnectionStatus: vi.fn().mockImplementation(() =>
                Promise.resolve({
                  status: 'connected',
                  store: { catalogStatus: catalogDone },
                }),
              ),
            },
          },
          {
            provide: SubscriptionService,
            useValue: {
              load: vi.fn().mockResolvedValue(ACTIVE_PLAN),
              refresh: vi.fn().mockResolvedValue(ACTIVE_PLAN),
              status: vi.fn().mockImplementation(() => ({
                ...ACTIVE_PLAN,
                setupMessage: catalogDone
                  ? null
                  : "You're one step away from using Miyya. Finish setup in Miyya Setup.",
              })),
            },
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ChatComponent);
      component = fixture.componentInstance;
      compiled = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
      await openPanel();

      expect(compiled.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
      expect(compiled.textContent).toContain("You're one step away");

      // The merchant finishes the catalog sync — this exercises the same recheck the
      // poll timer runs on its own interval, without waiting on that timer here.
      catalogDone = true;
      await (component as unknown as { recheckReadiness(): Promise<void> }).recheckReadiness();
      fixture.detectChanges();
      await fixture.whenStable();

      const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(textarea.disabled).toBe(false);
      expect(compiled.textContent).toContain('Online');
    });
  });

  it('sizes the floating panel as a bottom sheet on phones', async () => {
    // Regression: the panel was a fixed 28.75rem wide, which on a narrow phone
    // overflowed the viewport and pushed the close button off-screen.
    await openPanel();

    const panel = compiled.querySelector<HTMLElement>('textarea')!.closest('.fixed')!;
    const classes = [...panel.classList];

    expect(classes).toContain('inset-x-3');
    expect(classes.some((c) => c.startsWith('sm:'))).toBe(true);
  });

  it('keeps the chat layout unchanged when a comparison is available', () => {
    const layout = component as unknown as {
      activeComparison: { set(value: unknown): void };
      sidePanelRequested: { set(value: boolean): void };
      chatColumnClasses(): string;
      sidePanelWrapperClasses(): string;
    };

    const chatClasses = layout.chatColumnClasses();
    layout.activeComparison.set({
      products: [{ productId: 'a' }, { productId: 'b' }],
      rows: [{ field: 'price', label: 'Price', values: ['1', '2'], isLive: true }],
    });
    // The comparison renders inline; the drawer is opened by "Full table".
    expect(layout.sidePanelWrapperClasses()).not.toContain('aa-side-panel--visible');
    layout.sidePanelRequested.set(true);

    expect(layout.sidePanelWrapperClasses()).toContain('aa-side-panel--visible');
    expect(layout.chatColumnClasses()).toBe(chatClasses);
  });

  it('shows the general search cards alongside a comparison of only part of the results', async () => {
    await openPanel();
    const products = DUMMY_PRODUCTS.slice(0, 3);
    const state = component as unknown as { messages: { set(value: ChatMessage[]): void } };
    state.messages.set([
      { id: 'compound-question', role: 'user', text: 'Find and compare', time: '' },
      {
        id: 'compound-answer',
        role: 'assistant',
        text: 'Laptops and comparison',
        time: '',
        products,
        comparison: { products: products.slice(0, 2), rows: [] },
      },
    ]);
    await fixture.whenStable();
    expect(compiled.querySelector('app-inline-product-list-component')).not.toBeNull();
    expect(compiled.querySelector('app-inline-comparison-component')).not.toBeNull();
  });

  describe('the compare suggestion in the composer', () => {
    function internals() {
      return component as unknown as {
        selectedProducts: { set(value: unknown[]): void };
        draft: { set(value: string): void; (): string };
      };
    }

    it('offers the sentence once two products are ticked', async () => {
      const it_ = internals();

      it_.selectedProducts.set([{ productId: 'a' }, { productId: 'b' }]);
      await fixture.whenStable();

      expect(it_.draft()).toBe('compare these products?');
    });

    it('offers nothing for a single product, which is not a comparison', async () => {
      const it_ = internals();

      it_.selectedProducts.set([{ productId: 'a' }]);
      await fixture.whenStable();

      expect(it_.draft()).toBe('');
    });

    it('never overwrites what the shopper has already typed', async () => {
      // The whole risk of prefilling a text box. Losing a half-written message to be
      // helpful is far worse than not helping.
      const it_ = internals();
      it_.draft.set('do you have this in black');

      it_.selectedProducts.set([{ productId: 'a' }, { productId: 'b' }]);
      await fixture.whenStable();

      expect(it_.draft()).toBe('do you have this in black');
    });

    it('withdraws its own suggestion when the selection drops below two', async () => {
      const it_ = internals();
      it_.selectedProducts.set([{ productId: 'a' }, { productId: 'b' }]);
      await fixture.whenStable();

      it_.selectedProducts.set([{ productId: 'a' }]);
      await fixture.whenStable();

      expect(it_.draft()).toBe('');
    });

    it('leaves an edited suggestion alone when the selection drops', async () => {
      // Once they have changed it, it is their sentence and not ours to withdraw.
      const it_ = internals();
      it_.selectedProducts.set([{ productId: 'a' }, { productId: 'b' }]);
      await fixture.whenStable();
      it_.draft.set('compare these products on battery life');

      it_.selectedProducts.set([]);
      await fixture.whenStable();

      expect(it_.draft()).toBe('compare these products on battery life');
    });
  });

  it('clears the selection once a comparison has been answered', async () => {
    // The tick-boxes ride along as pageContext on every later message and the backend
    // reads them as the products a comparison is about, so a selection left ticked makes
    // the NEXT "compare" answer about the previous pair with nothing on screen to explain
    // why. The table stays; only the pending selection is spent.
    const table = {
      products: [
        { ...DUMMY_PRODUCTS[0], productId: 'a' },
        { ...DUMMY_PRODUCTS[1], productId: 'b' },
      ],
      rows: [{ field: 'price', label: 'Price', values: ['1', '2'], isLive: true }],
    };
    copilot.comparisonFromBlocks.mockReturnValue(table);
    copilot.streamMessage.mockResolvedValue({ blocks: [], messageId: 'm1' });

    const internals = component as unknown as {
      selectedProducts: { set(value: unknown[]): void; (): unknown[] };
      activeComparison(): unknown;
      runCopilotTurn(query: string): void;
    };
    internals.selectedProducts.set([{ productId: 'a' }, { productId: 'b' }]);

    internals.runCopilotTurn('compare');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(internals.selectedProducts()).toEqual([]);
    expect(internals.activeComparison()).toEqual(table);
  });

  it('collapses the comparison drawer when the answer carried columns but no rows', () => {
    // Products with nothing listed to compare them on is a real answer, and the panel
    // says so rather than rendering an empty grid — but it is still a comparison, so the
    // drawer stays open to show it.
    const layout = component as unknown as {
      activeComparison: { set(value: unknown): void };
      showComparisonPanel(): boolean;
    };

    layout.activeComparison.set({ products: [{ productId: 'a' }], rows: [] });
    expect(layout.showComparisonPanel()).toBe(true);

    layout.activeComparison.set({ products: [], rows: [] });
    expect(layout.showComparisonPanel()).toBe(false);
  });

  it('maximises above the WordPress admin bar and menu', async () => {
    // Regression: the panel maximised at z-50, i.e. underneath wp-admin chrome, so
    // its own header — and therefore this very Minimize button — ended up behind the
    // admin bar and could not be clicked.
    await openPanel();

    compiled.querySelector<HTMLButtonElement>('[title="Maximize"]')!.click();
    await fixture.whenStable();

    const panel = compiled.querySelector<HTMLElement>('[title="Minimize"]')!.closest('.fixed')!;
    const zClass = [...panel.classList].find((c) => c.startsWith('z-['));
    expect(zClass).toBeDefined();

    expect(Number(zClass!.replace(/\D/g, ''))).toBeGreaterThan(WP_MAX_CHROME_Z_INDEX);
  });

  it('stacks the clear-conversation dialog above the panel', async () => {
    // Regression: the dialog was z-60 while the panel is z-100001, so it rendered
    // UNDERNEATH the chat — clicking the bin looked like it did nothing.
    await openPanel();

    // Matches both Tailwind spellings — `z-[100002]` and the bare `z-100002` — so a class
    // rewritten from one to the other cannot silently turn this assertion into 0 > 0.
    const zOf = (el: Element) => {
      const c = [...el.classList].find((n) => /^z-\[?\d+\]?$/.test(n));
      return c ? Number(c.replace(/\D/g, '')) : 0;
    };

    const panelZ = zOf(compiled.querySelector<HTMLElement>('textarea')!.closest('.fixed')!);

    compiled.querySelector<HTMLButtonElement>('[title="Clear conversation"]')!.click();
    await fixture.whenStable();

    const dialog = compiled.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(zOf(dialog!)).toBeGreaterThan(panelZ);
  });

  /** Resolves the in-flight turn on demand, so a clear can be timed against it. */
  function pendingTurn() {
    let settle: (response: unknown) => void = () => {};
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    return { promise, settle: (response: unknown) => settle(response) };
  }

  /** Reaches past `protected` — this spec drives the component the way its template does. */
  function api() {
    return component as unknown as {
      sendMessage(text?: string): void;
      confirmClear(): void;
      toggleProductSelection(product: Product): void;
      messages(): { role: string; text: string; html?: string }[];
      selectedProducts(): Product[];
      isTyping(): boolean;
      loadingSteps(): { label: string; done: boolean; active: boolean }[] | null;
    };
  }

  /** Runs a turn, handing back the emitter so the spec can drive its SSE events. */
  async function startTurn(message = 'show me running shoes') {
    const turn = pendingTurn();
    let emit: (event: unknown) => void = () => {};
    copilot.streamMessage.mockImplementation(
      (_m: string, _c: unknown, onEvent: (e: unknown) => void) => {
        emit = onEvent;
        return turn.promise;
      },
    );

    await openPanel();
    api().sendMessage(message);
    return { emit: (event: unknown) => emit(event), settle: turn.settle };
  }

  describe('product panel scroll stability', () => {
    async function setupHistory() {
      await openPanel();
      const state = component as unknown as {
        messages: { set(value: ChatMessage[]): void };
        activeProducts: { (): Product[] | null; set(value: Product[] | null): void };
        activeComparison: { (): ComparisonTable | null; set(value: ComparisonTable | null): void };
        computeActiveMessageIndex(): number;
        scrollAnchor(): { nativeElement: HTMLElement };
        postToHost(message: Record<string, unknown>): void;
      };
      // jsdom has no scrolling implementation; the tests dispatch its resulting events.
      state.scrollAnchor().nativeElement.scrollIntoView = vi.fn();
      const products = [{ ...DUMMY_PRODUCTS[1], productId: 'shoe', name: 'Running shoe' }];
      state.messages.set([
        { id: 'q1', role: 'user', text: 'Hello', time: '' },
        { id: 'a1', role: 'assistant', text: 'How can I help?', time: '' },
        { id: 'q2', role: 'user', text: 'Show me shoes', time: '' },
        { id: 'a2', role: 'assistant', text: 'Here are shoes', time: '', products },
      ]);
      state.activeProducts.set(products);
      await fixture.whenStable();
      const scroll = compiled.querySelector<HTMLElement>('[aria-label="Conversation"]')!;
      const focus = vi.spyOn(state, 'computeActiveMessageIndex').mockReturnValue(1);
      return { state, products, scroll, focus };
    }

    for (const kind of ['products', 'comparison'] as const) {
      it(`hides and reopens ${kind} without replacing the chat or losing selections`, async () => {
        const { state, products, scroll } = await setupHistory();
        if (kind === 'comparison') {
          state.activeComparison.set({ products, rows: [] });
        }
        api().toggleProductSelection(products[0]);
        await fixture.whenStable();
        const textarea = compiled.querySelector<HTMLTextAreaElement>('textarea')!;
        textarea.value = 'Keep my draft';
        textarea.dispatchEvent(new Event('input'));
        const drawer = compiled.querySelector<HTMLElement>('#chat-side-panel')!;
        const contents = drawer.querySelector(
          `app-${kind === 'products' ? 'product-results' : 'comparison'}-panel-component`,
        );
        const toggle = compiled.querySelector<HTMLButtonElement>(
          '[aria-controls="chat-side-panel"]',
        )!;
        scroll.scrollTop = 42;

        compiled.querySelector<HTMLButtonElement>('[title="Close side panel"]')!.click();
        await fixture.whenStable();
        expect(drawer.getAttribute('aria-hidden')).toBe('true');
        expect(drawer.hasAttribute('inert')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain(`Show ${kind}`);
        expect(compiled.querySelector('textarea')).toBe(textarea);
        expect(textarea.value).toBe('Keep my draft');
        expect(scroll.scrollTop).toBe(42);
        expect(api().selectedProducts()).toEqual(products);
        expect(compiled.querySelector('[aria-label="Open Miyya chat"]')).toBeNull();

        toggle.click();
        await fixture.whenStable();
        expect(drawer.getAttribute('aria-hidden')).toBe('false');
        expect(drawer.hasAttribute('inert')).toBe(false);
        expect(drawer.contains(contents)).toBe(true);
        expect(compiled.querySelector('textarea')).toBe(textarea);
      });
    }

    it("renders an answer's products inline and keeps the product drawer closed until asked", async () => {
      const { products } = await setupHistory();

      const inline = compiled.querySelectorAll('app-inline-product-list-component');
      expect(inline.length).toBeGreaterThan(0);
      expect(inline[inline.length - 1].textContent).toContain(products[0].name);
      expect(compiled.textContent).not.toContain('in the panel');

      const drawer = compiled.querySelector<HTMLElement>('#chat-side-panel')!;
      expect(drawer.getAttribute('aria-hidden')).toBe('true');

      compiled.querySelector<HTMLButtonElement>('[aria-controls="chat-side-panel"]')!.click();
      await fixture.whenStable();
      expect(drawer.getAttribute('aria-hidden')).toBe('false');
    });

    it("offers the newest answer's follow-ups and sends the chip's sentence", async () => {
      await setupHistory();
      const turn = pendingTurn();
      copilot.streamMessage.mockReturnValue(turn.promise);
      copilot.suggestionsFromBlocks.mockReturnValue([
        { label: 'Running shoes under 3,000', message: 'running shoes under 3000' },
      ]);
      api().sendMessage('show me running shoes');
      turn.settle({ blocks: [], messageId: 'with-chips' });
      await fixture.whenStable();

      const chip = Array.from(
        compiled.querySelectorAll<HTMLButtonElement>('.aa-followup-chip'),
      ).find((button) => button.textContent?.includes('Running shoes under 3,000'))!;
      expect(chip).toBeTruthy();

      copilot.streamMessage.mockReturnValue(new Promise(() => {}));
      chip.click();
      await fixture.whenStable();
      expect(copilot.streamMessage.mock.calls.at(-1)![0]).toBe('running shoes under 3000');
      // A turn is in flight: chips from the previous answer are withdrawn.
      expect(compiled.querySelector('.aa-followup-chip')).toBeNull();
    });

    it('keeps a dismissed drawer hidden when a new answer arrives', async () => {
      const { state } = await setupHistory();
      compiled.querySelector<HTMLButtonElement>('[title="Close side panel"]')!.click();
      await fixture.whenStable();
      const turn = pendingTurn();
      copilot.streamMessage.mockReturnValue(turn.promise);
      api().sendMessage('Compare these');
      copilot.comparisonFromBlocks.mockReturnValue({
        products: [...DUMMY_PRODUCTS.slice(0, 2)],
        rows: [],
      });
      turn.settle({ blocks: [], messageId: 'new-comparison' });
      await fixture.whenStable();
      expect(state.activeComparison()).not.toBeNull();
      expect(compiled.querySelector('#chat-side-panel')!.getAttribute('aria-hidden')).toBe('true');
      expect(compiled.querySelector('[aria-controls="chat-side-panel"]')!.textContent).toContain(
        'Show comparison',
      );
    });

    it('ignores automatic scrolling after two questions', async () => {
      const { state, products, scroll, focus } = await setupHistory();
      vi.useFakeTimers();
      try {
        scroll.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(500);
        expect(state.activeProducts()).toBe(products);
        expect(focus).not.toHaveBeenCalled();
        expect(compiled.querySelector('[title="Close"]')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('follows a user scroll once without responding to the resulting layout scroll', async () => {
      const { state, products, scroll, focus } = await setupHistory();
      vi.useFakeTimers();
      try {
        scroll.dispatchEvent(new WheelEvent('wheel'));
        scroll.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(150);
        expect(state.activeProducts()).toBeNull();

        // Closing the drawer moves the messages: a second scroll must not reopen it.
        focus.mockReturnValue(3);
        scroll.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(500);
        expect(state.activeProducts()).toBeNull();
        expect(focus).toHaveBeenCalledTimes(1);

        // A fresh keyboard gesture can still select the latest products.
        scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
        scroll.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(150);
        expect(state.activeProducts()).toBe(products);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps existing products while a follow-up answer is streaming', async () => {
      const { state, products, scroll, focus } = await setupHistory();
      let emit: (event: unknown) => void = () => {};
      copilot.streamMessage.mockImplementation((_m, _c, onEvent) => {
        emit = onEvent;
        return new Promise(() => {});
      });
      api().sendMessage('Tell me more about these shoes');
      emit({ type: 'assistant.delta', data: { delta: 'These shoes are' } });
      await fixture.whenStable();
      focus.mockReturnValue(5);
      vi.useFakeTimers();
      try {
        scroll.dispatchEvent(new Event('touchmove'));
        scroll.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(150);
        expect(state.activeProducts()).toBe(products);
      } finally {
        vi.useRealTimers();
      }
    });

    for (const panel of ['products', 'comparison'] as const) {
      for (const phase of ['waiting', 'streaming'] as const) {
        it(`keeps the ${panel} panel mounted when older messages scroll into view while ${phase}`, async () => {
          const { state, products, scroll, focus } = await setupHistory();
          const comparison = { products: [...DUMMY_PRODUCTS.slice(0, 2)], rows: [] };
          if (panel === 'comparison') {
            state.activeComparison.set(comparison);
          }
          await fixture.whenStable();
          const selector =
            panel === 'products'
              ? 'app-product-results-panel-component'
              : 'app-comparison-panel-component';
          const originalPanel = compiled.querySelector(selector);
          expect(originalPanel).not.toBeNull();
          const hostUpdates = vi.spyOn(state, 'postToHost');

          const turn = pendingTurn();
          let emit: (event: unknown) => void = () => {};
          copilot.streamMessage.mockImplementation((_m, _c, onEvent) => {
            emit = onEvent;
            return turn.promise;
          });
          api().sendMessage('Compare these products again');
          if (phase === 'streaming') {
            emit({ type: 'assistant.delta', data: { delta: 'Here is the comparison' } });
          }
          await fixture.whenStable();

          // Repeated gestures can cross older text-only and product answers while
          // the request is pending. Neither may replace or collapse the current panel.
          vi.useFakeTimers();
          try {
            for (const index of [1, 3, 0, 3]) {
              focus.mockReturnValue(index);
              scroll.dispatchEvent(new WheelEvent('wheel'));
              scroll.dispatchEvent(new Event('scroll'));
              vi.advanceTimersByTime(150);
              fixture.detectChanges();
              expect(state.activeProducts()).toBe(products);
              expect(state.activeComparison()).toBe(panel === 'comparison' ? comparison : null);
              expect(compiled.querySelector(selector)).toBe(originalPanel);
              expect(hostUpdates).not.toHaveBeenCalled();
            }
          } finally {
            vi.useRealTimers();
          }

          // The completed answer may now replace the panel normally.
          copilot.productsFromBlocks.mockReturnValue(comparison.products);
          copilot.comparisonFromBlocks.mockReturnValue(comparison);
          turn.settle({ blocks: [], messageId: 'completed-comparison' });
          await fixture.whenStable();
          fixture.detectChanges();
          expect(api().isTyping()).toBe(false);
          expect(state.activeComparison()).toBe(comparison);
          expect(compiled.querySelector('app-comparison-panel-component')).not.toBeNull();
          expect(compiled.querySelector('[title="Close"]')).not.toBeNull();
        });
      }
    }

    it('scrolls only the transcript immediately as streamed text grows', async () => {
      const { scroll, state } = await setupHistory();
      let emit: (event: unknown) => void = () => {};
      copilot.streamMessage.mockImplementation((_m, _c, onEvent) => {
        emit = onEvent;
        return new Promise(() => {});
      });
      api().sendMessage('Tell me more');
      await fixture.whenStable();
      for (const height of [700, 850, 1000]) {
        Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: height });
        emit({ type: 'assistant.delta', data: { delta: ' More details.' } });
        await fixture.whenStable();
        expect(scroll.scrollTop).toBe(height);
      }
      expect(state.scrollAnchor().nativeElement.scrollIntoView).not.toHaveBeenCalled();
    });

    it('cancels a pending historical selection when a new question starts', async () => {
      const { state, products, scroll, focus } = await setupHistory();
      vi.useFakeTimers();
      try {
        scroll.dispatchEvent(new WheelEvent('wheel'));
        scroll.dispatchEvent(new Event('scroll'));
        api().sendMessage('Another question');
        vi.advanceTimersByTime(150);
        expect(state.activeProducts()).toBe(products);
        expect(focus).not.toHaveBeenCalled();
        fixture.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('clearing the session', () => {
    it('drops an answer that arrives after the conversation was cleared', async () => {
      // The turn keeps running after a clear — the promise is already in flight and the
      // server is already working. What must not happen is that answer appearing in the
      // transcript the shopper just emptied, which is also a DIFFERENT conversation than
      // the one that asked the question.
      const turn = pendingTurn();
      copilot.streamMessage.mockReturnValue(turn.promise);

      await openPanel();
      api().sendMessage('show me running shoes');
      expect(api().messages().length).toBeGreaterThan(1);

      api().confirmClear();
      expect(api().messages()).toHaveLength(1);

      turn.settle({ blocks: [{ type: 'text', text: 'Here are some shoes.' }] });
      await fixture.whenStable();

      expect(api().messages()).toHaveLength(1);
      expect(api().messages()[0].text).toContain('cleared');
    });

    it('ignores streamed deltas from a turn the clear already ended', async () => {
      const turn = pendingTurn();
      let emit: ((event: unknown) => void) | undefined;
      copilot.streamMessage.mockImplementation(
        (_m: string, _c: unknown, onEvent: (e: unknown) => void) => {
          emit = onEvent;
          return turn.promise;
        },
      );

      await openPanel();
      api().sendMessage('show me running shoes');
      api().confirmClear();

      emit?.({ type: 'assistant.delta', data: { delta: 'Well, actually...' } });
      await fixture.whenStable();

      expect(api().messages()).toHaveLength(1);
    });

    it('clears the compare selection, so it cannot ride into the next conversation', async () => {
      // The selection is sent as pageContext.selectedProductIds, so leaving it behind made a
      // brand-new conversation's first question refer to products picked in the deleted one.
      await openPanel();
      api().toggleProductSelection({ productId: 'p1', name: 'A shoe' } as unknown as Product);
      expect(api().selectedProducts()).toHaveLength(1);

      api().confirmClear();

      expect(api().selectedProducts()).toHaveLength(0);
    });

    it('ends the conversation server-side as well as locally', async () => {
      await openPanel();
      api().sendMessage('anything');
      api().confirmClear();

      // Without this the stored credential survives and the next page load resumes the
      // transcript the shopper just deleted.
      expect(copilot.endConversation).toHaveBeenCalled();
    });

    it('leaves the composer usable after clearing mid-answer', async () => {
      // isTyping gates sendMessage. A clear during a turn used to leave it stuck on, so the
      // fresh session silently swallowed the shopper's next message.
      copilot.streamMessage.mockReturnValue(pendingTurn().promise);

      await openPanel();
      api().sendMessage('show me running shoes');
      expect(api().isTyping()).toBe(true);

      api().confirmClear();

      expect(api().isTyping()).toBe(false);
    });
  });

  describe('without a connected store', () => {
    it('says it cannot answer instead of inventing a reply', async () => {
      // There is no local fallback any more. The keyword replies and the public fake-data
      // catalog that used to answer here described products the merchant does not sell,
      // which is worse than saying nothing.
      copilot.isConfigured = false;
      await openPanel();

      api().sendMessage('show me running shoes');

      const reply = api().messages().at(-1)!;
      expect(reply.role).toBe('assistant');
      expect(reply.text).toContain("can't reach this store's catalog");
      expect(copilot.streamMessage).not.toHaveBeenCalled();
    });
  });

  describe('suggestion chips', () => {
    const shoe = { ...DUMMY_PRODUCTS[0], productId: 'shoe', name: 'Running shoe' };
    const boot = { ...DUMMY_PRODUCTS[1], productId: 'boot', name: 'Hiking boot' };

    function state() {
      return component as unknown as {
        messages: { set(value: ChatMessage[]): void };
        pageProductName: { set(value: string | null): void };
        draft: { set(value: string): void };
      };
    }

    /** The chip labels currently rendered — what the shopper can actually click. */
    function chips(): string[] {
      return [
        ...compiled.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Suggested questions"] button',
        ),
      ].map((button) => button.textContent!.trim());
    }

    async function showAnswer(extra: Partial<ChatMessage>) {
      await openPanel();
      state().messages.set([
        { id: 'q1', role: 'user', text: 'Show me shoes', time: '' },
        { id: 'a1', role: 'assistant', text: 'Here you go', time: '', ...extra },
      ]);
      await fixture.whenStable();
    }

    it('offers the openers on an empty chat that is about no product', async () => {
      await openPanel();

      expect(chips()).toEqual([
        'What products do you have?',
        'Help me find something within my budget',
        'Help me compare two products',
      ]);
    });

    it('shows the welcome screen in place of the greeting until the shopper speaks', async () => {
      await openPanel();

      expect(compiled.textContent).toContain('Find the right thing');
      expect(compiled.textContent).not.toContain('What are you shopping for?');
      // The openers are the welcome screen's cards, not a second row above the composer.
      expect(compiled.querySelectorAll('[aria-label="Suggested questions"]').length).toBe(1);

      state().messages.set([
        { id: 'q1', role: 'user', text: 'Show me shoes', time: '' },
        { id: 'a1', role: 'assistant', text: 'Here you go', time: '' },
      ]);
      await fixture.whenStable();
      expect(compiled.textContent).not.toContain('Find the right thing');
    });

    it('copies an answer and confirms it only once the clipboard accepted it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await showAnswer({ serverId: 'm1' });

      compiled.querySelector<HTMLButtonElement>('[aria-label="Copy answer"]')!.click();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith('Here you go');
      expect(compiled.querySelector('[aria-label="Answer copied"]')).not.toBeNull();
    });

    it('shows one row of chips: an answer with its own next steps hides the composer row', async () => {
      await showAnswer({
        products: [shoe],
        suggestions: [{ label: 'Only Nike', message: 'Show me Nike shoes' }],
      });

      // One product would normally bring the recommendation shortcuts...
      expect(chips()).toEqual([]);
      // ...but the answer already carries its own, rendered beneath it.
      expect(compiled.querySelector('.aa-followup-chip')!.textContent!.trim()).toBe('Only Nike');
    });

    it('offers recommendation shortcuts under an answer about one product', async () => {
      await showAnswer({ products: [shoe] });

      expect(chips()).toEqual([
        'Show me something similar',
        'Any better option?',
        'What goes well with this?',
        'Show me another option',
      ]);
    });

    it('offers them on a product page before the chat has shown anything', async () => {
      // "this" is the page product there — the backend resolves it from the page.
      await openPanel();
      state().pageProductName.set('Trail watch');
      await fixture.whenStable();

      expect(chips()).toContain('Any better option?');
      expect(chips().length).toBeLessThanOrEqual(4);
    });

    it('offers none where "this" would not name one product', async () => {
      // Several results, a comparison or a failure: the same sentence typed there gets
      // "Which product did you mean?", so a chip would only offer a question.
      await showAnswer({ products: [shoe, boot] });
      expect(chips()).toEqual([]);

      state().messages.set([
        { id: 'q1', role: 'user', text: 'compare', time: '' },
        {
          id: 'a1',
          role: 'assistant',
          text: 'Side by side',
          time: '',
          products: [shoe],
          comparison: { products: [shoe, boot], rows: [] },
        },
      ]);
      await fixture.whenStable();
      expect(chips()).toEqual([]);

      state().messages.set([
        { id: 'q1', role: 'user', text: 'shoes', time: '' },
        { id: 'a1', role: 'assistant', text: 'Failed', time: '', isSearchError: true },
      ]);
      await fixture.whenStable();
      expect(chips()).toEqual([]);
    });

    it('sends a clicked chip as an ordinary message and clears the row', async () => {
      await showAnswer({ products: [shoe] });

      const chip = [
        ...compiled.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Suggested questions"] button',
        ),
      ].find((button) => button.textContent!.trim() === 'What goes well with this?')!;
      chip.click();
      await fixture.whenStable();

      // The same turn a typed message runs: the text as the shopper's message, sent
      // through the normal stream with nothing added to it.
      expect(api().messages().at(-1)).toMatchObject({
        role: 'user',
        text: 'What goes well with this?',
      });
      expect(copilot.streamMessage).toHaveBeenCalledTimes(1);
      expect(copilot.streamMessage.mock.calls[0][0]).toBe('What goes well with this?');
      expect(chips()).toEqual([]);
    });

    it('steps aside while the shopper is typing their own message', async () => {
      await showAnswer({ products: [shoe] });

      state().draft.set('does it come in blue');
      await fixture.whenStable();

      expect(chips()).toEqual([]);
    });
  });

  describe('answer rendering', () => {
    it('renders a completed answer as markdown, not as literal asterisks', async () => {
      copilot.textFromBlocks.mockReturnValue('**Nike Air Max** is in stock.');
      const turn = await startTurn();

      turn.settle({ blocks: [{ type: 'text', text: '**Nike Air Max** is in stock.' }] });
      await fixture.whenStable();

      const answer = api().messages().at(-1)!;
      expect(answer.html).toContain('<strong>Nike Air Max</strong>');
    });

    it('renders markdown while the answer is still streaming', async () => {
      const turn = await startTurn();

      turn.emit({ type: 'turn.started', data: {} });
      turn.emit({ type: 'assistant.delta', data: { delta: '## Picks\n\n- Nike' } });
      await fixture.whenStable();

      const streaming = api().messages().at(-1)!;
      expect(streaming.html).toContain('<h2>Picks</h2>');
      expect(streaming.html).toContain('<li>Nike</li>');
    });

    it('leaves a half-written token as literal text until it closes', async () => {
      // The degradation that makes per-delta rendering safe: an unclosed `**` is the
      // characters the shopper watched being typed, not a formatting glitch, and it
      // becomes bold in the same place once the closing pair lands.
      const turn = await startTurn();

      turn.emit({ type: 'turn.started', data: {} });
      turn.emit({ type: 'assistant.delta', data: { delta: '**Nike' } });
      await fixture.whenStable();

      const partial = api().messages().at(-1)!;
      expect(partial.text).toBe('**Nike');
      expect(partial.html).toContain('**Nike');
      expect(partial.html).not.toContain('<strong>');

      turn.emit({ type: 'assistant.delta', data: { delta: ' Air Max** is in stock.' } });
      await fixture.whenStable();

      const closed = api().messages().at(-1)!;
      expect(closed.html).toContain('<strong>Nike Air Max</strong>');
    });

    it('does not let an unfinished code fence swallow the rest of the answer', async () => {
      // The one partial construct that does NOT degrade quietly: without a closing fence
      // marked reads everything after ``` as code, so the whole reply would collapse into
      // one grey box mid-stream and spring back out at the end.
      const turn = await startTurn();

      turn.emit({ type: 'turn.started', data: {} });
      turn.emit({
        type: 'assistant.delta',
        data: { delta: 'Run this:\n\n```bash\nnpm install' },
      });
      await fixture.whenStable();

      const streaming = api().messages().at(-1)!;
      expect(streaming.html).toContain('<p>Run this:</p>');
      expect(streaming.html).toContain('npm install');
      expect(streaming.html).toContain('<pre>');
    });

    it('never renders a shopper’s own message as markdown', async () => {
      await openPanel();
      api().sendMessage('is **this** in stock?');

      const asked = api()
        .messages()
        .find((m) => m.role === 'user')!;
      expect(asked.html).toBeUndefined();
      expect(asked.text).toBe('is **this** in stock?');
    });
  });

  it('answers a store overview with category tiles, and a tap asks for that category', async () => {
    copilot.textFromBlocks.mockReturnValue('This store has 93 products across 18 categories.');
    copilot.categoriesFromBlocks.mockReturnValue([
      {
        id: 32,
        name: 'Laptops',
        productCount: 10,
        priceFrom: 49999,
        currency: '₹',
        imageUrl: '',
        subcategories: [],
        message: 'Show me Laptops',
      },
      {
        id: 17,
        name: 'Smartphones',
        productCount: 10,
        priceFrom: 11999,
        currency: '₹',
        imageUrl: '',
        subcategories: [],
        message: 'Show me Smartphones',
      },
    ]);
    const turn = await startTurn('What products do you have?');
    turn.settle({ blocks: [], messageId: 'overview' });
    await fixture.whenStable();
    fixture.detectChanges();

    const tiles = compiled.querySelectorAll<HTMLButtonElement>('.aa-category-tile');
    expect(tiles.length).toBe(2);
    expect(tiles[0].textContent).toContain('from ₹49,999');

    copilot.streamMessage.mockReturnValue(new Promise(() => {}));
    tiles[1].click();
    await fixture.whenStable();
    expect(copilot.streamMessage.mock.calls.at(-1)![0]).toBe('Show me Smartphones');
  });

  describe('progress indicator', () => {
    it('shows only the current loading status beside the Miyya logo', async () => {
      const { emit, settle } = await startTurn();
      await fixture.whenStable();

      const initialStatus = compiled.querySelector('[aria-label="What Miyya is doing"]')!;
      expect(initialStatus.querySelector('app-miyya-mark')).not.toBeNull();
      expect(initialStatus.querySelector('.aa-flow-label')?.textContent?.trim()).toBe(
        'Looking for you…',
      );
      expect(compiled.textContent).not.toContain('Miyya is thinking…');

      emit({ type: 'turn.started', sequence: 1, turnId: 't', data: {} });
      emit({
        type: 'turn.progress',
        sequence: 2,
        turnId: 't',
        data: { stage: 'searching', label: 'Searching the store' },
      });
      emit({
        type: 'turn.progress',
        sequence: 3,
        turnId: 't',
        data: { stage: 'verifying', label: 'Checking live prices and stock' },
      });
      await fixture.whenStable();

      const status = compiled.querySelector('[aria-label="What Miyya is doing"]')!;
      expect(status.querySelector('app-miyya-mark')).not.toBeNull();
      expect(status.querySelector('.aa-flow-label')?.textContent?.trim()).toBe(
        'Checking live prices and stock',
      );
      expect(status.textContent).not.toContain('Searching the store');
      expect(status.querySelectorAll('.aa-flow-label')).toHaveLength(1);
      expect(status.querySelector('.aa-flow-dots')).not.toBeNull();

      settle({ blocks: [], messageId: 'done' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(api().isTyping()).toBe(false);
      expect(compiled.querySelector('[aria-label="What Miyya is doing"]')).toBeNull();
    });

    it('shows nothing until the server reports the turn started', async () => {
      // The old indicator began ticking through invented stages the moment the request
      // left the browser, whether or not anything had happened yet.
      await startTurn();

      expect(api().loadingSteps()).toBeNull();
    });

    it('advances only on real SSE events', async () => {
      const turn = await startTurn();

      turn.emit({ type: 'turn.started', data: {} });
      await fixture.whenStable();
      let steps = api().loadingSteps()!;
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ label: 'Understanding your request', active: true });

      turn.emit({
        type: 'products.ready',
        data: { block: { type: 'product_grid', items: [{}, {}, {}] } },
      });
      await fixture.whenStable();
      steps = api().loadingSteps()!;
      expect(steps[0].done).toBe(true);
      expect(steps.at(-1)).toMatchObject({
        label: 'Found 3 products — writing your answer',
        active: true,
      });
    });

    it('never walks backwards on a late event', async () => {
      // SSE events are ordered, but a stage must not regress if one arrives out of turn.
      const turn = await startTurn();

      turn.emit({
        type: 'products.ready',
        data: { block: { type: 'product_carousel', items: [{}] } },
      });
      turn.emit({ type: 'turn.started', data: {} });
      await fixture.whenStable();

      expect(api().loadingSteps()!.at(-1)!.label).toContain('Found 1 product');
    });

    it('counts comparison products from the comparison event contract', async () => {
      const turn = await startTurn();

      turn.emit({
        type: 'comparison.ready',
        data: { block: { type: 'comparison', products: [{}, {}], rows: [] } },
      });
      await fixture.whenStable();

      expect(api().loadingSteps()!.at(-1)!.label).toContain('Found 2 products');
    });

    it('reveals the answer with no artificial delay', async () => {
      // A 450ms hold used to be added to every answer so the finished checklist could be
      // admired. This asserts the answer is in the transcript synchronously on settle.
      copilot.textFromBlocks.mockReturnValue('Here it is.');
      const turn = await startTurn();

      turn.settle({ blocks: [{ type: 'text', text: 'Here it is.' }] });
      await fixture.whenStable();

      expect(api().messages().at(-1)!.text).toBe('Here it is.');
      expect(api().loadingSteps()).toBeNull();
    });
  });

  it('clears any drag offset across a maximise/restore round trip', async () => {
    // A drag offset captured while floating used to survive the round trip,
    // re-applying coordinates clamped against bounds that no longer hold — which
    // could leave the panel, and its close button, partly off-screen.
    await openPanel();

    const panel = compiled.querySelector<HTMLElement>('textarea')!.closest<HTMLElement>('.fixed')!;
    panel.style.transform = 'translate(120px, 90px)';

    compiled.querySelector<HTMLButtonElement>('[title="Maximize"]')!.click();
    await fixture.whenStable();
    compiled.querySelector<HTMLButtonElement>('[title="Minimize"]')!.click();
    await fixture.whenStable();

    const restored = compiled
      .querySelector<HTMLElement>('textarea')!
      .closest<HTMLElement>('.fixed')!;
    expect(restored.style.transform).toBe('translate(0px, 0px)');
  });

  /**
   * The storefront host resizes the iframe the moment it is told to, so WHEN the app
   * reports a state decides whether the panel's own open/close animation is visible or
   * clipped by a frame that already shrank around it.
   */
  describe('storefront widget frame sizing', () => {
    let posted: { state?: string }[];
    let postSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      // `embedded` is read once, at construction, so the config has to be in place
      // before this fixture replaces the one the outer beforeEach built.
      window.AIAssistantConfig = { route: '/widget', embedded: true };
      posted = [];
      postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
        posted.push(message as { state?: string });
      });

      fixture = TestBed.createComponent(ChatComponent);
      component = fixture.componentInstance;
      compiled = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    afterEach(() => {
      postSpy.mockRestore();
      delete window.AIAssistantConfig;
    });

    it('grows the frame as soon as the panel opens', async () => {
      posted.length = 0;

      await openPanel();

      // Immediately, with no timer to wait on: the extra space is what the entering
      // panel animates into.
      expect(posted.map((message) => message.state)).toContain('open');
    });

    it('holds the frame at its open size until the exit animation has played', async () => {
      await openPanel();
      posted.length = 0;
      vi.useFakeTimers();

      try {
        compiled.querySelector<HTMLButtonElement>('[title="Close"]')!.click();
        fixture.detectChanges();

        expect(posted.map((message) => message.state)).not.toContain('closed');

        vi.advanceTimersByTime(220);

        expect(posted.map((message) => message.state)).toContain('closed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('never offsets the panel inside the frame when the frame resizes', async () => {
      await openPanel();
      const panel = compiled.querySelector<HTMLElement>('.aa-chat-shell')!;
      // What the open animation reports mid-flight while the frame grows from the
      // bubble: the scaled, translated panel poking past the frame's top-left.
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(-6, -6, window.innerWidth + 12, window.innerHeight + 12),
      );

      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();

      expect(panel.style.transform).toBe('translate(0px, 0px)');
    });
  });

  describe('as a storefront rail (Left/Right design)', () => {
    let postSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      // Read once, at construction — see the frame-sizing suite above.
      window.AIAssistantConfig = { route: '/widget', embedded: true, widgetLayout: 'right' };
      postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

      fixture = TestBed.createComponent(ChatComponent);
      component = fixture.componentInstance;
      compiled = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    afterEach(() => {
      postSpy.mockRestore();
      delete window.AIAssistantConfig;
    });

    it('drops maximise and drag, and keeps close', async () => {
      await openPanel();

      expect(compiled.querySelector('[aria-label="Maximize chat"]')).toBeNull();
      expect(compiled.querySelector('[aria-label="Close chat"]')).not.toBeNull();
      expect(compiled.querySelector('header')!.classList.contains('cursor-grab')).toBe(false);
    });
  });

  it('keeps maximise and drag in the classic panel', async () => {
    await openPanel();

    expect(compiled.querySelector('[aria-label="Maximize chat"]')).not.toBeNull();
    expect(compiled.querySelector('header')!.classList.contains('cursor-grab')).toBe(true);
  });
  it('keeps billing details out of embedded service-unavailable messages', async () => {
    Object.defineProperty(component, 'embedded', { value: true });
    copilot.getReadiness.mockResolvedValue({
      ready: false, status: 'credits_exhausted', message: 'Recharge your paid account.',
    });
    const readiness = await (component as unknown as {
      evaluateReadiness(): Promise<{ message: string; ready: boolean }>;
    }).evaluateReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.message).toContain('temporarily unavailable');
    expect(readiness.message).not.toContain('Recharge');
  });

});
