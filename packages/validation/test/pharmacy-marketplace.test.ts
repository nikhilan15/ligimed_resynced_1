import { describe, expect, it } from 'vitest';

import {
  dealerCatalogueListingInputSchema,
  dealerCatalogueListingUpdateSchema,
  pharmacyCatalogueQuerySchema,
  pharmacyDealerCatalogueSchema,
  pharmacyMarketplaceQuerySchema,
  pharmacyMarketplaceSchema,
} from '../src/index.js';

describe('pharmacy marketplace contracts', () => {
  it('normalizes bounded marketplace queries and rejects tenant selectors', () => {
    expect(pharmacyMarketplaceQuerySchema.parse({ q: '  dealer  ', limit: '12' })).toEqual({
      q: 'dealer',
      limit: 12,
    });
    expect(() =>
      pharmacyMarketplaceQuerySchema.parse({ organizationId: crypto.randomUUID() }),
    ).toThrow();
  });

  it('requires verified dealers and a live catalogue link', () => {
    const result = pharmacyMarketplaceSchema.parse({
      dealers: [
        {
          id: crypto.randomUUID(),
          name: 'Health Distributor',
          verificationStatus: 'VERIFIED',
          summary: null,
          location: { city: 'Bengaluru', state: 'Karnataka' },
          serviceAreas: ['Bengaluru Urban'],
          catalogue: { available: true },
        },
      ],
      page: { nextCursor: null, hasMore: false },
    });
    expect(result.dealers[0]?.verificationStatus).toBe('VERIFIED');
  });

  it('bounds catalogue queries and rejects tenant selectors', () => {
    expect(
      pharmacyCatalogueQuerySchema.parse({
        q: '  tablet  ',
        category: '  Analgesics ',
        dosageForm: ' Tablet ',
        limit: '20',
      }),
    ).toEqual({ q: 'tablet', category: 'Analgesics', dosageForm: 'Tablet', limit: 20 });
    expect(() =>
      pharmacyCatalogueQuerySchema.parse({ organizationId: crypto.randomUUID() }),
    ).toThrow();
    expect(
      pharmacyDealerCatalogueSchema.parse({
        dealer: {
          id: crypto.randomUUID(),
          name: 'Verified dealer',
          verificationStatus: 'VERIFIED',
          summary: null,
          location: { city: 'Bengaluru', state: 'Karnataka' },
          serviceAreas: [],
        },
        products: [],
        filters: { categories: [], manufacturers: [], dosageForms: [] },
        page: { nextCursor: null, hasMore: false },
      }).products,
    ).toEqual([]);
  });

  it('validates dealer catalogue publication and commercial updates', () => {
    expect(
      dealerCatalogueListingInputSchema.parse({
        name: 'Paracetamol tablets',
        genericName: 'Paracetamol',
        strength: '500 mg',
        dosageForm: 'Tablet',
        packSize: '10 tablets',
        manufacturerName: 'Example Manufacturer',
        categoryName: 'Analgesics',
        description: '',
        sku: 'PCM-500-10',
        unitPriceMinor: '1250',
        minimumQuantity: 2,
      }),
    ).toMatchObject({ currency: 'INR', isAvailable: true, unitPriceMinor: '1250' });
    expect(() =>
      dealerCatalogueListingInputSchema.parse({ name: 'Unsafe price', unitPriceMinor: '12.50' }),
    ).toThrow();
    expect(() => dealerCatalogueListingUpdateSchema.parse({ isAvailable: false })).toThrow();
  });
});
