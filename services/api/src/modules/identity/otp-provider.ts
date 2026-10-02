export interface OtpDeliveryRequest {
  challengeId: string;
  phoneNumber: string;
  code: string;
  expiresInSeconds: number;
}

export interface OtpDeliveryResult {
  providerMessageId: string;
  acceptedAt: Date;
}

export interface OtpProvider {
  send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult>;
}

/**
 * Development-only delivery sink. Never connect this callback to operational logging.
 * Production configuration explicitly rejects this provider.
 */
export class DevelopmentOtpProvider implements OtpProvider {
  constructor(private readonly deliver: (request: OtpDeliveryRequest) => void | Promise<void>) {}

  async send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    await this.deliver(request);
    return {
      providerMessageId: `development:${request.challengeId}`,
      acceptedAt: new Date(),
    };
  }
}
