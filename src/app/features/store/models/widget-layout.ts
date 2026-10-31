/**
 * How the storefront assistant is presented, and nothing else.
 *
 * Two families, each with a left and a right side (always offered left first):
 *
 * - **Floating** — a chat bubble in a bottom corner that opens a window over the website.
 *   `classic` is the original, bottom-right (its value is kept so every saved setting and
 *   the wp-admin chat keep meaning what they always did); `floating-left` is its
 *   bottom-left twin.
 * - **Docked** — `left` and `right` dock the assistant as a full-height column on that
 *   edge of the live website, and the page narrows to make room for it.
 *
 * Products, comparisons and every copilot behaviour are identical in all four. The format
 * only applies on the storefront; the chat inside wp-admin is always the classic panel.
 */
export type WidgetLayoutFormat = 'classic' | 'floating-left' | 'left' | 'right';

export const DEFAULT_WIDGET_LAYOUT: WidgetLayoutFormat = 'classic';

const WIDGET_LAYOUT_FORMATS: readonly WidgetLayoutFormat[] = [
  'classic',
  'floating-left',
  'left',
  'right',
];

export function isWidgetLayoutFormat(value: unknown): value is WidgetLayoutFormat {
  return WIDGET_LAYOUT_FORMATS.includes(value as WidgetLayoutFormat);
}

export type WidgetLayoutKind = 'floating' | 'docked';
export type WidgetLayoutSide = 'left' | 'right';

export interface WidgetLayoutSettingsResponse {
  layout?: unknown;
}

export interface WidgetLayoutOption {
  readonly format: WidgetLayoutFormat;
  readonly kind: WidgetLayoutKind;
  readonly side: WidgetLayoutSide;
  readonly label: string;
  readonly description: string;
}

export interface WidgetLayoutGroup {
  readonly kind: WidgetLayoutKind;
  readonly title: string;
  readonly description: string;
  readonly options: readonly WidgetLayoutOption[];
}

export const WIDGET_LAYOUT_GROUPS: readonly WidgetLayoutGroup[] = [
  {
    kind: 'floating',
    title: 'Floating',
    description: 'A chat bubble in a corner that opens over your website.',
    options: [
      {
        format: 'floating-left',
        kind: 'floating',
        side: 'left',
        label: 'Floating left',
        description: 'Floats over the page in the bottom-left corner.',
      },
      {
        format: 'classic',
        kind: 'floating',
        side: 'right',
        label: 'Floating right',
        description: 'Floats over the page in the bottom-right corner.',
      },
    ],
  },
  {
    kind: 'docked',
    title: 'Docked',
    description: 'The assistant takes a full-height side and your page narrows to make room.',
    options: [
      {
        format: 'left',
        kind: 'docked',
        side: 'left',
        label: 'Docked left',
        description: 'Takes the full left side of your site.',
      },
      {
        format: 'right',
        kind: 'docked',
        side: 'right',
        label: 'Docked right',
        description: 'Takes the full right side of your site.',
      },
    ],
  },
];
