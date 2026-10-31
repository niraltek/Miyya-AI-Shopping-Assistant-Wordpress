import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CATALOG_SYNC_TRUST_POINTS } from '../../models/catalog';
import { CatalogSyncScopeComponent } from './catalog-sync-scope-component';

describe('CatalogSyncScopeComponent', () => {
  let component: CatalogSyncScopeComponent;
  let fixture: ComponentFixture<CatalogSyncScopeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogSyncScopeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogSyncScopeComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the catalog scope and read-only data reassurance by default', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Sync includes');
    expect(element.querySelectorAll('li')).toHaveLength(5);
    expect(element.textContent).toContain('Products & variations');
    expect(element.textContent).toContain('Categories');
    expect(element.textContent).toContain('Prices & stock status');
    expect(element.textContent).toContain('Product images');
    expect(element.textContent).toContain('Automatic updates');
    expect(element.textContent).toContain('How your data is used');
    expect(element.textContent).toContain('secure read-only access');
  });

  it('hides the optional trust points by default', () => {
    const element = fixture.nativeElement as HTMLElement;

    for (const point of CATALOG_SYNC_TRUST_POINTS) {
      expect(element.textContent).not.toContain(point);
    }
  });

  it('shows and hides trust points when its input changes', async () => {
    fixture.componentRef.setInput('showTrustPoints', true);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    for (const point of CATALOG_SYNC_TRUST_POINTS) {
      expect(element.textContent).toContain(point);
    }

    fixture.componentRef.setInput('showTrustPoints', false);
    await fixture.whenStable();

    for (const point of CATALOG_SYNC_TRUST_POINTS) {
      expect(element.textContent).not.toContain(point);
    }
  });
});
