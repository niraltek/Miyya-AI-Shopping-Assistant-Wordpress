import { Product, StockStatus, StorePriceFormat } from '../models/product';

/** Missing or invalid store prices must never become a zero-priced offer. */
export function productPrice(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Unknown store values remain unknown, including any future WooCommerce statuses. */
export function productStockStatus(value: string | null | undefined): StockStatus {
  switch (value?.trim().toLowerCase()) {
    case 'instock':
      return 'instock';
    case 'outofstock':
      return 'outofstock';
    case 'onbackorder':
      return 'onbackorder';
    default:
      return 'unknown';
  }
}

export function stockStatusLabel(status: StockStatus): string {
  switch (status) {
    case 'instock':
      return 'In stock';
    case 'outofstock':
      return 'Out of stock';
    case 'onbackorder':
      return 'On backorder';
    default:
      return 'Availability unknown';
  }
}

/** Shared by the product panel and the comparison table so the two never drift apart. */
export function currencyPrefix(currency: string): string {
  if (currency === 'INR') return '₹';
  if (currency === 'USD') return '$';
  if (!currency) return '';
  // A symbol the store rendered itself (₹, $, €, kr) sits against the figure; a code does not.
  return /[a-z]{3}/i.test(currency) && currency.length === 3 ? `${currency} ` : currency;
}

let activePriceFormat: StorePriceFormat | null = null;

/** Set once from the readiness response; every price shown afterwards follows it. */
export function setActivePriceFormat(format: StorePriceFormat | null | undefined): void {
  activePriceFormat = format?.currencyCode ? format : null;
}

/** The symbol a currency CODE is written with, from the platform's own currency data. */
function symbolForCode(code: string): string {
  try {
    const part = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((piece) => piece.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** Same placements and clamping as `format_price` in backend/app/normalizers/money.py. */
function formatWithStoreFormat(amount: number, currency: string, format: StorePriceFormat): string {
  const places = Math.max(0, Math.min(6, Math.trunc(format.decimals ?? 2)));
  // A symbol the store rendered itself wins; a bare code or nothing falls back to the
  // symbol the platform knows for the store's currency.
  const symbol =
    currency && !(currency.length === 3 && /^[a-z]{3}$/i.test(currency))
      ? currency
      : symbolForCode(format.currencyCode ?? currency);
  const decimalSeparator = format.decimalSeparator || '.';
  const thousandSeparator = format.thousandSeparator ?? ',';

  const [whole, fraction] = Math.abs(amount).toFixed(places).split('.');
  let grouped = '';
  let rest = whole;
  while (rest.length > 3) {
    grouped = thousandSeparator + rest.slice(-3) + grouped;
    rest = rest.slice(0, -3);
  }
  const figure = rest + grouped + (fraction ? decimalSeparator + fraction : '');

  const position = format.position ?? 'left';
  const gap = position.endsWith('_space') ? ' ' : '';
  const text = position.startsWith('right')
    ? `${figure}${gap}${symbol}`
    : `${symbol}${gap}${figure}`;
  return amount < 0 ? `-${text}` : text;
}

/**
 * A price as the store would print it: its own symbol, grouped digits, and decimals only
 * when there are any. `null` stays null so the caller can say "Price unavailable".
 *
 * Once the store's price format is known (`setActivePriceFormat`) its currency placement,
 * decimals and separators are used instead of the en-US defaults.
 */
export function formatPrice(amount: number | null | undefined, currency: string): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return null;
  }
  if (activePriceFormat) {
    return formatWithStoreFormat(amount, currency, activePriceFormat);
  }
  const digits = Number.isInteger(amount) ? 0 : 2;
  const figure = amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${currencyPrefix(currency)}${figure}`;
}

/**
 * One comparison cell as the shopper reads it. Prices take that column's store currency and
 * grouping; availability reads as words; everything else is the merchant's own value.
 */
export function comparisonCellText(
  field: string,
  value: string | null,
  product: Product | undefined,
): string | null {
  if (value === null || value === '') {
    return null;
  }
  if (field === 'price' || field === 'regular_price' || field === 'sale_price') {
    const amount = Number(value);
    return Number.isFinite(amount) ? formatPrice(amount, product?.price.currency ?? '') : value;
  }
  if (field === 'stock_status') {
    return stockStatusLabel(productStockStatus(value));
  }
  return value;
}

/** The label a shopper in that currency's market expects beside a struck-through price. */
export function regularPriceLabel(currency: string): string {
  return currency === '₹' || currency === 'INR' ? 'M.R.P.' : 'Was';
}

/** Whole-number percentage off, only for a real discount. */
export function discountPercent(
  current: number | null,
  regular: number | null | undefined,
): number | null {
  if (
    current === null ||
    regular === null ||
    regular === undefined ||
    regular <= current ||
    regular <= 0
  ) {
    return null;
  }
  const percent = Math.round(((regular - current) / regular) * 100);
  return percent > 0 ? percent : null;
}

/** WooCommerce's average customer rating (0-5), or null when the product has no reviews yet. */
export function ratingOf(product: Product): number | null {
  return product.averageRating;
}

/** How many stars a rating row draws. WooCommerce's `average_rating` is out of 5. */
export const RATING_STARS = 5;

/**
 * A rating as a percentage of the star row, for the filled overlay to be clipped to.
 *
 * A width rather than a count of whole stars, because 4.3 is not 4 and rounding it to one
 * is the difference between "just over four" and "exactly four" — a claim about someone
 * else's reviews. Clamped, so a catalog carrying a value outside 0-5 cannot draw a row
 * wider than the one behind it.
 */
export function ratingFillPercent(rating: number | null): number {
  if (rating === null || Number.isNaN(rating)) {
    return 0;
  }
  return Math.min(Math.max(rating, 0), RATING_STARS) * (100 / RATING_STARS);
}
