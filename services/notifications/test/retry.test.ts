import { describe, expect, it } from 'vitest';
import { retryDelayMilliseconds } from '../src/index.js';

describe('notification retry policy', () => {
  it('uses capped exponential backoff', () => {
    expect(retryDelayMilliseconds(1)).toBe(1_000);
    expect(retryDelayMilliseconds(20)).toBe(900_000);
  });
});
