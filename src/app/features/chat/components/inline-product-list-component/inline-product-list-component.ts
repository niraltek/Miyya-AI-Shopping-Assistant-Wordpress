import { Component, computed, input, output, signal } from '@angular/core';
import {
  LucideArrowUpRight,
  LucideCheck,
  LucideImage,
  LucideSparkles,
  LucideStar,
} from '@lucide/angular';
import { MAX_COMPARE_PRODUCTS, Product } from '../../models/product';
import {
  RATING_STARS,
  discountPercent,
  formatPrice,
  ratingFillPercent,
  ratingOf,
  regularPriceLabel,
  stockStatusLabel,
} from '../../utils/product-display';
import { AddToCartComponent } from '../add-to-cart-component/add-to-cart-component';

@Component({
  selector: 'app-inline-product-list-component',
  imports: [
    AddToCartComponent,
    LucideArrowUpRight,
    LucideCheck,
    LucideImage,
    LucideSparkles,
    LucideStar,
  ],
  templateUrl: './inline-product-list-component.html',
  styleUrl: './inline-product-list-component.scss',
})
export class InlineProductListComponent {
  readonly products = input.required<Product[]>();
  readonly selectedProductIds = input<ReadonlySet<string>>(new Set());
  readonly toggleSelect = output<Product>();
  readonly productOpened = output<Product>();
  readonly productAdded = output<Product>();
  static readonly COLLAPSED_COUNT = 3;
  protected readonly expanded = signal(false);
  protected readonly visible = computed(() =>
    this.expanded()
      ? this.products()
      : this.products().slice(0, InlineProductListComponent.COLLAPSED_COUNT),
  );
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.products().length - InlineProductListComponent.COLLAPSED_COUNT),
  );
  protected readonly isAtLimit = computed(
    () => this.selectedProductIds().size >= MAX_COMPARE_PRODUCTS,
  );
  protected readonly failedImages = signal<ReadonlySet<string>>(new Set());

  protected onImageError(productId: string): void {
    this.failedImages.update((ids) => new Set(ids).add(productId));
  }

  protected isSelected(productId: string): boolean {
    return this.selectedProductIds().has(productId);
  }

  protected isLinkable(product: Product): boolean {
    return !!product.productUrl && product.productUrl !== '#';
  }

  protected price(product: Product): string | null {
    return formatPrice(product.price.current, product.price.currency);
  }

  protected regularPrice(product: Product): string | null {
    return this.discount(product) === null
      ? null
      : formatPrice(product.regularPrice, product.price.currency);
  }

  protected discount(product: Product): number | null {
    return discountPercent(product.price.current, product.regularPrice);
  }
  protected readonly regularPriceLabel = regularPriceLabel;
  protected readonly stockStatusLabel = stockStatusLabel;
  protected readonly ratingOf = ratingOf;
  protected readonly ratingFillPercent = ratingFillPercent;
  protected readonly stars = Array.from({ length: RATING_STARS }, (_, index) => index);
}
