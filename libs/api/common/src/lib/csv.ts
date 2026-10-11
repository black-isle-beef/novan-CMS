/** A cell of a CSV export. */
export type CsvCell = string | number | boolean | null | undefined;

/**
 * A CSV file (RFC 4180) of `rows`, the first being the headings, for spreadsheets: CRLF line ends, a byte order mark so
 * Excel reads UTF-8, every cell quoted. A cell that starts like a formula (`=`, `+`, `-`, `@`, tab or carriage return)
 * gets a leading apostrophe, so text someone typed into a form cannot run as a formula when the file is opened.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value: CsvCell): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A file name for `Content-Disposition`: letters, digits, dots and hyphens only. */
export function csvFilename(...parts: string[]): string {
  const name = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${name || 'export'}.csv`;
}
