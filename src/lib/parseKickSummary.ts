export interface KickPnL {
  income: number;
  expenses: number;
  net: number;
}

/**
 * Parses the `income=$X, expenses=$Y, net=$Z (period, start..end)` summary
 * string returned by /api/kick/status into numeric income/expenses/net.
 * Returns null if the string doesn't match the expected shape (e.g. Kick's
 * summary format changes again).
 */
export function parseKickPnL(summary: string | null | undefined): KickPnL | null {
  if (!summary) return null;
  const m = summary.match(/income=\$([\d,.-]+), expenses=\$([\d,.-]+), net=\$([\d,.-]+)/);
  if (!m) return null;
  return {
    income: parseFloat(m[1].replace(/,/g, "")),
    expenses: parseFloat(m[2].replace(/,/g, "")),
    net: parseFloat(m[3].replace(/,/g, "")),
  };
}
