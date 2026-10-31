import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatCategoryTile } from '../../models/chat';
import { InlineCategoryGridComponent } from './inline-category-grid-component';

function tile(
  id: number,
  name: string,
  overrides: Partial<ChatCategoryTile> = {},
): ChatCategoryTile {
  return {
    id,
    name,
    productCount: 10,
    priceFrom: 799,
    currency: '₹',
    imageUrl: '',
    subcategories: [],
    message: `Show me ${name}`,
    ...overrides,
  };
}

describe('InlineCategoryGridComponent', () => {
  let fixture: ComponentFixture<InlineCategoryGridComponent>;
  let host: HTMLElement;

  const names = [
    'Laptops',
    'Shirts & Jeans',
    'Smartphones',
    'T-Shirts & Activewear',
    'Beauty & Personal Care',
    'Kids & Toys',
    'Athletic Footwear',
    'Gaming Accessories',
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InlineCategoryGridComponent] });
    fixture = TestBed.createComponent(InlineCategoryGridComponent);
    host = fixture.nativeElement;
    fixture.componentRef.setInput(
      'categories',
      names.map((name, i) => tile(i + 1, name)),
    );
    fixture.detectChanges();
  });

  it('shows six tiles, then all of them on "Show all"', () => {
    expect(host.querySelectorAll('.aa-category-tile').length).toBe(6);

    const more = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Show all 8 categories'),
    )!;
    more.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.aa-category-tile').length).toBe(8);
  });

  it('prints the count and the starting price in the store currency', () => {
    expect(host.querySelector('.aa-category-tile')!.textContent).toContain('10 items · from ₹799');
  });

  it('emits the tapped tile', () => {
    let chosen: ChatCategoryTile | null = null;
    fixture.componentInstance.select.subscribe((t) => (chosen = t));
    host.querySelectorAll<HTMLButtonElement>('.aa-category-tile')[2].click();
    expect(chosen!.message).toBe('Show me Smartphones');
  });
});
