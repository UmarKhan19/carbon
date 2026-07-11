/**
 * Server-side lifecycle hooks for the QuickBooks Online integration,
 * mirroring the Xero hooks (../xero/hooks.server.ts).
 *
 * Intentionally empty for now: event-system subscriptions (the equivalent
 * of xeroOnInstall's "xero-sync" subscriptions) are wired when the QBO
 * entity syncers land (Tasks C5–C8) — subscribing tables before any syncer
 * can drain them would only queue dead events.
 */
export async function quickbooksOnInstall(_companyId: string) {
  // No-op until the QuickBooks Online entity syncers are registered
}
