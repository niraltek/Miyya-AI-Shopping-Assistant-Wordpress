/**
 * View models for `LayoutComponent`'s admin shell — the side/top navigation and the
 * sliding active-item indicator. UI-only: nothing here comes from the backend.
 */

import { LucideIconData } from '@lucide/angular';

export interface NavItem {
  path: string;
  label: string;
  /** The Lucide icon's data, kept as data so the template stays declarative. */
  icon: LucideIconData;
}

/** Pixel geometry of the sliding indicator under the active nav item. */
export interface NavIndicator {
  left: number;
  width: number;
}

export interface WordPressPageRoute {
  path: string;
  page: string;
}
