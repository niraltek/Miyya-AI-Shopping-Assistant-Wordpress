import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CartService } from './cart-service';
import { Product } from '../../models/product';
import { CopilotCartActionBlock } from '../../models/copilot';

const STORE_API = 'https://shop.example/wp-json/wc/store/v1/';

function product(overrides: Partial<Product> = {}): Product {
  return {
    productId: 'p-1',
    name: 'Mug',
    brand: '',
    category: '',
    description: '',
    price: { current: 12, currency: '$', verified: true },
    stock: { status: 'instock', verified: true },
    imageUrl: '',
    productUrl: 'https://shop.example/mug',
    attributes: {},
    reason: '',
    match: { score: 0 },
    averageRating: null,
    cartProductId: 42,
    ...overrides,
  };
}

/** Lets each awaited request inside `add()` reach the testing backend before the next. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('CartService', () => {
  let http: HttpTestingController;

  function setup(storeApiUrl: string = STORE_API): CartService {
    window.AIAssistantConfig = {
      route: '/widget',
      storeApiUrl,
      cartUrl: 'https://shop.example/cart',
    };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(CartService);
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { AIAssistantConfig?: unknown }).AIAssistantConfig;
    TestBed.resetTestingModule();
  });

  it('adds with a nonce read at click time and tells the host page', async () => {
    const service = setup();
    const post = vi.spyOn(window.parent, 'postMessage');

    const done = service.add(product());
    expect(service.stateOf('p-1')).toBe('adding');
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'n-1' } });
    await settle();
    const add = http.expectOne(`${STORE_API}cart/add-item`);
    expect(add.request.method).toBe('POST');
    expect(add.request.headers.get('Nonce')).toBe('n-1');
    expect(add.request.withCredentials).toBe(true);
    expect(add.request.body).toEqual({ id: 42, quantity: 1 });
    add.flush({ items: [{ key: 'mug', id: 42, quantity: 1, name: 'Mug' }] });
    await done;

    expect(service.stateOf('p-1')).toBe('added');
    expect(post).toHaveBeenCalledWith({ source: 'ai-assistant-widget', cart: 'updated' }, '*');
  });

  it('marks the product failed when the store refuses', async () => {
    const service = setup();

    const done = service.add(product());
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'n-1' } });
    await settle();
    http
      .expectOne(`${STORE_API}cart/add-item`)
      .flush({ code: 'woocommerce_rest_product_out_of_stock' }, { status: 400, statusText: 'Bad' });
    await done;

    expect(service.stateOf('p-1')).toBe('failed');
  });

  it('offers add for an in-stock simple product on the storefront', () => {
    expect(setup().canAdd(product())).toBe(true);
  });

  it('offers no add for a product that needs an option chosen first', () => {
    expect(setup().canAdd(product({ cartProductId: null }))).toBe(false);
  });

  it('offers no add for a product known to be sold out', () => {
    expect(setup().canAdd(product({ stock: { status: 'outofstock', verified: true } }))).toBe(
      false,
    );
  });

  it('offers no add outside the storefront, where no Store API URL is configured', () => {
    expect(setup('').canAdd(product())).toBe(false);
  });

  it('sends the chosen global slug and exact custom value, with the requested quantity', async () => {
    const service = setup();
    const variable = product({
      productType: 'variable',
      cart: {
        status: 'choose_options',
        options: { Color: ['Blue'], Size: ['XL'] },
        variations: [{ sourceId: 43, options: { Color: 'Blue', Size: 'XL' }, maxQuantity: 3 }],
      },
    });
    const done = service.add(variable, 2, { Color: 'Blue', Size: 'XL' });
    await settle();
    http.expectOne(`${STORE_API}products/42`).flush({
      attributes: [
        {
          name: 'Color',
          taxonomy: 'pa_color',
          has_variations: true,
          terms: [{ name: 'Blue', slug: 'blue' }],
        },
        { name: 'Size', taxonomy: null, has_variations: true, terms: [{ name: 'XL', slug: 'XL' }] },
      ],
    });
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'n-1' } });
    await settle();
    const request = http.expectOne(`${STORE_API}cart/add-item`);
    expect(request.request.body).toEqual({
      id: 42,
      quantity: 2,
      variation: [
        { attribute: 'pa_color', value: 'blue' },
        { attribute: 'Size', value: 'XL' },
      ],
    });
    request.flush({ items: [{ id: 43, key: 'line', quantity: 2, name: 'Mug',
      variation: [{ attribute: 'Color', value: 'Blue' }, { attribute: 'Size', value: 'XL' }] }] });
    expect(await done).toBe(true);
    expect(service.items()[0].quantity).toBe(2);
  });

  it('does not write with missing options or an invalid quantity', async () => {
    const service = setup();
    expect(await service.add(product(), 1.5)).toBe(false);
    expect(service.errorOf('p-1')).toContain('whole quantity');
    expect(
      await service.add(
        product({
          productType: 'variable',
          cart: {
            status: 'choose_options',
            options: { Size: ['M'] },
            variations: [{ sourceId: 43, options: { Size: 'M' } }],
          },
        }),
      ),
    ).toBe(false);
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('retries only a nonce refusal and uses the refreshed nonce', async () => {
    const service = setup();
    const done = service.add(product());
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'expired' } });
    await settle();
    http
      .expectOne(`${STORE_API}cart/add-item`)
      .flush({ code: 'woocommerce_rest_invalid_nonce' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'fresh' } });
    await settle();
    const retry = http.expectOne(`${STORE_API}cart/add-item`);
    expect(retry.request.headers.get('Nonce')).toBe('fresh');
    retry.flush({ items: [{ key: 'mug', id: 42, quantity: 1, name: 'Mug' }] });
    expect(await done).toBe(true);
  });

  it('serializes different cards and suppresses duplicate clicks on the same card', async () => {
    const service = setup();
    const first = service.add(product());
    expect(await service.add(product())).toBe(false);
    const second = service.add(product({ productId: 'p-2', cartProductId: 45 }));
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/add-item`).flush({ items: [
      { key: 'mug', id: 42, quantity: 1, name: 'Mug' },
    ] }, { headers: { Nonce: 'two' } });
    await first;
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'three' } });
    await settle();
    const next = http.expectOne(`${STORE_API}cart/add-item`);
    expect(next.request.body.id).toBe(45);
    next.flush({ items: [{ key: 'cup', id: 45, quantity: 1, name: 'Cup' }] });
    expect(await second).toBe(true);
  });

  it('removes by keys from a fresh cart and preserves unrelated products', async () => {
    const service = setup();
    const done = service.removeProducts([42]);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush(
      {
        items: [
          { key: 'wanted', id: 42, quantity: 1, name: 'Mug' },
          { key: 'keep', id: 45, quantity: 1, name: 'Cup' },
        ],
      },
      { headers: { Nonce: 'one' } },
    );
    await settle();
    const remove = http.expectOne(`${STORE_API}cart/remove-item`);
    expect(remove.request.body).toEqual({ key: 'wanted' });
    remove.flush({ items: [{ key: 'keep', id: 45, quantity: 1, name: 'Cup' }] });
    expect(await done).toBe('Removed from your cart.');
    expect(service.items().map((item) => item.id)).toEqual([45]);
  });

  it('surfaces the store refusal as plain text without claiming success', async () => {
    const service = setup();
    const done = service.add(product());
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    http
      .expectOne(`${STORE_API}cart/add-item`)
      .flush({ message: '<b>Only 1 left.</b>' }, { status: 400, statusText: 'Bad' });
    expect(await done).toBe(false);
    expect(service.errorOf('p-1')).toBe('Only 1 left.');
    http.expectNone(`${STORE_API}cart/add-item`);
  });
  function command(overrides: Partial<CopilotCartActionBlock> = {}): CopilotCartActionBlock {
    return {
      type: 'cart_action',
      commandId: 'command-one',
      action: 'add',
      lines: [
        {
          productId: 'p-1',
          sourceProductId: 42,
          name: 'Mug',
          productType: 'simple',
          quantity: 2,
          options: {},
          cartIds: [],
          cart: { status: 'ready', maxQuantity: 5, options: {}, variations: [] },
        },
      ],
      ...overrides,
    };
  }

  it('executes a confirmed command once even when the completed turn is received twice', async () => {
    localStorage.clear();
    const service = setup();
    const first = service.execute(command());
    expect(service.execute(command())).toBe(first);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    const add = http.expectOne(`${STORE_API}cart/add-item`);
    expect(add.request.body).toEqual({ id: 42, quantity: 2 });
    add.flush({ items: [{ key: 'mug', id: 42, quantity: 2, name: 'Mug' }] });
    expect((await first).message).toContain('Added 2');
    await service.execute(command());
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('does not replay a command started before a page reload', async () => {
    localStorage.clear();
    localStorage.setItem(
      'ai-cart-command:command-one',
      JSON.stringify({ ok: false, message: 'Check your cart first.', items: [] }),
    );
    const service = setup();
    expect((await service.execute(command())).message).toBe('Check your cart first.');
    http.expectNone(`${STORE_API}cart`);
  });

  it('reads the live cart for a view command without performing any mutation', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(command({ action: 'view', lines: [] }));
    await settle();
    http
      .expectOne(`${STORE_API}cart`)
      .flush(
        { items: [{ key: 'mug', id: 42, name: 'Mug', quantity: 3 }] },
        { headers: { Nonce: 'one' } },
      );
    const reply = await done;
    expect(reply.ok).toBe(true);
    expect(reply.items[0].quantity).toBe(3);
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('keeps successful lines visible when a later command line fails', async () => {
    localStorage.clear();
    const service = setup();
    const request = command();
    request.lines.push({ ...request.lines[0], productId: 'p-2', sourceProductId: 45, name: 'Cup' });
    const done = service.execute(request);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    http
      .expectOne(`${STORE_API}cart/add-item`)
      .flush({ items: [{ key: 'mug', id: 42, name: 'Mug', quantity: 2 }] });
    await settle();
    http
      .expectOne(`${STORE_API}cart`)
      .flush(
        { items: [{ key: 'mug', id: 42, name: 'Mug', quantity: 2 }] },
        { headers: { Nonce: 'two' } },
      );
    await settle();
    http
      .expectOne(`${STORE_API}cart/add-item`)
      .flush({ message: 'Sold out' }, { status: 400, statusText: 'Bad' });
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toContain('Added 2');
    expect(reply.message).toContain('Sold out');
    expect(reply.items[0].id).toBe(42);
  });
  it('adds the exact server-confirmed variation instead of resolving another variation', async () => {
    localStorage.clear();
    const service = setup();
    const request = command();
    request.lines = [
      {
        ...request.lines[0],
        productType: 'variable',
        variationId: 43,
        options: { Size: 'M' },
        cart: {
          status: 'ready',
          options: { Size: ['M', 'L'] },
          variations: [
            { sourceId: 43, options: { Size: 'M' }, maxQuantity: 5 },
            { sourceId: 44, options: { Size: 'L' }, maxQuantity: 5 },
          ],
        },
      },
    ];
    const done = service.execute(request);
    await settle();
    http.expectOne(`${STORE_API}products/42`).flush({
      attributes: [
        {
          name: 'Size',
          taxonomy: null,
          has_variations: true,
          terms: [
            { name: 'M', slug: 'M' },
            { name: 'L', slug: 'L' },
          ],
        },
      ],
    });
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    const add = http.expectOne(`${STORE_API}cart/add-item`);
    expect(add.request.body).toEqual({
      id: 43,
      quantity: 2,
      variation: [{ attribute: 'Size', value: 'M' }],
    });
    add.flush({ items: [{ key: 'medium', id: 43, name: 'Mug', quantity: 2,
      variation: [{ attribute: 'Size', value: 'M' }] }] });
    expect((await done).ok).toBe(true);
  });

  // SYNTHETIC store responses below; nothing reaches a real WooCommerce store.
  const shirtLine = (overrides: Partial<CopilotCartActionBlock['lines'][0]> = {}) => ({
    productId: 'p-shirt',
    sourceProductId: 70,
    name: 'Shirt',
    productType: 'variable',
    quantity: 2,
    options: {},
    cartIds: [70, 71, 72],
    ...overrides,
  });
  const blueLine = { key: 'blue', id: 71, name: 'Shirt', quantity: 1,
    variation: [{ attribute: 'Color', value: 'Blue' }] };
  const redLine = { key: 'red', id: 72, name: 'Shirt', quantity: 1,
    variation: [{ attribute: 'Color', value: 'Red' }] };

  it('sets the quantity of the one matching line with update-item, never add-item', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(
      command({ commandId: 'update-one', action: 'update',
        lines: [shirtLine({ options: { Color: 'Blue' }, cartIds: [71] })] }),
    );
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine, redLine] },
      { headers: { Nonce: 'one' } });
    await settle();
    const update = http.expectOne(`${STORE_API}cart/update-item`);
    expect(update.request.method).toBe('POST');
    expect(update.request.headers.get('Nonce')).toBe('one');
    expect(update.request.body).toEqual({ key: 'blue', quantity: 2 });
    update.flush({ items: [{ ...blueLine, quantity: 2 }, redLine] });
    const reply = await done;
    expect(reply.ok).toBe(true);
    expect(reply.message).toBe('Shirt quantity is now 2.');
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('asks which line instead of changing one when several fit', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(
      command({ commandId: 'update-two', action: 'update', lines: [shirtLine()] }),
    );
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine, redLine] },
      { headers: { Nonce: 'one' } });
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toContain('more than one Shirt');
    expect(reply.message).toContain('Blue');
    expect(reply.message).toContain('Red');
    http.expectNone(`${STORE_API}cart/update-item`);
  });

  it('reports a line that is not in the cart without writing anything', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(
      command({ commandId: 'update-none', action: 'update', lines: [shirtLine({ cartIds: [99] })] }),
    );
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toBe('Shirt is not in your cart.');
    http.expectNone(`${STORE_API}cart/update-item`);
  });

  it('does not claim an update the store reply does not show', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(
      command({ commandId: 'update-unconfirmed', action: 'update',
        lines: [shirtLine({ options: { Color: 'Blue' }, cartIds: [71], quantity: 5 })] }),
    );
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    await settle();
    // The store answered 200 but kept the old quantity (for example a stock limit applied).
    http.expectOne(`${STORE_API}cart/update-item`).flush({ items: [blueLine] });
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toContain('did not confirm the new quantity');
  });

  it('surfaces a stock refusal on update as the store worded it', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(
      command({ commandId: 'update-refused', action: 'update',
        lines: [shirtLine({ options: { Color: 'Blue' }, cartIds: [71], quantity: 9 })] }),
    );
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/update-item`).flush(
      { code: 'woocommerce_rest_cart_invalid_quantity', message: 'Only <b>4</b> in stock.',
        data: { cart: { items: [blueLine] } } },
      { status: 400, statusText: 'Bad' },
    );
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toBe('Only 4 in stock.');
    expect(service.items()[0].quantity).toBe(1);
  });

  it('empties the cart with DELETE cart/items and confirms it with a fresh read', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(command({ commandId: 'clear-one', action: 'clear', lines: [] }));
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine, redLine] },
      { headers: { Nonce: 'one' } });
    await settle();
    const clear = http.expectOne(`${STORE_API}cart/items`);
    expect(clear.request.method).toBe('DELETE');
    expect(clear.request.headers.get('Nonce')).toBe('one');
    clear.flush([]);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'two' } });
    const reply = await done;
    expect(reply.ok).toBe(true);
    expect(reply.message).toBe('Your cart is now empty.');
    expect(reply.items).toEqual([]);
  });

  it('does not claim the cart is empty when the fresh read still shows items', async () => {
    localStorage.clear();
    const service = setup();
    const done = service.execute(command({ commandId: 'clear-two', action: 'clear', lines: [] }));
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/items`).flush([]);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'two' } });
    const reply = await done;
    expect(reply.ok).toBe(false);
    expect(reply.message).toContain('did not empty the cart');
  });

  it('runs a confirmed clear only once, even when the turn is delivered twice', async () => {
    localStorage.clear();
    const service = setup();
    const request = command({ commandId: 'clear-three', action: 'clear', lines: [] });
    const first = service.execute(request);
    expect(service.execute(request)).toBe(first);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    expect((await first).message).toBe('Your cart is already empty.');
    await service.execute(request);
    http.expectNone(`${STORE_API}cart/items`);
  });

  it.each([
    {}, { items: [] }, { items: [{ key: 'wrong', id: 99, quantity: 1, name: 'Other' }] },
    { items: [{ key: 'mug', id: 42, quantity: 3, name: 'Mug' }] },
  ])('does not claim an add that the store did not confirm: %j', async (body) => {
    const service = setup();
    const done = service.add(product());
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/add-item`).flush(body);
    expect(await done).toBe(false);
    expect(service.stateOf('p-1')).toBe('failed');
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('verifies the added amount against the previous total, not just product presence', async () => {
    const service = setup();
    const done = service.add(product(), 2);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [
      { key: 'mug', id: 42, quantity: 3, name: 'Mug' },
    ] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/add-item`).flush({ items: [
      { key: 'mug', id: 42, quantity: 5, name: 'Mug' },
    ] });
    expect(await done).toBe(true);
  });

  it('does not claim a removal if the store keeps the line', async () => {
    const service = setup();
    const done = service.removeProducts([71], { Color: 'Blue' });
    const checked = expect(done).rejects.toThrow('did not confirm the removal');
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectOne(`${STORE_API}cart/remove-item`).flush({ items: [blueLine] });
    await checked;
  });

  it('asks which variation to remove when several cart lines fit', async () => {
    const service = setup();
    const done = service.removeProducts([71, 72]);
    const checked = expect(done).rejects.toThrow('More than one cart line');
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine, redLine] },
      { headers: { Nonce: 'one' } });
    await checked;
    http.expectNone(`${STORE_API}cart/remove-item`);
  });

  it('refuses a stale line key even if another cart line has the same variation ID', async () => {
    const service = setup();
    const done = service.updateQuantity([71], {}, 2, 'Shirt', 'expired-key');
    const checked = expect(done).rejects.toThrow('not in your cart');
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [blueLine] }, { headers: { Nonce: 'one' } });
    await checked;
    http.expectNone(`${STORE_API}cart/update-item`);
  });

  it('forwards only a fresh cart bearer header without persisting it', async () => {
    const service = setup();
    const done = service.contextHeaders();
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] },
      { headers: { Nonce: 'one', 'Cart-Token': 'private-cart-token' } });
    expect(await done).toEqual({ 'X-Woo-Cart-Token': 'private-cart-token' });
    expect(JSON.stringify(localStorage)).not.toContain('private-cart-token');
    const changedSession = service.contextHeaders();
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'two' } });
    expect(await changedSession).toEqual({});
  });

  it('times out an uncertain write without retrying the add', async () => {
    vi.useFakeTimers();
    const service = setup();
    const done = service.add(product());
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await vi.advanceTimersByTimeAsync(0);
    const write = http.expectOne(`${STORE_API}cart/add-item`);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await done).toBe(false);
    expect(write.cancelled).toBe(true);
    http.expectNone(`${STORE_API}cart/add-item`);
  });

  it('serializes different operations from separate tabs using the same cart lock', async () => {
    const queues = new Map<string, Promise<unknown>>();
    const request = vi.fn((name: string, operation: () => Promise<unknown>) => {
      const next = (queues.get(name) ?? Promise.resolve()).then(operation);
      queues.set(name, next.catch(() => undefined));
      return next;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const firstTab = setup();
    const secondTab = TestBed.runInInjectionContext(() => new CartService());
    const first = firstTab.add(product());
    const second = secondTab.add(product({ productId: 'p-2', cartProductId: 45 }));
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [] }, { headers: { Nonce: 'one' } });
    await settle();
    http.expectNone(`${STORE_API}cart`);
    http.expectOne(`${STORE_API}cart/add-item`).flush({ items: [
      { key: 'mug', id: 42, quantity: 1, name: 'Mug' },
    ] });
    expect(await first).toBe(true);
    await settle();
    http.expectOne(`${STORE_API}cart`).flush({ items: [
      { key: 'mug', id: 42, quantity: 1, name: 'Mug' },
    ] }, { headers: { Nonce: 'two' } });
    await settle();
    http.expectOne(`${STORE_API}cart/add-item`).flush({ items: [
      { key: 'mug', id: 42, quantity: 1, name: 'Mug' },
      { key: 'cup', id: 45, quantity: 1, name: 'Cup' },
    ] });
    expect(await second).toBe(true);
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      `ai-cart:${STORE_API}`, `ai-cart:${STORE_API}`,
    ]);
  });
});
