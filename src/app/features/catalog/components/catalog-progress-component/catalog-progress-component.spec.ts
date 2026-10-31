import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { CatalogProgressComponent } from './catalog-progress-component';
import { CatalogService } from '../../services/catalog-service/catalog-service';
import { CatalogSyncStatusResponse } from '../../models/catalog';

function finishedStatus(overrides: Partial<CatalogSyncStatusResponse>): CatalogSyncStatusResponse {
  return {
    syncRunId: 'run-1',
    status: 'completed',
    pagesProcessed: 2,
    productsReceived: 118,
    productsCreated: 118,
    productsUpdated: 0,
    productsFailed: 0,
    productsSkipped: 0,
    errors: [],
    ...overrides,
  };
}

describe('CatalogProgressComponent', () => {
  let component: CatalogProgressComponent;
  let fixture: ComponentFixture<CatalogProgressComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogProgressComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogProgressComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the not-found state when the route carries no syncRunId', () => {
    // Guards against polling a bare `/catalog-sync/` URL forever: with no id in the
    // route, ngOnInit must short-circuit to the not-found panel instead of starting
    // a poll loop that can never resolve.
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Sync not found');
  });

  describe('once the run finishes', () => {
    let runFixture: ComponentFixture<CatalogProgressComponent>;
    let runComponent: CatalogProgressComponent;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [CatalogProgressComponent],
        providers: [
          provideHttpClient(),
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: { paramMap: convertToParamMap({ syncRunId: 'run-1' }) },
            },
          },
        ],
      }).compileComponents();

      // ngOnInit starts polling this over HTTP as soon as the component is created —
      // stub it out so each test drives the settled state directly instead.
      vi.spyOn(TestBed.inject(CatalogService), 'getStatus').mockResolvedValue(
        finishedStatus({ status: 'running' }),
      );

      runFixture = TestBed.createComponent(CatalogProgressComponent);
      runComponent = runFixture.componentInstance;
      await runFixture.whenStable();
    });

    // The bar eases toward the real counters on a timer (tick), which this isn't testing —
    // setting `status` and `displayed` directly drives straight to the settled state the
    // summary/success banner render from.
    function settle(status: CatalogSyncStatusResponse): void {
      const internals = runComponent as unknown as {
        status: { set(v: CatalogSyncStatusResponse): void };
        displayed: { set(v: number): void };
      };
      internals.status.set(status);
      internals.displayed.set(1);
      runFixture.detectChanges();
    }

    it('shows a clear success confirmation, not just the plain headline', () => {
      settle(finishedStatus({ productsCreated: 118, productsUpdated: 0 }));

      const text = (runFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Catalog synced successfully');
      expect(text).toContain('118 products added');
    });

    it('phrases it differently when some products failed', () => {
      settle(
        finishedStatus({
          status: 'completed_with_errors',
          productsFailed: 2,
          errors: [
            {
              id: 'e1',
              errorStage: 'storing',
              errorMessage: 'boom',
              createdAt: '2026-09-24T00:00:00Z',
            },
          ],
        }),
      );

      const text = (runFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Catalog sync completed, with some issues');
      expect(text).not.toContain('Catalog synced successfully');
    });

    it('does not show the success banner while still failed outright', () => {
      settle(finishedStatus({ status: 'failed' }));

      const text = (runFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Catalog synced successfully');
      expect(text).not.toContain('Catalog sync completed, with some issues');
    });
  });

  describe('when the merchant comes back to a run that is already under way', () => {
    async function mount(status: CatalogSyncStatusResponse) {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [CatalogProgressComponent],
        providers: [provideHttpClient(), provideRouter([])],
      }).compileComponents();
      vi.spyOn(TestBed.inject(CatalogService), 'getStatus').mockResolvedValue(status);

      const resumed = TestBed.createComponent(CatalogProgressComponent);
      resumed.componentRef.setInput('syncRunId', 'run-1');
      await resumed.whenStable();
      resumed.detectChanges();
      return resumed;
    }

    const midRun = (overrides: Partial<CatalogSyncStatusResponse> = {}) =>
      finishedStatus({
        status: 'running',
        expectedTotal: 350,
        productsReceived: 210,
        productsCreated: 0,
        productsUpdated: 210,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        ...overrides,
      });

    it('shows its real position straight away instead of replaying from the first step', async () => {
      const resumed = await mount(midRun());
      const text = (resumed.nativeElement as HTMLElement).textContent ?? '';

      // 60% of the products fetched and stored lands in the third step, not the first.
      expect(text).toContain('61%');
      expect(text).toContain('210 of 350 products synced');
    });

    it('shows a run that finished while the merchant was away as complete, not replaying', async () => {
      const resumed = await mount(
        midRun({
          status: 'completed',
          productsReceived: 350,
          productsUpdated: 350,
          completedAt: new Date().toISOString(),
        }),
      );
      const text = (resumed.nativeElement as HTMLElement).textContent ?? '';

      expect(text).toContain('100%');
      expect(text).toContain('Catalog synced successfully');
    });
  });

  describe('pacing a run the backend finishes almost instantly', () => {
    afterEach(() => vi.useRealTimers());

    it('does not flash to 100% — a 100-product catalogue is paced to a readable length', async () => {
      vi.useFakeTimers();
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [CatalogProgressComponent],
        providers: [provideHttpClient(), provideRouter([])],
      }).compileComponents();
      const now = new Date().toISOString();
      vi.spyOn(TestBed.inject(CatalogService), 'getStatus').mockResolvedValue(
        finishedStatus({
          expectedTotal: 100,
          productsReceived: 100,
          productsCreated: 100,
          startedAt: now,
          completedAt: now,
        }),
      );

      const fresh = TestBed.createComponent(CatalogProgressComponent);
      fresh.componentRef.setInput('syncRunId', 'run-1');
      await vi.advanceTimersByTimeAsync(1500);
      fresh.detectChanges();
      expect((fresh.nativeElement as HTMLElement).textContent).not.toContain(
        'Catalog synced successfully',
      );

      await vi.advanceTimersByTimeAsync(10_000);
      fresh.detectChanges();
      expect((fresh.nativeElement as HTMLElement).textContent).toContain(
        'Catalog synced successfully',
      );
    });
  });
});
