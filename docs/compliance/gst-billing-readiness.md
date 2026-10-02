# GST billing readiness (India)

Research checked on 2026-10-02 against the [CBIC tax-invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html) and the [GST portal's GSTR-1 guidance](https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm). This is an engineering checklist, **not** tax or legal approval. Notifications, seller circumstances, and product classifications must be confirmed by a qualified Indian GST adviser before LigiMed enables statutory issuance.

## Required invoice data and rules to implement

- Supplier legal name, address, and GSTIN. The software must verify the pharmacy's actual GST registration and tax scheme before permitting any GST tax invoice. A composition taxpayer or supplier of exempt supplies may need a bill of supply instead.
- A consecutive serial number in one or more series, unique for each financial year, at most 16 characters, using letters, digits, `-`, and `/`. Allocate it transactionally at issuance, never from the existing random `LM-SALE-*` internal reference. The GST portal confirms multiple series are allowed but duplicate series/numbers within a financial year are not.
- Issue date; recipient name and address; GSTIN/UIN when registered. For an unregistered recipient with taxable supply of ₹50,000 or more, capture name, address, delivery address, state/UT name and code.
- Each line's HSN code, description, quantity and unit/UQC, supply value, discount, taxable value, applicable component rates, and amounts (CGST, SGST/UTGST, IGST, cess). Capture place of supply, delivery address when different, reverse-charge flag, and authorized signature/digital signature as applicable.
- Snapshot all invoice parties, lines, rates, and tax calculations at issuance. Corrections need explicit credit/debit-note workflows; never edit an issued record in place. Determine whether an Invoice Registration Portal (IRP) reference/QR code or other electronic invoicing requirement applies to the actual GSTIN and transaction before enabling that route.

## Current implementation boundary

The pharmacy POS currently stores an **internal sale record** with customer name, stock batch, quantity, price, discount, and a user-entered total tax amount. It does not store supplier/recipient GSTIN and address snapshots, HSN/UQC, split tax components and rates, place of supply, reverse-charge status, statutory numbering, signature, or IRP result. Consequently its print view must remain labelled **not a statutory tax invoice**. Dealer purchase records only reflect a dealer-issued invoice supplied by that dealer and must not be reissued by the pharmacy.

Do not assign a universal medicine GST rate. The correct HSN and rate can depend on the product, exemptions, notifications, and effective date. Use the current [CBIC goods-and-services rate schedule](https://cbic-gst.gov.in/gst-goods-services-rates.html) and [GST portal HSN search guidance](https://tutorial.gst.gov.in/downloads/news/advisory_on_search_hsn_code_functionality_final.pdf), followed by adviser validation, to configure versioned product tax profiles. Never infer HSN or rate from the medicine name alone.

## Release gate

Statutory tax-invoice generation, automated tax calculation, outward GST reporting, and externally shared documents labelled as tax invoices remain disabled until seller details, tax scheme, HSN/rate mapping, invoice numbering series, IRP applicability, signature method, retention, and correction policy are approved and tested. An engineer's reading of the rules is not a substitute for this review.
