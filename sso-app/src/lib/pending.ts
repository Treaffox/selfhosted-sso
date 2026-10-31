/** LoginSession rows that double as short-lived storage for multi-step account changes. */
export const totpSetupToken = (userId: string) => `totp-setup-${userId}`;
export const pendingEmailToken = (userId: string) => `email-change-${userId}`;
export const passkeyRegistrationToken = (userId: string) => `passkey-reg-${userId}`;

/**
 * These tokens are predictable (they contain the user id). They must never be accepted as the `loginToken` of the
 * public sign-in endpoints, otherwise anyone who knows a user id could drive – or wreck – a pending setup.
 */
export const isInternalLoginToken = (token: string) => /^(totp-setup|email-change|passkey-reg)-/.test(token);
