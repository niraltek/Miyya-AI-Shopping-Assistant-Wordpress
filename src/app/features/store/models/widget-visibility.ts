/**
 * Who sees the assistant on the public website.
 *
 * `admins` is the preview mode: WordPress renders the widget only for a logged-in user
 * who can manage the plugin, so a merchant can try it on the real storefront before
 * shoppers see it. The decision is made in PHP on every page view — this app only
 * reads and saves it.
 */
export type WidgetVisibilityMode = 'everyone' | 'admins' | 'hidden';

export interface WidgetVisibilitySettingsResponse {
  mode?: unknown;
  enabled?: boolean;
}

export const DEFAULT_WIDGET_VISIBILITY: WidgetVisibilityMode = 'everyone';

export function isWidgetVisibilityMode(value: unknown): value is WidgetVisibilityMode {
  return value === 'everyone' || value === 'admins' || value === 'hidden';
}

export interface WidgetVisibilityOption {
  readonly mode: WidgetVisibilityMode;
  readonly label: string;
  readonly description: string;
}

export const WIDGET_VISIBILITY_OPTIONS: readonly WidgetVisibilityOption[] = [
  {
    mode: 'everyone',
    label: 'Everyone',
    description: 'All visitors can open Miyya from any page.',
  },
  {
    mode: 'admins',
    label: 'Admins only',
    description: 'Only logged-in store admins see it. Visitors do not.',
  },
  {
    mode: 'hidden',
    label: 'Hidden',
    description: 'Miyya does not appear on the website.',
  },
];
