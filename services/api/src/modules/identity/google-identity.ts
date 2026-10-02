import { createHmac } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';

import { AppError } from '../../platform/errors.js';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function googleNonce(browserToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`google-sign-in:${browserToken}`).digest('base64url');
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
}

export async function verifyGoogleCredential(
  credential: string,
  expectedNonce: string,
  clientId: string | undefined,
): Promise<GoogleIdentity> {
  if (!clientId)
    throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google Sign-In is not configured.');
  try {
    const { payload } = await jwtVerify(credential, googleKeys, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      algorithms: ['RS256'],
      clockTolerance: 30,
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true ||
      typeof payload.nonce !== 'string' ||
      payload.nonce !== expectedNonce
    ) {
      throw new Error('Missing or invalid Google identity claims');
    }
    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      displayName: typeof payload.name === 'string' ? payload.name.slice(0, 200) : '',
    };
  } catch {
    throw new AppError(
      401,
      'GOOGLE_CREDENTIAL_INVALID',
      'Google Sign-In failed. Please try again.',
    );
  }
}
