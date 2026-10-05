import { describe, it, expect } from 'vitest';
import { MoneyUtils } from './money';

describe('MoneyUtils', () => {
  it('creates money successfully for integers', () => {
    const m = MoneyUtils.create(100, 'USD', 2);
    expect(m).toEqual({ amount: 100, currency: 'USD', scale: 2 });
  });

  it('throws when creating money with float amount', () => {
    expect(() => MoneyUtils.create(100.5, 'USD', 2)).toThrow(/must be an integer/);
  });

  it('adds money correctly', () => {
    const a = MoneyUtils.create(100, 'USD', 2);
    const b = MoneyUtils.create(50, 'USD', 2);
    expect(MoneyUtils.add(a, b)).toEqual({ amount: 150, currency: 'USD', scale: 2 });
  });

  it('throws on addition with different currencies', () => {
    const a = MoneyUtils.create(100, 'USD', 2);
    const b = MoneyUtils.create(50, 'EUR', 2);
    expect(() => MoneyUtils.add(a, b)).toThrow(/different currencies/);
  });

  it('subtracts money correctly', () => {
    const a = MoneyUtils.create(100, 'USD', 2);
    const b = MoneyUtils.create(50, 'USD', 2);
    expect(MoneyUtils.subtract(a, b)).toEqual({ amount: 50, currency: 'USD', scale: 2 });
  });

  it('multiplies and rounds money correctly', () => {
    const a = MoneyUtils.create(100, 'USD', 2);
    // 100 * 0.333 = 33.3 -> rounds to 33
    expect(MoneyUtils.multiply(a, 0.333)).toEqual({ amount: 33, currency: 'USD', scale: 2 });
  });

  it('formats money correctly', () => {
    const a = MoneyUtils.create(150, 'USD', 2); // $1.50
    const formatted = MoneyUtils.format(a);
    expect(formatted).toContain('1.50');
  });
});
