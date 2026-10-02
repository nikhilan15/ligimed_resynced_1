import { describe, expect, it } from 'vitest';

import {
  commerceOrderQuerySchema,
  dealerOrderStatusInputSchema,
  pharmacyCartItemInputSchema,
  pharmacyCheckoutSchema,
} from '../src/index.js';

describe('commerce validation', () => {
  it('requires positive bounded cart quantities', () => {
    expect(pharmacyCartItemInputSchema.parse({ quantity: 2 })).toEqual({ quantity: 2 });
    expect(() => pharmacyCartItemInputSchema.parse({ quantity: 0 })).toThrow();
    expect(() => pharmacyCartItemInputSchema.parse({ quantity: 1.5 })).toThrow();
  });

  it('normalizes order filters and rejects tenant selectors', () => {
    expect(commerceOrderQuerySchema.parse({ status: 'PENDING', limit: '20' })).toEqual({
      status: 'PENDING',
      limit: 20,
    });
    expect(() => commerceOrderQuerySchema.parse({ organizationId: crypto.randomUUID() })).toThrow();
  });

  it('accepts only known status values and bounded notes', () => {
    expect(
      dealerOrderStatusInputSchema.parse({ status: 'CONFIRMED', note: ' Stock reserved ' }),
    ).toEqual({ status: 'CONFIRMED', note: 'Stock reserved' });
    expect(() => dealerOrderStatusInputSchema.parse({ status: 'PAID', note: '' })).toThrow();
  });

  it('requires an explicit supported payment method at checkout', () => {
    expect(pharmacyCheckoutSchema.parse({ paymentMethod: 'BANK_TRANSFER' })).toEqual({
      paymentMethod: 'BANK_TRANSFER',
    });
    expect(() => pharmacyCheckoutSchema.parse({})).toThrow();
    expect(() => pharmacyCheckoutSchema.parse({ paymentMethod: 'RAZORPAY' })).toThrow();
  });
});
