import type { Money } from '@ligimed/types';

export interface CreatePaymentIntentRequest {
  idempotencyKey: string;
  internalPaymentIntentId: string;
  orderId: string;
  amount: Money;
  returnUrl: string;
  metadata: Readonly<Record<string, string>>;
}

export interface ProviderPaymentIntent {
  providerIntentId: string;
  status: 'PENDING' | 'REQUIRES_ACTION' | 'AUTHORIZED' | 'FAILED';
  checkoutUrl?: string;
}

export interface VerifiedWebhookEvent {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
}

export interface PaymentProvider {
  createIntent(request: CreatePaymentIntentRequest): Promise<ProviderPaymentIntent>;
  getIntent(providerIntentId: string): Promise<ProviderPaymentIntent>;
  refund(providerTransactionId: string, amount: Money, idempotencyKey: string): Promise<void>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedWebhookEvent>;
}
