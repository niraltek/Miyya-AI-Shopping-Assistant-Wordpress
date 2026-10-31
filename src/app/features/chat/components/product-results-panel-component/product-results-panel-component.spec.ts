import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Product } from '../../models/product';
import { ProductResultsPanelComponent } from './product-results-panel-component';

describe('ProductResultsPanelComponent commercial facts', () => {
  let fixture: ComponentFixture<ProductResultsPanelComponent>;
  let compiled: HTMLElement;

  const product: Product = {
    productId: 'a',
    name: 'Store product',
    brand: '',
    category: '',
    description: '',
    price: { current: 19.99, currency: 'USD', verified: false },
    stock: { status: 'instock', verified: false },
    imageUrl: '',
    productUrl: 'https://shop.example/product/a',
    attributes: {},
    reason: '',
    match: { score: 0 },
    averageRating: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductResultsPanelComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductResultsPanelComponent);
    compiled = fixture.nativeElement as HTMLElement;
  });

  async function render(overrides: Partial<Product> = {}): Promise<void> {
    fixture.componentRef.setInput('products', [{ ...product, ...overrides }]);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows missing price and stock as unknown instead of a free in-stock offer', async () => {
    await render({
      price: { current: null, currency: 'USD', verified: false },
      stock: { status: 'unknown', verified: false },
    });

    expect(compiled.querySelector('.aa-product-price')?.textContent).toContain('Price unavailable');
    expect(compiled.querySelector('.aa-product-price')?.textContent).not.toContain('$');
    expect(compiled.querySelector('.aa-product-stock')?.textContent).toContain(
      'Availability unknown',
    );
    expect(compiled.querySelector('.aa-product-stock')?.textContent).not.toContain('In stock');
    expect(compiled.textContent).not.toContain('Live verified');
  });

  it('still displays a real zero price', async () => {
    await render({ price: { current: 0, currency: 'USD', verified: true } });

    const priceText = compiled.querySelector('.aa-product-price')?.textContent;
    expect(priceText).toContain('$0');
    expect(priceText).toContain('Live verified price');
    expect(priceText).not.toContain('Price unavailable');
  });

  it('visibly qualifies catalog price and availability', async () => {
    await render();

    expect(compiled.querySelector('.aa-product-price')?.textContent).toContain(
      'Price not live verified',
    );
    expect(compiled.querySelector('.aa-product-stock')?.textContent).toContain(
      'Availability not live verified',
    );
    expect(
      compiled.querySelector('.aa-product-stock span')?.classList.contains('bg-emerald-500/10'),
    ).toBe(false);
  });

  it('keeps price verification separate from availability verification', async () => {
    await render({ price: { current: 19.99, currency: 'USD', verified: true } });

    expect(compiled.querySelector('.aa-product-price')?.textContent).toContain(
      'Live verified price',
    );
    expect(compiled.querySelector('.aa-product-stock')?.textContent).toContain(
      'Availability not live verified',
    );

    await render({ stock: { status: 'instock', verified: true } });

    expect(compiled.querySelector('.aa-product-price')?.textContent).toContain(
      'Price not live verified',
    );
    expect(compiled.querySelector('.aa-product-stock')?.textContent).toContain(
      'Live verified availability',
    );
  });

  it('displays backorders distinctly from available stock', async () => {
    await render({ stock: { status: 'onbackorder', verified: true } });

    const stockText = compiled.querySelector('.aa-product-stock')?.textContent;
    expect(stockText).toContain('On backorder');
    expect(stockText).not.toContain('In stock');
    expect(stockText).not.toContain('Out of stock');
  });

  it('preserves out-of-stock availability', async () => {
    await render({ stock: { status: 'outofstock', verified: true } });

    expect(compiled.querySelector('.aa-product-stock')?.textContent).toContain('Out of stock');
  });
});
