# Google Sign-In rollout

LigiMed uses Google Identity Services in the browser and verifies its ID token at the API. The API checks Google's signature, issuer, audience, expiry, verified email, and a browser-bound nonce before issuing the existing scoped LigiMed session. Authorization continues to come from LigiMed memberships and permissions, not the Google email address.

## Local configuration

1. Create a Google OAuth **Web application** client in Google Cloud. Add `http://localhost:3000`, `http://localhost:3001`, and `http://localhost:3003` as authorized JavaScript origins. Add your deployed HTTPS origins when deploying. The app uses the Google Identity Services ID-token callback, not a redirect URI.
2. Set `GOOGLE_CLIENT_ID` in the root `.env` file to that web client ID. A client secret is not used in this flow. Do not put the client ID in frontend source or any secret in `NEXT_PUBLIC_*` values.
3. Apply migrations with `pnpm db:deploy`, generate the client with `pnpm db:generate`, then restart the API and frontend development processes. The three apps obtain the public client ID from their same-origin auth bootstrap endpoint.
4. For a local compliance reviewer, run `pnpm admin:provision:google -- reviewer@gmail.com "Reviewer name"` with the actual Gmail address that will sign in. This does not send an invitation. It only creates an internal, permission-scoped account; Google must still verify that account during sign-in.

The Gmail SMTP password is **not** part of Google Sign-In. Email delivery is a separate provider integration; do not paste SMTP passwords into source or chat.

## Existing accounts

Google accounts are identified by Google's stable `sub` claim. Phone-only accounts and demo data are **not** silently attached by matching names or email addresses. Once `GOOGLE_CLIENT_ID` is configured, legacy OTP endpoints return `OTP_RETIRED`. An existing phone-only organization therefore needs an authorized identity-linking/migration process before its owner can sign in with Google. Creating a new Google registration creates a separate pending organization and does not transfer existing KYC or order data. Do not delete the old organization.

## Deployment notes

Admin self-registration is prohibited. The local reviewer provisioner is development-only and currently limits first-login email binding to verified Gmail addresses. Other domains require a separate, explicitly verified provisioning process. Google sign-in does not itself imply pharmacy or dealer KYC approval; onboarding sessions retain their restricted scope until LigiMed approves the organization.
