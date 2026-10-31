import { Component, computed, input, output } from '@angular/core';
import { LucideImage, LucideTable2 } from '@lucide/angular';
import {
  ComparisonRow,
  ComparisonTable,
  InlineCell,
  InlineRow,
  Product,
} from '../../models/product';
import { comparisonCellText, productPrice } from '../../utils/product-display';

@Component({
  selector: 'app-inline-comparison-component',
  imports: [LucideImage, LucideTable2],
  templateUrl: './inline-comparison-component.html',
  styleUrl: './inline-comparison-component.scss',
})
export class InlineComparisonComponent {
  readonly table = input.required<ComparisonTable>();
  readonly openFull = output<void>();
  protected readonly products = computed(() => this.table().products);
  protected readonly rows = computed<InlineRow[]>(() => {
    const products = this.products();
    return this.table()
      .rows.filter((row) => row.values.some((value) => value !== null && value !== ''))
      .map((row) => this.toRow(row, products));
  });
  protected readonly gridTemplate = computed(
    () =>
      `4.75rem repeat(${this.products().length}, minmax(${this.products().length > 2 ? '6.5rem' : '0'}, 1fr))`,
  );
  protected readonly showViewButtons = computed(() => this.products().length <= 2);

  protected isLinkable(product: Product): boolean {
    return !!product.productUrl && product.productUrl !== '#';
  }

  protected shortName(product: Product): string {
    return product.brand || product.name.split(' ')[0];
  }

  private toRow(row: ComparisonRow, products: Product[]): InlineRow {
    const cells: InlineCell[] = row.values.map((value, index) => ({
      text: comparisonCellText(row.field, value, products[index]),
      lowest: false,
      saving: null,
    }));
    if (row.field === 'price') {
      const amounts = row.values.map((value) => productPrice(value) ?? NaN);
      const known = amounts.filter((amount) => Number.isFinite(amount));
      if (known.length >= 2 && new Set(known).size > 1) {
        const lowest = Math.min(...known);
        const lowestIndex = amounts.indexOf(lowest);
        cells[lowestIndex].lowest = true;
        if (known.length === 2) {
          const highest = Math.max(...known);
          cells[lowestIndex].saving = comparisonCellText(
            'price',
            String(highest - lowest),
            products[lowestIndex],
          );
        }
      }
    }
    return { field: row.field, label: row.label, isLive: row.isLive, cells };
  }
}
