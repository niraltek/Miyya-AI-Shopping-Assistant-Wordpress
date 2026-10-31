import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Product } from '../../models/product';
import { InlineProductListComponent } from './inline-product-list-component';

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    productId: id,
    name: `Product ${id}`,
    brand: '',
    category: '',
    description: '',
    price: { current: 1000, currency: '', verified: true },
    stock: { status: 'instock', verified: true },
    imageUrl: '',
    productUrl: `https://store.example/${id}`,
    attributes: {},
    reason: '',
    match: { score: 0 },
    averageRating: null,
    regularPrice: null,
    ...overrides,
  };
}

describe('InlineProductListComponent', () => {
  let fixture: ComponentFixture<InlineProductListComponent>;
  let host: HTMLElement;

  function render(products: Product[], selected: string[] = []): void {
    fixture.componentRef.setInput('products', products);
    fixture.componentRef.setInput('selectedProductIds', new Set(selected));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InlineProductListComponent] });
    fixture = TestBed.createComponent(InlineProductListComponent);
    host = fixture.nativeElement;
  });

  it('shows three cards until the shopper asks for the rest', () => {
    render(['a', 'b', 'c', 'd', 'e'].map((id) => product(id)));
    expect(host.querySelectorAll('li').length).toBe(3);

    const toggle = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Show all 5 products'),
    )!;
    toggle.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('li').length).toBe(5);
  });

  it('reports which product a shopper opened', () => {
    const opened: string[] = [];
    fixture.componentInstance.productOpened.subscribe((p) => opened.push(p.productId));
    render([product('a'), product('b')]);

    const links = host.querySelectorAll<HTMLAnchorElement>('li a[href]');
    // Stop the browser (jsdom) from navigating; only the emitted event matters here.
    links.forEach((link) => link.addEventListener('click', (event) => event.preventDefault()));
    links[0].click();
    expect(opened).toEqual(['a']);
  });

  it('renders the composer rationale under its card', () => {
    render([product('a', { reason: 'Breathable mesh upper, rated 4.4.' })]);
    expect(host.textContent).toContain('Breathable mesh upper, rated 4.4.');
  });

  it('strikes through the regular price only for a real discount', () => {
    render([
      product('sale', {
        price: { current: 3916, currency: '₹', verified: true },
        regularPrice: 4895,
      }),
      product('equal', {
        price: { current: 2000, currency: '₹', verified: true },
        regularPrice: 2000,
      }),
    ]);
    const struck = host.querySelectorAll('s');
    expect(struck.length).toBe(1);
    expect(struck[0].textContent).toBe('₹4,895');
    expect(host.textContent).toContain('−20%');
    expect(host.textContent).toContain('M.R.P.');
    // The store's own symbol sits against the figure.
    expect(host.textContent).toContain('₹3,916');
  });

  it('says "No reviews yet" rather than drawing an empty star row', () => {
    render([product('a', { averageRating: null }), product('b', { averageRating: 4.4 })]);
    const cards = host.querySelectorAll('li');
    expect(cards[0].textContent).toContain('No reviews yet');
    expect(cards[1].textContent).not.toContain('No reviews yet');
    expect(cards[1].querySelector('[aria-label="Rated 4.4 out of 5"]')).not.toBeNull();
  });

  it('marks a price that was not live-verified', () => {
    render([product('a', { price: { current: 10, currency: '', verified: false } })]);
    expect(host.textContent).toContain('price not confirmed');
  });

  it('emits the product when Compare is pressed', () => {
    const target = product('a');
    render([target]);
    let emitted: Product | null = null;
    fixture.componentInstance.toggleSelect.subscribe((p) => (emitted = p));

    const compare = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Compare'),
    )!;
    compare.click();
    expect(emitted).toBe(target);
  });
});
