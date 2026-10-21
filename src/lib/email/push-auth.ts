// Server-only. Verifies the Google-signed OIDC JWT that Pub/Sub attaches to push deliveries.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

let remote: JWTVerifyGetKey | undefined;
function defaultJwks(): JWTVerifyGetKey {
  return (remote ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));
}

/** True only if the token is signed by Google for our audience and push service account. Fails closed. */
export async function verifyPushToken(token: string, opts: { jwks?: JWTVerifyGetKey } = {}): Promise<boolean> {
  const audience = process.env.GMAIL_PUSH_AUDIENCE;
  const saEmail = process.env.GMAIL_PUSH_SA_EMAIL;
  if (!audience || !saEmail || !token) return false;
  try {
    const { payload } = await jwtVerify(token, opts.jwks ?? defaultJwks(), { issuer: ISSUERS, audience });
    return payload.email === saEmail && payload.email_verified === true;
  } catch {
    return false;
  }
}
