/** LoginSession rows that double as short-lived storage for multi-step account changes. */
export const totpSetupToken = (userId: string) => `totp-setup-${userId}`;
export const pendingEmailToken = (userId: string) => `email-change-${userId}`;
