import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCheck, LucideShoppingCart } from '@lucide/angular';
import { Product } from '../../models/product';
import { CartService } from '../../services/cart-service/cart-service';
import { formatPrice, productPrice } from '../../utils/product-display';

@Component({
  selector: 'app-add-to-cart-component',
  imports: [FormsModule, LucideCheck, LucideShoppingCart],
  templateUrl: './add-to-cart-component.html',
  styleUrl: './add-to-cart-component.scss',
})
export class AddToCartComponent {
  readonly product = input.required<Product>();
  readonly variant = input<'inline' | 'block'>('inline');
  readonly confirm = input(false);
  readonly disabled = input(false);
  readonly initialOptions = input<Record<string, string>>({});
  readonly initialQuantity = input(1);
  readonly added = output<void>();
  protected readonly cart = inject(CartService);
  protected readonly picked = linkedSignal(() => ({ ...this.initialOptions() }));
  protected readonly quantity = linkedSignal(() => this.initialQuantity());
  protected readonly expanded = signal(false);
  protected readonly completed = signal(false);
  protected readonly state = computed(() => this.cart.stateOf(this.product().productId));
  protected readonly busy = computed(() => this.state() === 'adding' || this.disabled());
  protected readonly needsOptions = computed(
    () => this.product().cart?.status === 'choose_options',
  );
  protected readonly dimensions = computed(() => Object.keys(this.product().cart?.options ?? {}));
  protected readonly maximum = computed(() => {
    const hint = this.product().cart;
    const matches = hint?.variations.filter((v) => this.matches(v.options, this.picked())) ?? [];
    const limit =
      this.needsOptions() && matches.length === 1 ? matches[0].maxQuantity : hint?.maxQuantity;
    return Math.min(99, limit ?? 99);
  });
  protected readonly valid = computed(
    () =>
      Number.isInteger(this.quantity()) &&
      this.quantity() >= 1 &&
      this.quantity() <= this.maximum() &&
      (!this.needsOptions() ||
        (this.dimensions().length > 0 &&
          this.dimensions().every((name) =>
            this.product().cart!.options[name].includes(this.picked()[name]),
          ) &&
          !!this.product().cart?.variations.some((v) => this.matches(v.options, this.picked())))),
  );
  protected readonly selectedPrice = computed(() => {
    if (!this.needsOptions() || !this.dimensions().every((name) => !!this.picked()[name]))
      return null;
    const variation = this.product().cart?.variations.find((v) =>
      this.matches(v.options, this.picked()),
    );
    return formatPrice(productPrice(variation?.price), this.product().price.currency);
  });
  protected readonly buttonLabel = computed(() =>
    this.confirm() ? 'Yes, add to cart' : this.state() === 'failed' ? 'Try again' : 'Add to cart',
  );
  protected readonly layoutClass = computed(() =>
    this.variant() === 'block'
      ? 'mt-1 w-full bg-accent-700 px-3 py-2 text-xs text-white hover:bg-accent-800'
      : 'bg-accent-700 px-2.5 py-1.5 text-xs text-white hover:bg-accent-800',
  );

  constructor() {
    effect(() => {
      if (this.quantity() > this.maximum()) this.quantity.set(this.maximum());
    });
  }

  private matches(fixed: Record<string, string>, picked: Record<string, string>): boolean {
    return Object.entries(picked).every(
      ([name, value]) => !value || !fixed[name] || fixed[name] === value,
    );
  }

  protected valuesFor(name: string): string[] {
    const hint = this.product().cart;
    const other = { ...this.picked() };
    delete other[name];
    const matches = hint?.variations.filter((v) => this.matches(v.options, other)) ?? [];
    return (hint?.options[name] ?? []).filter((value) =>
      matches.some((v) => !v.options[name] || v.options[name] === value),
    );
  }

  protected choose(name: string, value: string): void {
    this.picked.update((picked) => ({ ...picked, [name]: value }));
    this.quantity.set(Math.min(this.quantity(), this.maximum()));
  }

  protected async add(): Promise<void> {
    if (this.busy() || !this.valid() || (this.confirm() && this.completed())) return;
    if (await this.cart.add(this.product(), this.quantity(), this.picked())) {
      this.completed.set(true);
      this.added.emit();
    }
  }
}
