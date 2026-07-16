/** RFC 4180 escaping: quote when the value could break the row, and double any quote. */
const escapeCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Rows come from `observations_export`, which already has one column per parameter, so the
 * header is just its column list — no pivoting here.
 */
export const toCsv = (rows: Record<string, unknown>[]): string => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ];
  return lines.join("\r\n");
};

export const downloadBlob = (content: string, filename: string, type: string) => {
  // Excel reads a UTF-8 CSV as the local codepage unless it finds a BOM, which mangles the
  // degree signs and the µ in the unit columns.
  const payload = type.startsWith("text/csv") ? `\uFEFF${content}` : content;
  const url = URL.createObjectURL(new Blob([payload], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
