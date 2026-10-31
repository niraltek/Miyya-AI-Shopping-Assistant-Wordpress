import { Component, computed, input, output, signal } from '@angular/core';
import { LucideChevronDown, LucideChevronRight, LucideImage } from '@lucide/angular';
import { ChatCategoryTile } from '../../models/chat';
import { formatPrice } from '../../utils/product-display';

@Component({
  selector: 'app-inline-category-grid-component',
  imports: [LucideChevronDown, LucideChevronRight, LucideImage],
  templateUrl: './inline-category-grid-component.html',
  styleUrl: './inline-category-grid-component.scss',
})
export class InlineCategoryGridComponent {
  readonly categories = input.required<ChatCategoryTile[]>();
  readonly disabled = input(false);
  readonly select = output<ChatCategoryTile>();
  static readonly COLLAPSED_COUNT = 6;
  protected readonly expanded = signal(false);
  protected readonly visible = computed(() =>
    this.expanded()
      ? this.categories()
      : this.categories().slice(0, InlineCategoryGridComponent.COLLAPSED_COUNT),
  );
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.categories().length - InlineCategoryGridComponent.COLLAPSED_COUNT),
  );
  protected readonly failedImages = signal<ReadonlySet<number>>(new Set());

  protected onImageError(id: number): void {
    this.failedImages.update((ids) => new Set(ids).add(id));
  }

  protected summary(tile: ChatCategoryTile): string {
    const count = `${tile.productCount} ${tile.productCount === 1 ? 'item' : 'items'}`;
    const from = formatPrice(tile.priceFrom, tile.currency);
    return from ? `${count} · from ${from}` : count;
  }
}
