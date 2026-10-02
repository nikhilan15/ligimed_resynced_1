export const NOTIFICATION_CHANNELS = ['SMS', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationRequest {
  idempotencyKey: string;
  channel: NotificationChannel;
  destination: string;
  templateKey: string;
  templateVersion: number;
  variables: Readonly<Record<string, string>>;
}

export interface NotificationResult {
  providerMessageId: string;
  acceptedAt: Date;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(request: NotificationRequest): Promise<NotificationResult>;
}

export function retryDelayMilliseconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new Error('Attempt must be a positive integer');
  return Math.min(1_000 * 2 ** (attempt - 1), 15 * 60 * 1_000);
}
