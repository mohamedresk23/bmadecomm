export interface Money {
  amount: number; // integer minor units
  currency: string;
  scale: number;
}

export const MoneyUtils = {
  create(amount: number, currency: string, scale: number): Money {
    if (!Number.isInteger(amount)) {
      throw new Error(`Money amount must be an integer, got ${amount}`);
    }
    return { amount, currency, scale };
  },

  add(a: Money, b: Money): Money {
    if (a.currency !== b.currency || a.scale !== b.scale) {
      throw new Error("Cannot add money with different currencies or scales");
    }
    return {
      amount: a.amount + b.amount,
      currency: a.currency,
      scale: a.scale,
    };
  },

  subtract(a: Money, b: Money): Money {
    if (a.currency !== b.currency || a.scale !== b.scale) {
      throw new Error("Cannot subtract money with different currencies or scales");
    }
    return {
      amount: a.amount - b.amount,
      currency: a.currency,
      scale: a.scale,
    };
  },

  multiply(a: Money, factor: number): Money {
    return {
      amount: Math.round(a.amount * factor),
      currency: a.currency,
      scale: a.scale,
    };
  },

  format(money: Money): string {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: money.currency,
    });
    return formatter.format(money.amount / Math.pow(10, money.scale));
  }
};
