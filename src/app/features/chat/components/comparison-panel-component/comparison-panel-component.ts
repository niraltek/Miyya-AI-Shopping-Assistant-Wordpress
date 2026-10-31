import { Component, computed, input } from '@angular/core';
import { LucideScale } from '@lucide/angular';
import { ComparisonTable } from '../../models/product';
import { comparisonCellText } from '../../utils/product-display';

@Component({
  selector: 'app-comparison-panel-component',
  imports: [LucideScale],
  templateUrl: './comparison-panel-component.html',
  styleUrl: './comparison-panel-component.scss',
})
export class ComparisonPanelComponent {
  readonly table = input<ComparisonTable | null>(null);
  protected readonly products = computed(() => this.table()?.products ?? []);
  protected readonly rows = computed(() => this.table()?.rows ?? []);
  protected readonly count = computed(() => this.products().length);

  protected displayValue(field: string, value: string, column: number): string {
    return comparisonCellText(field, value, this.products()[column]) ?? value;
  }
  protected readonly gridColumns = computed(
    () => `minmax(min-content, auto) repeat(${this.count()}, minmax(min-content, 1fr))`,
  );
  protected readonly notListed = 'Not listed';
}
