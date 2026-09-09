// Timeline / resume periods are year-month only. The API keeps using `date`
// columns, so every stored value is pinned to the 1st of the month.

/** "2021-03-01" -> "2021-03" for <input type="month">. */
export function toMonthInput(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "";
}

/** "2021-03" -> "2021-03-01" for the API; null when empty. */
export function monthInputToDate(value: string | null | undefined): string | null {
  const month = toMonthInput(value);
  return month ? `${month}-01` : null;
}

/** "2021-03-01" -> "2021. 03." (never shows the day). */
export function formatYearMonth(value: string | null | undefined): string {
  const month = toMonthInput(value);
  if (!month) return "";
  const [year, m] = month.split("-");
  return year && m ? `${year}. ${m}.` : month;
}

/** "2021. 03. ~ 2025. 02." / "2021. 03. ~ 진행중" */
export function formatPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
  ongoingLabel = "진행중"
): string {
  const from = formatYearMonth(start);
  const to = end ? formatYearMonth(end) : ongoingLabel;
  return from ? `${from} ~ ${to}` : to;
}
