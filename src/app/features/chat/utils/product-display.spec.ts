import { afterEach, describe, expect, it } from 'vitest';
import { formatPrice, setActivePriceFormat } from './product-display';

describe('formatPrice with the store price format', () => {
  afterEach(() => setActivePriceFormat(null));

  it('keeps the original en-US behaviour until the store reports a format', () => {
    expect(formatPrice(1234.5, '$')).toBe('$1,234.50');
    expect(formatPrice(1299, '$')).toBe('$1,299');
  });

  it.each([
    ['left', '$1,234.50'],
    ['right', '1,234.50$'],
    ['left_space', '$ 1,234.50'],
    ['right_space', '1,234.50 $'],
  ])('places the currency %s', (position, expected) => {
    setActivePriceFormat({ currencyCode: 'USD', position, decimals: 2 });
    expect(formatPrice(1234.5, '$')).toBe(expected);
  });

  it("uses the store's own separators and decimals", () => {
    setActivePriceFormat({
      currencyCode: 'EUR',
      position: 'right_space',
      decimals: 2,
      decimalSeparator: ',',
      thousandSeparator: '.',
    });
    expect(formatPrice(1234567.891, '€')).toBe('1.234.567,89 €');
  });

  it('honours zero decimals and no grouping', () => {
    setActivePriceFormat({ currencyCode: 'JPY', decimals: 0, thousandSeparator: '' });
    expect(formatPrice(1234567, '¥')).toBe('¥1234567');
  });

  it('writes a whole-number price with the configured decimals, like the store does', () => {
    setActivePriceFormat({ currencyCode: 'USD', position: 'left', decimals: 2 });
    expect(formatPrice(1299, '$')).toBe('$1,299.00');
  });

  it('derives the symbol from the currency code when the payload gave only a code', () => {
    setActivePriceFormat({ currencyCode: 'USD', position: 'left', decimals: 2 });
    expect(formatPrice(5, 'USD')).toBe('$5.00');
  });

  it('never fuses digits when the decimal separator is blank', () => {
    setActivePriceFormat({ currencyCode: 'USD', decimals: 2, decimalSeparator: '' });
    expect(formatPrice(1.5, '$')).toBe('$1.50');
  });

  it('stays null for a missing or invalid amount', () => {
    setActivePriceFormat({ currencyCode: 'USD' });
    expect(formatPrice(null, '$')).toBeNull();
    expect(formatPrice(Number.NaN, '$')).toBeNull();
  });

  it('treats a format with no currency code as no format at all', () => {
    setActivePriceFormat({ position: 'right' });
    expect(formatPrice(5, '$')).toBe('$5');
  });
});
