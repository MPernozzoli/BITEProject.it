/**
 * Bank coordinates shown to anyone who has to pay their contribution by transfer.
 *
 * Mirrors apps/web/src/server/bunq/bank-details.ts — that is the Node/API side, which mints
 * the reference and returns the same details to the in-app dialog. Keep both in sync: the
 * email is the only copy a payer still has once the dialog is closed, so a stale IBAN here
 * means money that can never be reconciled.
 *
 * Env overrides exist so a staging project can point payers at a different account without a
 * code change.
 */
export const BANK_TRANSFER_DETAILS = {
  iban: Deno.env.get('BANK_TRANSFER_IBAN')?.trim() || 'NL61BUNQ2201910510',
  bic: Deno.env.get('BANK_TRANSFER_BIC')?.trim() || 'BUNQNL2A',
  holder: Deno.env.get('BANK_TRANSFER_HOLDER')?.trim() || 'Massimo Pernozzoli',
} as const
