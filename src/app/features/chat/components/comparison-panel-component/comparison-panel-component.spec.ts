import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComparisonTable, Product } from '../../models/product';
import { ComparisonPanelComponent } from './comparison-panel-component';

/**
 * The panel renders the backend's comparison matrix and derives nothing of its own.
 *
 * It used to take a `Product[]` and lay out five fixed rows — price, brand, category,
 * rating, stock. Two of those (brand, category) are not carried on a copilot product card
 * at all, so they rendered permanently blank; and a fixed row list cannot show what a
 * merchant actually sells on, so a store comparing watches never saw movement or strap
 * material. These specs pin the shape that replaced it: a header row of product images,
 * one row per field the backend chose, and a cell per product in that field's order.
 */
describe('ComparisonPanelComponent', () => {
  let fixture: ComponentFixture<ComparisonPanelComponent>;
  let compiled: HTMLElement;

  function product(id: string, name: string): Product {
    return {
      productId: id,
      name,
      brand: '',
      category: '',
      description: '',
      price: { current: 2499, currency: 'INR', verified: true },
      stock: { status: 'instock', verified: true },
      imageUrl: `https://shop/${id}.png`,
      productUrl: `https://shop/product/${id}`,
      attributes: {},
      reason: '',
      match: { score: 0 },
      averageRating: null,
    };
  }

  const table: ComparisonTable = {
    products: [product('a', 'Noise Smart Watch'), product('b', 'Daniel Klein Exclusive')],
    rows: [
      { field: 'price', label: 'Price', values: ['2499', '5749'], isLive: true },
      { field: 'brand', label: 'Brand', values: ['Noise', 'Daniel Klein'], isLive: false },
      // The merchant's own attribute, which is the entire reason the rows come from the
      // backend — and one product does not list it.
      {
        field: 'strap material',
        label: 'Strap Material',
        values: ['Silicone', null],
        isLive: false,
      },
    ],
  };

  async function render(value: ComparisonTable | null): Promise<void> {
    fixture.componentRef.setInput('table', value);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonPanelComponent);
    compiled = fixture.nativeElement as HTMLElement;
  });

  it('shows one image column per compared product', async () => {
    await render(table);

    const images = [...compiled.querySelectorAll('img')];

    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'https://shop/a.png',
      'https://shop/b.png',
    ]);
    expect(compiled.textContent).toContain('Noise Smart Watch');
    expect(compiled.textContent).toContain('Daniel Klein Exclusive');
    // The header states how many products the table holds. The count sits in its own
    // badge beside the title and Angular strips the markup whitespace between them,
    // so allow the two text nodes to run together.
    expect(compiled.textContent).toMatch(/Comparison\s*2/);
  });

  it("renders the backend's rows, including a merchant attribute no fixed list would have", async () => {
    await render(table);

    expect(compiled.textContent).toContain('Price');
    expect(compiled.textContent).toContain('Brand');
    // The one that matters: a store's own axis, which the old fixed five-row layout could
    // not have shown whatever the merchant sold.
    expect(compiled.textContent).toContain('Strap Material');
    expect(compiled.textContent).toContain('Silicone');
  });

  it('says "Not listed" where the store listed nothing, never a blank cell', async () => {
    await render(table);

    // A blank cell and a zero both read as an answer. "No strap material listed" and "no
    // strap" are different claims about the product.
    expect(compiled.textContent).toContain('Not listed');
  });

  it('marks a row that was confirmed against the live store', async () => {
    await render(table);

    // Price was verified this turn; brand came from the synced catalog. A shopper deciding
    // on price is entitled to know which of the two they are reading.
    expect(compiled.textContent).toContain('Live');
    expect(compiled.querySelectorAll('[title="Checked with the store just now"]')).toHaveLength(1);
  });

  it('qualifies unverified price and availability without labelling catalog attributes as live facts', async () => {
    await render({
      products: table.products,
      rows: [
        { field: 'price', label: 'Price', values: ['19.99', null], isLive: false },
        {
          field: 'stock_status',
          label: 'Availability',
          values: ['instock', 'onbackorder'],
          isLive: false,
        },
        { field: 'brand', label: 'Brand', values: ['Noise', 'Daniel Klein'], isLive: false },
      ],
    });

    expect(compiled.textContent?.match(/Not live verified/g)).toHaveLength(2);
    expect(compiled.textContent).toContain('On backorder');
    expect(compiled.textContent).toContain('In stock');
    expect(compiled.textContent).not.toContain('onbackorder');
    expect(compiled.textContent).toContain('Not listed');
    expect(compiled.querySelectorAll('[title="Checked with the store just now"]')).toHaveLength(0);
  });

  it('shows no links and no stock codes', async () => {
    await render(table);

    // The panel is a decision aid read side by side. A link invites the shopper out of
    // the comparison they just asked for, and the results rail already offers the way
    // through to the storefront.
    expect(compiled.querySelectorAll('a')).toHaveLength(0);
    expect(compiled.textContent).not.toContain('https://');
    // SKU is a merchant's internal stock code, not a reason to pick one product over
    // another, and it cost a row of a table whose whole job is helping someone decide.
    // Dropped at the source, in ProductComparisonService.BASE_FIELDS.
    expect(compiled.textContent).not.toContain('SKU');
  });

  it('sizes each product column to its own content and never scrolls sideways', async () => {
    await render(table);

    const grid = compiled.querySelector('[style*="grid-template-columns"]') as HTMLElement;
    const scrollAncestor = grid.parentElement as HTMLElement;

    // `1fr` is what guarantees every column still adds up to exactly the panel's width —
    // no scrollbar, ever — while `min-content` is what lets a longer name or value claim
    // more of that width than a shorter one, rather than every column getting the same
    // fixed share regardless of what's in it. The room to grow into comes from the panel
    // itself (chat-component.scss sizes the comparison drawer wider than the
    // product-results one), not from this component.
    expect(grid.style.gridTemplateColumns).toContain('minmax(min-content, 1fr)');
    expect(grid.classList.contains('w-full')).toBe(true);
    expect(scrollAncestor.classList.contains('overflow-x-hidden')).toBe(true);
  });

  it('applies the same content-based sizing whatever the product count', async () => {
    // There is no separate "crush it to fit" branch past a handful of products — the
    // formula is identical, and the drawer's own width is what a shopper actually sees
    // change as more products are compared.
    const many = Array.from({ length: 8 }, (_, index) => product(`p${index}`, `Product ${index}`));
    await render({
      products: many,
      rows: [{ field: 'price', label: 'Price', values: many.map(() => '1'), isLive: false }],
    });

    const grid = compiled.querySelector('[style*="grid-template-columns"]') as HTMLElement;

    expect(grid.style.gridTemplateColumns).toContain('minmax(min-content, 1fr)');
    expect(grid.style.gridTemplateColumns).toContain('repeat(8,');
  });

  it('says so plainly when there is nothing the products can be compared on', async () => {
    // Columns but no rows is a real answer. Deriving stand-in rows from the cards here is
    // what produced the permanently blank brand and category rows before.
    await render({ products: [product('a', 'Noise Smart Watch')], rows: [] });

    expect(compiled.textContent).toContain("hasn't listed any details");
  });

  it('renders nothing at all without a table', async () => {
    await render(null);

    expect(compiled.querySelectorAll('img')).toHaveLength(0);
    expect(compiled.textContent).toMatch(/Comparison\s*0/);
  });
});
