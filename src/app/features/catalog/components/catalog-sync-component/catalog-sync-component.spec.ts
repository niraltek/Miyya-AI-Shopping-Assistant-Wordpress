import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { CatalogSyncComponent } from './catalog-sync-component';
import { CatalogService } from '../../services/catalog-service/catalog-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';

describe('CatalogSyncComponent', () => {
  let component: CatalogSyncComponent;
  let fixture: ComponentFixture<CatalogSyncComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogSyncComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogSyncComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('refuses to offer a sync when no store identity is available', () => {
    // A sync is meaningless without a connected store, so with no injected identity
    // the component must show the connect prompt rather than a Start button.
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No connected store found');
    expect(compiled.textContent).not.toContain('Start Catalog Sync');
  });

  describe('with a connected store', () => {
    const store = { name: 'elvora', storeUrl: 'https://shop.example.com', catalogStatus: true };

    function mount(latest: unknown) {
      const woocommerce = TestBed.inject(WooCommerceService);
      vi.spyOn(woocommerce, 'getIdentity').mockReturnValue({
        email: 'a@b.c',
        storeUrl: store.storeUrl,
      } as never);
      vi.spyOn(woocommerce, 'getConnectionStatus').mockResolvedValue({
        status: 'connected',
        store,
      } as never);
      vi.spyOn(TestBed.inject(CatalogService), 'getLatest').mockResolvedValue(latest as never);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      const next = TestBed.createComponent(CatalogSyncComponent);
      return { next, navigate };
    }

    it('shows the running sync in place instead of offering a second start', async () => {
      const { next, navigate } = mount({ syncRunId: 'run-1', status: 'running' });
      await next.whenStable();
      next.detectChanges();

      const el = next.nativeElement as HTMLElement;
      expect(el.querySelector('app-catalog-progress-component')).not.toBeNull();
      expect(el.textContent).not.toContain('Sync Now');
      expect(navigate).not.toHaveBeenCalled();
    });

    describe('arriving from the Miyya portal (autoSync)', () => {
      afterEach(() => {
        delete (window as { AIAssistantConfig?: unknown }).AIAssistantConfig;
      });

      it('starts the import without a second click', async () => {
        (window as { AIAssistantConfig?: unknown }).AIAssistantConfig = { autoSync: true };
        const { next } = mount({ syncRunId: 'run-1', status: 'completed' });
        const start = vi
          .spyOn(TestBed.inject(CatalogService), 'start')
          .mockResolvedValue({ syncRunId: 'run-2' } as never);

        await next.whenStable();
        next.detectChanges();

        expect(start).toHaveBeenCalledTimes(1);
        expect(
          (next.nativeElement as HTMLElement).querySelector('app-catalog-progress-component'),
        ).not.toBeNull();
      });

      it('does not start a second run when one is already in flight', async () => {
        (window as { AIAssistantConfig?: unknown }).AIAssistantConfig = { autoSync: true };
        const { next } = mount({ syncRunId: 'run-1', status: 'running' });
        const start = vi.spyOn(TestBed.inject(CatalogService), 'start');

        await next.whenStable();

        expect(start).not.toHaveBeenCalled();
      });

      it('stays idle without the flag', async () => {
        const { next } = mount({ syncRunId: 'run-1', status: 'completed' });
        const start = vi.spyOn(TestBed.inject(CatalogService), 'start');

        await next.whenStable();

        expect(start).not.toHaveBeenCalled();
      });
    });

    it('shows the idle screen when the last sync has finished', async () => {
      const { next } = mount({ syncRunId: 'run-1', status: 'completed' });
      await next.whenStable();
      next.detectChanges();

      const el = next.nativeElement as HTMLElement;
      expect(el.querySelector('app-catalog-progress-component')).toBeNull();
      expect(el.textContent).toContain('Sync Now');
      expect(el.textContent).toContain('Sync Settings');
    });
  });
});
