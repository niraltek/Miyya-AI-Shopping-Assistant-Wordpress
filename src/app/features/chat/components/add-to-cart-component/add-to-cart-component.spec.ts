import { TestBed } from '@angular/core/testing';
import { AddToCartComponent } from './add-to-cart-component';
import { CartService } from '../../services/cart-service/cart-service';
import { Product } from '../../models/product';

const item: Product = {
  productId: 'shirt',
  name: 'Shirt',
  brand: '',
  category: '',
  description: '',
  price: { current: 10, currency: '$', verified: false },
  stock: { status: 'instock', verified: false },
  imageUrl: '',
  productUrl: '/shirt',
  attributes: {},
  reason: '',
  match: { score: 0 },
  averageRating: null,
  cartProductId: 42,
  productType: 'variable',
  cart: {
    status: 'choose_options',
    options: { Color: ['Blue', 'Red'], Size: ['M', 'L'] },
    variations: [
      { sourceId: 43, options: { Color: 'Blue', Size: 'M' }, maxQuantity: 2 },
      { sourceId: 44, options: { Color: 'Red', Size: 'L' }, maxQuantity: 5 },
    ],
  },
};

describe('AddToCartComponent options and confirmation', () => {
  const add = vi.fn();
  function setup(options: Record<string, string> = {}) {
    add.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CartService,
          useValue: {
            canAdd: () => true,
            stateOf: () => null,
            errorOf: () => '',
            cartUrl: '/cart',
            add,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AddToCartComponent);
    fixture.componentRef.setInput('product', item);
    fixture.componentRef.setInput('confirm', true);
    fixture.componentRef.setInput('initialOptions', options);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('requires all options and filters incompatible combinations', () => {
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('button')!.disabled).toBe(true);
    const color = root.querySelector('select')!;
    color.value = 'Blue';
    color.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const size = root.querySelectorAll('select')[1];
    expect([...size.options].map((option) => option.value)).toEqual(['', 'M']);
    size.value = 'M';
    size.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(root.querySelector('button')!.disabled).toBe(false);
    expect(root.querySelector('input')!.max).toBe('2');
    expect(add).not.toHaveBeenCalled();
  });

  it('adds only on confirmation and prevents a second confirmation', async () => {
    const fixture = setup({ Color: 'Blue', Size: 'M' });
    const root: HTMLElement = fixture.nativeElement;
    expect(add).not.toHaveBeenCalled();
    root.querySelector('button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(item, 1, { Color: 'Blue', Size: 'M' });
    expect(root.querySelector('button')!.disabled).toBe(true);
    root.querySelector('button')!.click();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('disables historical offers', () => {
    const fixture = setup({ Color: 'Blue', Size: 'M' });
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(add).not.toHaveBeenCalled();
  });

  it('caps an offered quantity at the selected variation limit', async () => {
    const fixture = setup({ Color: 'Blue', Size: 'M' });
    fixture.componentRef.setInput('initialQuantity', 5);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').value).toBe('2');
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    expect(add).toHaveBeenCalledWith(item, 2, { Color: 'Blue', Size: 'M' });
  });
});
