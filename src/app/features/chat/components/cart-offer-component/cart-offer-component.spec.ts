import { TestBed } from '@angular/core/testing';
import { CartOfferComponent } from './cart-offer-component';
import { CartService } from '../../services/cart-service/cart-service';
import { CopilotCartOfferBlock } from '../../models/copilot';

const offer: CopilotCartOfferBlock = {
  type: 'cart_offer',
  offerId: 'offer-one',
  action: 'add',
  phase: 'confirm',
  lines: [
    {
      productId: 'p-1',
      sourceProductId: 42,
      name: 'Mug',
      options: {},
      quantity: 2,
      price: '12',
      currency: '$',
      cartIds: [],
    },
  ],
};

describe('CartOfferComponent server confirmation', () => {
  const add = vi.fn();
  function setup(phase: CopilotCartOfferBlock['phase'] = 'confirm') {
    TestBed.configureTestingModule({
      providers: [{ provide: CartService, useValue: { available: true, add } }],
    });
    const fixture = TestBed.createComponent(CartOfferComponent);
    fixture.componentRef.setInput('offer', { ...offer, phase });
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('sends the offer identity and confirmation without writing the cart', () => {
    const fixture = setup();
    const emit = vi.fn();
    fixture.componentInstance.answer.subscribe(emit);
    fixture.nativeElement.querySelector('button').click();
    expect(emit).toHaveBeenCalledWith({ offerId: 'offer-one', reply: 'confirm' });
    expect(add).not.toHaveBeenCalled();
  });

  it('blocks historical or in-flight confirmation controls', () => {
    const fixture = setup();
    const emit = vi.fn();
    fixture.componentInstance.answer.subscribe(emit);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(emit).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('requires options before offering confirmation and can cancel server-side', () => {
    const fixture = setup('choose_options');
    const emit = vi.fn();
    fixture.componentInstance.answer.subscribe(emit);
    const button = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('Cancel');
    button.click();
    expect(emit).toHaveBeenCalledWith({ offerId: 'offer-one', reply: 'decline' });
  });

  it('renders remaining catalog options and sends the selected attribute', () => {
    const fixture = setup('choose_options');
    fixture.componentRef.setInput('offer', {
      ...offer,
      phase: 'choose_options',
      lines: [
        {
          ...offer.lines[0],
          options: { Color: 'Blue' },
          cart: {
            status: 'choose_options',
            options: { Color: ['Blue'], Storage: ['128 GB', '256 GB'] },
            variations: [],
          },
        },
      ],
    });
    fixture.detectChanges();
    const emit = vi.fn();
    fixture.componentInstance.selectOption.subscribe(emit);
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      '128 GB',
      '256 GB',
      'Cancel cart request',
    ]);
    buttons[1].click();
    expect(emit).toHaveBeenCalledWith('Storage: 256 GB');
    expect(add).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    buttons[0].click();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('shows a product link when an old offer has no option values', () => {
    const fixture = setup('choose_options');
    fixture.componentRef.setInput('offer', {
      ...offer,
      phase: 'choose_options',
      lines: [{ ...offer.lines[0], permalink: 'https://store.example/product/mug' }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Options are unavailable');
    expect(fixture.nativeElement.querySelector('a').href).toBe('https://store.example/product/mug');
  });

  it('selects an ambiguous product by position even when names are identical', () => {
    const fixture = setup('select_product');
    fixture.componentRef.setInput('offer', {
      ...offer,
      phase: 'select_product',
      lines: [offer.lines[0], { ...offer.lines[0], productId: 'p-2' }],
    });
    fixture.detectChanges();
    const emit = vi.fn();
    fixture.componentInstance.selectOption.subscribe(emit);
    fixture.nativeElement.querySelectorAll('button')[1].click();
    expect(emit).toHaveBeenCalledWith('2');
  });

  it('labels a quantity change with the new total and confirms it server-side', () => {
    const fixture = setup();
    fixture.componentRef.setInput('offer', { ...offer, action: 'update' });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('New quantity: 2');
    expect(text).toContain('Yes, change quantity');
    const emit = vi.fn();
    fixture.componentInstance.answer.subscribe(emit);
    fixture.nativeElement.querySelector('button').click();
    expect(emit).toHaveBeenCalledWith({ offerId: 'offer-one', reply: 'confirm' });
    expect(add).not.toHaveBeenCalled();
  });

  it('spells out that clearing removes every item and writes nothing itself', () => {
    const fixture = setup();
    fixture.componentRef.setInput('offer', { ...offer, action: 'clear', lines: [] });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Every item in your cart will be removed.');
    expect(text).toContain('Yes, empty my cart');
    expect(text).not.toContain('make it two');
    const emit = vi.fn();
    fixture.componentInstance.answer.subscribe(emit);
    fixture.nativeElement.querySelectorAll('button')[1].click();
    expect(emit).toHaveBeenCalledWith({ offerId: 'offer-one', reply: 'decline' });
  });
});
