import { Component, computed, inject, input, output } from '@angular/core';
import { CartOfferOption } from '../../models/cart';
import { CartCommand, CopilotCartOfferBlock, CopilotCartLine } from '../../models/copilot';
import { CartService } from '../../services/cart-service/cart-service';
import { formatPrice, productPrice } from '../../utils/product-display';

@Component({
  selector: 'app-cart-offer-component',
  templateUrl: './cart-offer-component.html',
  styleUrl: './cart-offer-component.scss',
})
export class CartOfferComponent {
  readonly offer = input.required<CopilotCartOfferBlock>();
  readonly disabled = input(false);
  readonly answer = output<CartCommand>();
  readonly selectOption = output<string>();
  protected readonly cart = inject(CartService);

  protected respond(reply: 'confirm' | 'decline'): void {
    if (!this.disabled() && this.offer().offerId)
      this.answer.emit({ offerId: this.offer().offerId, reply });
  }

  protected choose(message: string): void {
    if (!this.disabled()) this.selectOption.emit(message);
  }
  protected readonly nextOption = computed<CartOfferOption | null>(() => {
    const line = this.offer().lines.find((item) => item.cart?.status === 'choose_options');
    if (!line?.cart) return null;
    const next = Object.entries(line.cart.options).find(
      ([name, values]) => !(name in line.options) && values.length > 0,
    );
    return next ? { name: next[0], values: next[1], product: line.name } : null;
  });

  protected confirmLabel(): string {
    return {
      add: 'add to cart',
      remove: 'remove from cart',
      update: 'change quantity',
      clear: 'empty my cart',
    }[this.offer().action];
  }
  protected description(line: CopilotCartLine): string {
    const options = Object.entries(line.options)
      .map(([name, value]) => `${name}: ${value}`)
      .join(', ');
    const price = formatPrice(productPrice(line.price), line.currency ?? '');
    const action = this.offer().action;
    return [
      options,
      action === 'add'
        ? `Quantity: ${line.quantity}`
        : action === 'update'
          ? `New quantity: ${line.quantity}`
          : options
            ? ''
            : 'All cart lines for this product',
      price && action === 'add' ? `${price} each` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
}
