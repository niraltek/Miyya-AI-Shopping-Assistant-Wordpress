import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComparisonTable, Product } from '../../models/product';
import { InlineComparisonComponent } from './inline-comparison-component';

function laptop(id: string, name: string, brand: string, price: number): Product {
  return {
    productId: id,
    name,
    brand,
    category: '',
    description: '',
    price: { current: price, currency: '₹', verified: true },
    stock: { status: 'instock', verified: true },
    imageUrl: '',
    productUrl: `https://store.example/${id}`,
    attributes: {},
    reason: '',
    match: { score: 0 },
    averageRating: null,
    regularPrice: null,
  };
}

describe('InlineComparisonComponent', () => {
  let fixture: ComponentFixture<InlineComparisonComponent>;
  let host: HTMLElement;

  function render(table: ComparisonTable): void {
    fixture.componentRef.setInput('table', table);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InlineComparisonComponent] });
    fixture = TestBed.createComponent(InlineComparisonComponent);
    host = fixture.nativeElement;
  });

  const acer = laptop('acer', 'Acer Gaming Laptop', 'Acer', 74999);
  const hp = laptop('hp', 'HP Pavilion Laptop', 'HP', 49999);

  it('prints prices in the store currency and marks the lowest with the difference', () => {
    render({
      products: [acer, hp],
      rows: [
        { field: 'price', label: 'Price', values: ['74999', '49999'], isLive: true },
        {
          field: 'stock_status',
          label: 'Availability',
          values: ['instock', 'instock'],
          isLive: true,
        },
      ],
    });

    expect(host.textContent).toContain('₹74,999');
    expect(host.textContent).toContain('₹49,999');
    expect(host.textContent).toContain('Lowest · ₹25,000 less');
    expect(host.textContent).toContain('In stock');
    expect(host.textContent).toContain('LIVE');
  });

  it('drops a row the store listed nothing for, and says "Not listed" for a single gap', () => {
    render({
      products: [acer, hp],
      rows: [
        { field: 'average_rating', label: 'Rating', values: [null, null], isLive: false },
        { field: 'series', label: 'Series', values: [null, 'Pavilion'], isLive: false },
      ],
    });

    expect(host.textContent).not.toContain('Rating');
    expect(host.textContent).toContain('Series');
    expect(host.textContent).toContain('Not listed');
  });

  it.each(['', '   ', '-10', 'invalid'])(
    'does not treat an invalid price (%j) as the lowest offer',
    (price) => {
      render({
        products: [acer, hp],
        rows: [{ field: 'price', label: 'Price', values: [price, '49999'], isLive: false }],
      });

      expect(host.textContent).toContain('₹49,999');
      expect(host.textContent).not.toContain('Lowest');
      expect(host.textContent).not.toContain('less');
    },
  );

  it('still highlights the cheapest listed product when another price is missing', () => {
    render({
      products: [acer, hp, laptop('third', 'Third laptop', 'Third', 89999)],
      rows: [{ field: 'price', label: 'Price', values: ['74999', '49999', ''], isLive: false }],
    });

    const highlight = Array.from(host.querySelectorAll('span')).find((span) =>
      span.textContent?.includes('Lowest'),
    );
    expect(highlight).toBeDefined();
    expect(highlight?.parentElement?.textContent).toContain('₹49,999');
  });

  it('treats a listed zero price as a valid lowest offer', () => {
    render({
      products: [acer, hp],
      rows: [{ field: 'price', label: 'Price', values: ['0', '49999'], isLive: false }],
    });

    expect(host.textContent).toContain('Lowest · ₹49,999 less');
  });

  it('offers a View button per product for two, and emits when Full table is pressed', () => {
    render({ products: [acer, hp], rows: [] });
    const texts = Array.from(host.querySelectorAll('a, button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(texts).toContain('View Acer');
    expect(texts).toContain('View HP');

    let opened = false;
    fixture.componentInstance.openFull.subscribe(() => (opened = true));
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Full table'))!
      .click();
    expect(opened).toBe(true);
  });
});
