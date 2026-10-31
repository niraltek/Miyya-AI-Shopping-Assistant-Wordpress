import { Component, input } from '@angular/core';
import { LucideCheck, LucideLayers, LucideShieldCheck } from '@lucide/angular';
import { CATALOG_SYNC_TRUST_POINTS, CatalogScopeItem } from '../../models/catalog';

@Component({
  imports: [LucideCheck, LucideLayers, LucideShieldCheck],
  selector: 'app-catalog-sync-scope-component',
  templateUrl: './catalog-sync-scope-component.html',
  styleUrl: './catalog-sync-scope-component.scss',
})
export class CatalogSyncScopeComponent {
  readonly showTrustPoints = input(false);
  protected readonly includes: readonly CatalogScopeItem[] = [
    { title: 'Products & variations', detail: 'All product details and variant information' },
    { title: 'Categories', detail: 'Product categories and subcategories' },
    { title: 'Prices & stock status', detail: 'Current pricing and inventory levels' },
    { title: 'Product images', detail: 'Import product images from your store' },
    { title: 'Automatic updates', detail: 'Keep your catalog in sync automatically' },
  ];
  protected readonly trustPoints = CATALOG_SYNC_TRUST_POINTS;
}
