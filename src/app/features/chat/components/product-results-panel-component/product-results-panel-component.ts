import { Component, computed, input, output, signal } from '@angular/core';
import { LucideCheck, LucideImage, LucidePackage, LucideStar } from '@lucide/angular';
import { MAX_COMPARE_PRODUCTS, MIN_COMPARE_PRODUCTS, Product } from '../../models/product';
import {
  RATING_STARS,
  currencyPrefix,
  formatPrice,
  ratingFillPercent,
  ratingOf,
  stockStatusLabel,
} from '../../utils/product-display';
import { AddToCartComponent } from '../add-to-cart-component/add-to-cart-component';

export const PRODUCT_DRAG_MIME_TYPE = 'application/x-commerce-copilot-product';

@Component({
  selector: 'app-product-results-panel-component',
  imports: [AddToCartComponent, LucideCheck, LucideImage, LucidePackage, LucideStar],
  styleUrl: './product-results-panel-component.scss',
  templateUrl: './product-results-panel-component.html',
})
export class ProductResultsPanelComponent {
  readonly products = input<Product[] | null>(null);
  readonly selectedProductIds = input<ReadonlySet<string>>(new Set());
  readonly toggleSelect = output<Product>();
  readonly dragProduct = output<Product>();
  readonly clearSelection = output<void>();
  protected readonly count = computed(() => this.products()?.length ?? 0);
  protected readonly maxCompare = MAX_COMPARE_PRODUCTS;
  protected readonly isAtLimit = computed(
    () => this.selectedProductIds().size >= MAX_COMPARE_PRODUCTS,
  );
  protected readonly compareSlots = Array.from(
    { length: MAX_COMPARE_PRODUCTS },
    (_, index) => index,
  );
  protected readonly selectionHint = computed(() => {
    const selected = this.selectedProductIds().size;
    if (selected === 0) {
      return `Select up to ${MAX_COMPARE_PRODUCTS} to compare`;
    }
    if (selected < MIN_COMPARE_PRODUCTS) {
      const needed = MIN_COMPARE_PRODUCTS - selected;
      return `Pick ${needed} more to compare`;
    }
    if (selected >= MAX_COMPARE_PRODUCTS) {
      return `Limit reached (${selected} of ${MAX_COMPARE_PRODUCTS})`;
    }
    return 'Ready to compare';
  });
  protected readonly failedProductImages = signal<ReadonlySet<string>>(new Set());
  protected readonly draggingProductId = signal<string | null>(null);

  protected onProductImageError(productId: string): void {
    this.failedProductImages.update((ids) => new Set(ids).add(productId));
  }

  protected isSelected(productId: string): boolean {
    return this.selectedProductIds().has(productId);
  }

  protected onToggleSelect(event: Event, product: Product): void {
    event.stopPropagation();
    this.toggleSelect.emit(product);
  }

  protected onDragStart(event: DragEvent, product: Product): void {
    this.draggingProductId.set(product.productId);
    event.dataTransfer?.setData(PRODUCT_DRAG_MIME_TYPE, JSON.stringify(product));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
    this.dragProduct.emit(product);
  }

  protected onDragEnd(): void {
    this.draggingProductId.set(null);
  }

  protected isProductLinkable(product: Product): boolean {
    return !!product.productUrl && product.productUrl !== '#';
  }
  protected readonly productCurrencyPrefix = currencyPrefix;

  protected productPriceText(product: Product): string {
    return formatPrice(product.price.current, product.price.currency) ?? '';
  }
  protected readonly stockStatusLabel = stockStatusLabel;
  protected readonly ratingOf = ratingOf;
  protected readonly stars = Array.from({ length: RATING_STARS }, (_, index) => index);
  protected readonly ratingFillPercent = ratingFillPercent;
}
