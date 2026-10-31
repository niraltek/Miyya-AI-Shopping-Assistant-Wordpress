import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { CartItemState, StoreCart, StoreCartItem, StoreProduct } from '../../models/cart';
import { CartExecutionResult, CopilotCartActionBlock, CopilotCartLine } from '../../models/copilot';
import { Product } from '../../models/product';
import { apiErrorMessage } from '../../../../shared/utils/api-response';

const folded = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const REQUEST_TIMEOUT_MS = 10000;

@Service()
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly storeApiUrl = (window.AIAssistantConfig?.storeApiUrl ?? '').replace(/\/?$/, '/');
  readonly cartUrl = window.AIAssistantConfig?.cartUrl ?? '';
  readonly checkoutUrl = window.AIAssistantConfig?.checkoutUrl ?? '';
  private readonly commands = new Map<string, Promise<CartExecutionResult>>();
  readonly available = !!window.AIAssistantConfig?.storeApiUrl;
  readonly items = signal<StoreCartItem[]>([]);
  private readonly states = signal<ReadonlyMap<string, CartItemState>>(new Map());
  private readonly errors = signal<ReadonlyMap<string, string>>(new Map());
  private readonly addedIds = new Map<string, number[]>();
  private nonce = '';
  private cartToken = '';
  private queue: Promise<unknown> = Promise.resolve();
  private commandQueue: Promise<unknown> = Promise.resolve();

  stateOf(id: string): CartItemState | null {
    return this.states().get(id) ?? null;
  }

  errorOf(id: string): string {
    return this.errors().get(id) ?? '';
  }

  canAdd(product: Product): boolean {
    return (
      this.available &&
      product.cart !== null &&
      !!product.cartProductId &&
      product.stock.status !== 'outofstock' &&
      (product.cart
        ? ['ready', 'choose_options'].includes(product.cart.status)
        : product.productType !== 'variable')
    );
  }

  async refresh(): Promise<void> {
    const response = await firstValueFrom(
      this.http
        .get<StoreCart>(`${this.storeApiUrl}cart`, {
          observe: 'response',
          withCredentials: true,
          headers: { 'Cache-Control': 'no-cache' },
        })
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );
    this.nonce = response.headers.get('Nonce') ?? '';
    this.cartToken = response.headers.get('Cart-Token') ?? '';
    this.requireCart(response.body);
  }
  /** Transient bearer credential: never persist it or send it to the model. */
  async contextHeaders(): Promise<Record<string, string>> {
    if (!this.available) return {};
    try {
      await this.serial(() => this.refresh());
      return this.cartToken ? { 'X-Woo-Cart-Token': this.cartToken } : {};
    } catch {
      this.cartToken = '';
      return {};
    }
  }

  async add(
    product: Product,
    quantity = 1,
    options: Record<string, string> = {},
    expectedVariationId?: number | null,
  ): Promise<boolean> {
    if (!this.canAdd(product) || this.stateOf(product.productId) === 'adding') return false;
    this.setState(product.productId, 'adding');
    this.errors.update((errors) => new Map(errors).set(product.productId, ''));
    return this.serial(async () => {
      try {
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
          throw new Error('Choose a whole quantity from 1 to 99.');
        let limit = product.cart?.maxQuantity;
        let variation: NonNullable<StoreCartItem['variation']> = [];
        let targetIds = [product.cartProductId!];
        if (product.productType === 'variable' || product.cart?.status === 'choose_options') {
          const hint = product.cart;
          if (
            !hint ||
            !Object.keys(hint.options).length ||
            !Object.keys(hint.options).every((name) => hint.options[name].includes(options[name]))
          ) {
            throw new Error('Choose every product option before adding.');
          }
          const match = hint.variations.find(
            (v) =>
              (!expectedVariationId || v.sourceId === expectedVariationId) &&
              Object.entries(v.options).every(([name, value]) => options[name] === value),
          );
          if (!match) throw new Error('That combination is unavailable. Choose other options.');
          limit = match.maxQuantity;
          targetIds = [match.sourceId];
          const live = await firstValueFrom(
            this.http
              .get<StoreProduct>(`${this.storeApiUrl}products/${product.cartProductId}`, {
                withCredentials: true,
              })
              .pipe(timeout(REQUEST_TIMEOUT_MS)),
          );
          const attributes = (live.attributes ?? []).filter((a) => a.has_variations);
          if (!attributes.length)
            throw new Error('Options have changed. Please open the product page.');
          variation = attributes.map((attribute) => {
            const term = attribute.terms.find(
              (t) => folded(t.name) === folded(options[attribute.name] ?? ''),
            );
            if (!term) throw new Error(`Choose a valid ${attribute.name}.`);
            return {
              attribute: attribute.taxonomy || attribute.name,
              value: attribute.taxonomy ? term.slug : term.name,
            };
          });
        }
        if (limit != null && quantity > limit)
          throw new Error(`Only ${limit} can be added at a time.`);
        await this.refresh();
        const before = this.matching(targetIds, options).reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        await this.write(
          'cart/add-item',
          variation.length
            ? { id: expectedVariationId || product.cartProductId, quantity, variation }
            : { id: product.cartProductId, quantity },
        );
        const after = this.matching(targetIds, options).reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        if (after !== before + quantity)
          throw new Error(
            'The store did not confirm the requested product and quantity. Check your cart before trying again.',
          );
        this.addedIds.set(product.productId, targetIds);
        this.setState(product.productId, 'added');
        return true;
      } catch (error) {
        this.errors.update((errors) => new Map(errors).set(product.productId, this.message(error)));
        this.setState(product.productId, 'failed');
        return false;
      }
    });
  }
  async removeProducts(
    ids: number[],
    options: Record<string, string> = {},
    cartKey?: string | null,
  ): Promise<string> {
    return this.serial(async () => {
      await this.refresh();
      const keys = this.matching(ids, options, cartKey).map((item) => item.key);
      if (keys.length > 1)
        throw new Error('More than one cart line matches. Say which options you want to remove.');
      for (const key of keys) await this.write('cart/remove-item', { key });
      if (this.items().some((item) => keys.includes(item.key)))
        throw new Error('The store did not confirm the removal. Check your cart.');
      return keys.length ? 'Removed from your cart.' : 'Those items are not in your cart.';
    });
  }

  /** Set ONE existing cart line to `quantity` (a new total, never an amount to add).
   * Reads the live cart first, refuses when the line is missing or when several lines fit
   * (asking beats changing the wrong one), and reports success only when the store's reply
   * shows the line at the new quantity. */
  async updateQuantity(
    ids: number[],
    options: Record<string, string>,
    quantity: number,
    name: string,
    cartKey?: string | null,
  ): Promise<string> {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
      throw new Error('Choose a whole quantity from 1 to 99.');
    return this.serial(async () => {
      await this.refresh();
      const lines = this.matching(ids, options, cartKey);
      if (!lines.length) throw new Error(`${name} is not in your cart.`);
      if (lines.length > 1) {
        const kinds = lines.map((item) => this.describe(item)).join('; ');
        throw new Error(`Your cart has more than one ${name} (${kinds}). Say which one to change.`);
      }
      const [line] = lines;
      if (line.quantity === quantity) return `${name} is already at quantity ${quantity}.`;
      await this.write('cart/update-item', { key: line.key, quantity });
      const updated = this.items().find((item) => item.key === line.key);
      if (updated?.quantity !== quantity)
        throw new Error(`The store did not confirm the new quantity for ${name}. Check your cart.`);
      return `${name} quantity is now ${quantity}.`;
    });
  }

  /** Empty the whole cart. Runs only for a command the shopper confirmed, and claims
   * success only after a fresh read of the cart comes back empty. */
  async clear(): Promise<string> {
    return this.serial(async () => {
      await this.refresh();
      if (!this.items().length) return 'Your cart is already empty.';
      await this.write('cart/items', undefined, false, 'DELETE');
      await this.refresh();
      if (this.items().length)
        throw new Error('The store did not empty the cart. Check your cart before trying again.');
      return 'Your cart is now empty.';
    });
  }

  private matching(
    ids: number[],
    options: Record<string, string>,
    cartKey?: string | null,
  ): StoreCartItem[] {
    return this.items().filter(
      (item) =>
        ids.includes(item.id) &&
        (!cartKey || item.key === cartKey) &&
        Object.entries(options).every(([name, value]) =>
          item.variation?.some(
            (choice) =>
              folded(choice.attribute.replace(/^attribute_|^pa_/gi, '')) === folded(name) &&
              folded(choice.value) === folded(value),
          ),
        ),
    );
  }

  private describe(item: StoreCartItem): string {
    const options = (item.variation ?? []).map((choice) => choice.value).join(', ');
    return `${options || item.name} × ${item.quantity}`;
  }
  async remove(key: string): Promise<void> {
    await this.serial(async () => {
      await this.refresh();
      if (this.items().some((item) => item.key === key))
        await this.write('cart/remove-item', { key });
      if (this.items().some((item) => item.key === key))
        throw new Error('The store did not confirm the removal. Check your cart.');
    });
  }

  execute(command: CopilotCartActionBlock): Promise<CartExecutionResult> {
    const existing = this.commands.get(command.commandId);
    if (existing) return existing;
    const storageKey = `ai-cart-command:${command.commandId}`;
    const operation = () => this.claimCommand(command, storageKey);
    const result = navigator.locks?.request
      ? navigator.locks.request(storageKey, operation)
      : operation();
    this.commands.set(command.commandId, result);
    return result;
  }

  private claimCommand(
    command: CopilotCartActionBlock,
    storageKey: string,
  ): Promise<CartExecutionResult> {
    const prior = this.savedResult(command.commandId);
    if (prior) return Promise.resolve(prior);
    const uncertain: CartExecutionResult = {
      ok: false,
      message:
        'This cart command was already started. Check your cart before making another request.',
      items: [],
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(uncertain));
    } catch {}
    const result = this.commandQueue
      .then(() => this.runCommand(command))
      .then((reply) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(reply));
        } catch {}
        return reply;
      });
    this.commandQueue = result.catch(() => undefined);
    return result;
  }

  savedResult(commandId: string): CartExecutionResult | undefined {
    try {
      const value = localStorage.getItem(`ai-cart-command:${commandId}`);
      return value ? (JSON.parse(value) as CartExecutionResult) : undefined;
    } catch {
      return undefined;
    }
  }

  private async runCommand(command: CopilotCartActionBlock): Promise<CartExecutionResult> {
    if (!this.available)
      return { ok: false, message: 'Cart commands are available on the storefront.', items: [] };
    const completed: string[] = [];
    try {
      if (command.action === 'view' || command.action === 'checkout') {
        await this.serial(() => this.refresh());
        return {
          ok: true,
          message: this.items().length ? 'Your current cart.' : 'Your cart is empty.',
          items: [...this.items()],
        };
      }
      if (command.action === 'clear') {
        return { ok: true, message: await this.clear(), items: [...this.items()] };
      }
      for (const line of command.lines) {
        if (command.action === 'remove') {
          completed.push(
            `${line.name}: ${await this.removeProducts(line.cartIds, line.options, line.cartKey)}`,
          );
        } else if (command.action === 'update') {
          completed.push(
            await this.updateQuantity(
              line.cartIds,
              line.options,
              line.quantity,
              line.name,
              line.cartKey,
            ),
          );
        } else {
          const ok = await this.add(
            this.commandProduct(line),
            line.quantity,
            line.options,
            line.variationId,
          );
          if (!ok)
            throw new Error(
              `${line.name}: ${this.errorOf(line.productId) || 'Could not add this item.'}`,
            );
          completed.push(`Added ${line.quantity} × ${line.name}.`);
        }
      }
      return { ok: true, message: completed.join(' '), items: [...this.items()] };
    } catch (error) {
      return {
        ok: false,
        message: [...completed, this.message(error)].join(' '),
        items: [...this.items()],
      };
    }
  }

  private commandProduct(line: CopilotCartLine): Product {
    return {
      productId: line.productId,
      name: line.name,
      brand: '',
      category: '',
      description: '',
      price: {
        current: line.price == null ? null : Number(line.price),
        currency: line.currency ?? '',
        verified: false,
      },
      stock: { status: 'unknown', verified: false },
      imageUrl: '',
      productUrl: line.permalink ?? '',
      attributes: {},
      reason: '',
      match: { score: 0 },
      averageRating: null,
      cartProductId: line.sourceProductId,
      productType: line.productType,
      cart: line.cart,
    };
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    // Every tab changing this storefront's cart shares one lock, including card clicks.
    const locked = () =>
      navigator.locks?.request
        ? navigator.locks.request(`ai-cart:${this.storeApiUrl}`, operation)
        : operation();
    const result = this.queue.then(locked);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async write(
    path: string,
    body: object | undefined,
    retried = false,
    method: 'POST' | 'DELETE' = 'POST',
  ): Promise<void> {
    if (!this.nonce) throw new Error('Could not verify your cart session. Please try again.');
    try {
      const response = await firstValueFrom(
        this.http
          .request<StoreCart>(method, `${this.storeApiUrl}${path}`, {
            body,
            headers: { Nonce: this.nonce },
            observe: 'response',
            withCredentials: true,
          })
          .pipe(timeout(REQUEST_TIMEOUT_MS)),
      );
      this.nonce = response.headers.get('Nonce') ?? this.nonce;
      // DELETE cart/items returns an array; clear() verifies it with GET cart.
      if (method !== 'DELETE') this.requireCart(response.body);
      window.parent.postMessage({ source: 'ai-assistant-widget', cart: 'updated' }, '*');
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.code : '';
      if (
        !retried &&
        ['woocommerce_rest_missing_nonce', 'woocommerce_rest_invalid_nonce'].includes(code)
      ) {
        await this.refresh();
        await this.write(path, body, true, method);
        return;
      }
      if (error instanceof HttpErrorResponse) this.applyCart(error.error?.data?.cart);
      throw error;
    }
  }
  private requireCart(cart: StoreCart | null | undefined): void {
    if (
      !Array.isArray(cart?.items) ||
      cart.items.some(
        (item) =>
          !item ||
          typeof item.key !== 'string' ||
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1,
      )
    )
      throw new Error('The store returned an invalid cart. Check your cart before trying again.');
    this.applyCart(cart);
  }
  private applyCart(cart: StoreCart | null | undefined): void {
    if (Array.isArray(cart?.items)) {
      this.items.set(cart.items);
      this.states.update(
        (states) =>
          new Map(
            [...states].filter(
              ([id, state]) =>
                state !== 'added' ||
                cart.items.some((item) => this.addedIds.get(id)?.includes(item.id)),
            ),
          ),
      );
    }
  }

  message(error: unknown): string {
    return apiErrorMessage(error).replace(/<[^>]*>/g, '');
  }

  private setState(id: string, state: CartItemState): void {
    this.states.update((states) => new Map(states).set(id, state));
  }
}
