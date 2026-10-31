import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { DashboardComponent } from './dashboard-component';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        // The template uses routerLink, which cannot resolve without a router.
        provideRouter([]),
        // ngOnInit injects WooCommerceService, which injects HttpClient — without
        // a provider here that fails in the DI graph before the component even
        // constructs, regardless of whether a request is ever made.
        provideHttpClient(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reports an unavailable status check without claiming the store is disconnected', async () => {
    const woo = TestBed.inject(WooCommerceService);
    vi.spyOn(woo, 'getIdentity').mockReturnValue({
      email: 'merchant@example.com', storeUrl: 'https://shop.example',
    });
    vi.spyOn(woo, 'getConnectionStatus').mockRejectedValue(new Error('network unavailable'));
    await component.ngOnInit();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Unable to check');
    expect(text).not.toContain('Not connected');
    expect(text).not.toContain('Miyya is ready');
  });

  it('shows "Not connected" when no merchant identity is available', () => {
    // window.AIAssistantConfig is undefined outside WordPress (as in this test),
    // so ngOnInit takes its early-return path rather than calling the backend.
    // stats() is protected, so this reads the rendered card rather than the signal.
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Not connected');
  });

  it('backs off a run that remains active instead of polling forever at high frequency', () => {
    const polling = component as unknown as {
      store: { set(value: unknown): void };
      indexStatus: { set(value: unknown): void };
      activePollStartedAt: number | null;
      nextPollDelay(): number | null;
    };
    const now = vi.spyOn(Date, 'now');

    polling.store.set({ catalogStatus: true });
    polling.indexStatus.set({
      catalogSync: null,
      embeddingIndex: { status: 'queued' },
      catalogCounts: { productsInStore: 1, productsSynced: 1, productsIndexed: 0 },
    });

    now.mockReturnValue(1_000);
    expect(polling.nextPollDelay()).toBe(2_000);
    now.mockReturnValue(32_000);
    expect(polling.nextPollDelay()).toBe(10_000);
    now.mockReturnValue(122_000);
    expect(polling.nextPollDelay()).toBe(30_000);

    now.mockRestore();
  });

  it('shows the last sync date and the local time with AM or PM', () => {
    const dashboard = component as unknown as {
      store: { set(value: unknown): void };
      indexStatus: { set(value: unknown): void };
    };
    dashboard.store.set({ catalogStatus: true });
    dashboard.indexStatus.set({
      catalogSync: {
        status: 'completed',
        productsReceived: 93,
        expectedTotal: 93,
        completedAt: '2026-10-28T05:21:38Z',
      },
      embeddingIndex: { status: 'ready', processedProducts: 93, totalProducts: 93 },
      catalogCounts: { productsInStore: 93, productsSynced: 93, productsIndexed: 93 },
    });

    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toMatch(/October (27|28), 2026/);
    expect(text).toMatch(/Last synced at \d{1,2}:\d{2} (AM|PM)/);
  });

  it('does not present retained run history as an automatically started first sync', () => {
    const dashboard = component as unknown as {
      store: { set(value: unknown): void };
      indexStatus: { set(value: unknown): void };
      catalogHealth(): { state: string; detail: string };
      catalogSyncCard(): { state: string };
      embeddingIndexCard(): { state: string };
      lastSyncHint(): string;
      trackDrift(counts: unknown): void;
      nextPollDelay(): number | null;
    };
    const counts = { productsInStore: 93, productsSynced: 0, productsIndexed: 0 };

    dashboard.store.set({
      storeUrl: 'https://shop.example',
      platform: 'woocommerce',
      status: 'connected',
      permission: 'read',
      catalogStatus: false,
    });
    dashboard.indexStatus.set({
      // Run history is intentionally retained after disconnect/reconnect.
      catalogSync: {
        status: 'completed',
        productsReceived: 0,
        expectedTotal: 93,
        completedAt: '2026-09-21T00:00:00Z',
      },
      embeddingIndex: {
        status: 'ready',
        processedProducts: 0,
        totalProducts: 0,
      },
      catalogCounts: counts,
    });

    dashboard.trackDrift(counts);

    expect(dashboard.catalogHealth().state).toBe('unknown');
    expect(dashboard.catalogHealth().detail).not.toContain('syncing now');
    expect(dashboard.catalogSyncCard().state).toBe('not_started');
    expect(dashboard.embeddingIndexCard().state).toBe('not_started');
    expect(dashboard.lastSyncHint()).toBe("Your store hasn't been synced yet.");
    expect(dashboard.nextPollDelay()).toBeNull();
  });

  describe('while the first sync is still running', () => {
    type Internals = {
      store: { (): { catalogStatus?: boolean } | null; set(value: unknown): void };
      indexStatus: { set(value: unknown): void };
      woocommerce: { getIdentity(): unknown; getConnectionStatus(...a: unknown[]): unknown };
      catalogSyncCard(): { state: string; processed?: number; total?: number };
      embeddingIndexCard(): { state: string; processed?: number; total?: number };
      nextPollDelay(): number | null;
      reloadStoreAfterFirstSync(status: unknown): Promise<void>;
    };
    const firstSyncStore = {
      storeUrl: 'https://shop.example',
      platform: 'woocommerce',
      status: 'connected',
      permission: 'read',
      catalogStatus: false,
    };
    const running = (received: number, indexed: number) => ({
      catalogSync: { status: 'running', productsReceived: received, expectedTotal: 350 },
      embeddingIndex: { status: 'indexing', processedProducts: indexed, totalProducts: 350 },
      catalogCounts: { productsInStore: 350, productsSynced: received, productsIndexed: indexed },
    });
    const finished = {
      catalogSync: { status: 'completed', productsReceived: 350, expectedTotal: 350 },
      embeddingIndex: { status: 'ready', processedProducts: 350, totalProducts: 350 },
      catalogCounts: { productsInStore: 350, productsSynced: 350, productsIndexed: 350 },
    };

    it('shows both runs live and keeps polling, instead of "Not started"', () => {
      const dashboard = component as unknown as Internals;
      dashboard.store.set(firstSyncStore);
      dashboard.indexStatus.set(running(150, 100));

      expect(dashboard.catalogSyncCard()).toMatchObject({
        state: 'syncing',
        processed: 150,
        total: 350,
      });
      // The AI Search Index runs alongside the sync; it is not waiting for it to finish.
      expect(dashboard.embeddingIndexCard()).toMatchObject({
        state: 'indexing',
        processed: 100,
        total: 350,
      });
      expect(dashboard.nextPollDelay()).toBe(2_000);
    });

    it('keeps the fast refresh while the figures move and backs off once they stop', () => {
      const dashboard = component as unknown as Internals;
      const now = vi.spyOn(Date, 'now');
      dashboard.store.set(firstSyncStore);

      dashboard.indexStatus.set(running(150, 100));
      now.mockReturnValue(1_000);
      expect(dashboard.nextPollDelay()).toBe(2_000);

      // 40 s in, but the sync has moved on: still the fast cadence.
      dashboard.indexStatus.set(running(250, 200));
      now.mockReturnValue(41_000);
      expect(dashboard.nextPollDelay()).toBe(2_000);

      // Nothing has changed for over 30 s: now it is treated as possibly stuck.
      now.mockReturnValue(75_000);
      expect(dashboard.nextPollDelay()).toBe(10_000);

      now.mockRestore();
    });

    it('re-reads the store once the sync it watched has ended, so the cards settle', async () => {
      const dashboard = component as unknown as Internals;
      const identity = vi.spyOn(dashboard.woocommerce, 'getIdentity').mockReturnValue({
        email: 'owner@shop.example',
        storeUrl: 'https://shop.example',
      });
      const connection = vi.spyOn(dashboard.woocommerce, 'getConnectionStatus').mockResolvedValue({
        status: 'connected',
        store: { ...firstSyncStore, catalogStatus: true },
      });
      dashboard.store.set(firstSyncStore);

      await dashboard.reloadStoreAfterFirstSync(running(150, 100));
      expect(connection).not.toHaveBeenCalled();

      await dashboard.reloadStoreAfterFirstSync(finished);
      expect(connection).toHaveBeenCalledTimes(1);
      expect(dashboard.store()?.catalogStatus).toBe(true);

      // Already complete: nothing further to fetch.
      await dashboard.reloadStoreAfterFirstSync(finished);
      expect(connection).toHaveBeenCalledTimes(1);

      identity.mockRestore();
      connection.mockRestore();
    });

    it('does not re-read the store for retained history it never saw running', async () => {
      const dashboard = component as unknown as Internals;
      const connection = vi
        .spyOn(dashboard.woocommerce, 'getConnectionStatus')
        .mockResolvedValue({ status: 'connected', store: firstSyncStore });
      dashboard.store.set(firstSyncStore);

      await dashboard.reloadStoreAfterFirstSync(finished);

      expect(connection).not.toHaveBeenCalled();
      connection.mockRestore();
    });
  });
});
