/**
 * Framework-free IBAN/BIC helpers shared by the refund form (client) and the refund
 * endpoint (server). Validation is structural only — it proves the string is well-formed
 * (country + length + mod-97 checksum), not that the account exists. Bunq surfaces the
 * "account/holder does not exist" class of errors when the payment is actually attempted.
 */

export function normalizeIban(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}

/** Structural + mod-97 checksum validation (ISO 13616). */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

  // Process in chunks to stay within safe-integer range instead of using BigInt.
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    const block = String(remainder) + expanded.slice(i, i + 7);
    remainder = Number(block) % 97;
  }
  return remainder === 1;
}

export function normalizeBic(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Optional field: an empty string is valid; a non-empty one must match the SWIFT format. */
export function isValidBic(value: string): boolean {
  const bic = normalizeBic(value);
  if (!bic) return true;
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}
