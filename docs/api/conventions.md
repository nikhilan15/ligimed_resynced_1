# REST API conventions

- Public endpoints are versioned beneath `/api/v1`; platform health endpoints use `/health`.
- Requests and responses use JSON unless a documented upload flow uses a presigned object-storage
  URL.
- The API echoes an `x-request-id` header and carries that identifier into jobs and audit records.
- Cursor pagination is the default for growing collections.
- State-changing operations that may be retried use an `Idempotency-Key` and durable result record.
- Monetary amounts cross API boundaries as integer-minor-unit strings plus ISO currency code.
- Prisma records are mapped to explicit response contracts and are never serialized directly.

Errors use RFC 9457-style problem details with stable LigiMed `code` values, a safe human-readable
detail, a trace ID, and optional field errors. Stack traces and provider/database details are not
returned to callers.

Cookie-authenticated mutation routes must add CSRF protection before they are exposed. Phase 0 has
no authentication mutation route yet; this is a release gate for the first OTP endpoint.
