export interface Observation {
  date: string;
  riders: number;
}

export const HORIZON = 7;
export const HISTORY_DAYS = 730;

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function datesFrom(start: string): string[] {
  return Array.from({ length: HORIZON }, (_, day) => addDays(start, day));
}

export function nyToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    dateStyle: "short",
  }).format(now);
}

export function observations(value: unknown): Observation[] {
  if (!Array.isArray(value)) throw new Error("MTA response must be an array.");

  const seen = new Set<string>();
  return value
    .map((row: unknown) => {
      if (
        typeof row !== "object" ||
        row === null ||
        !("date" in row) ||
        typeof row.date !== "string" ||
        !("count" in row) ||
        typeof row.count !== "string" ||
        !/^\d+$/.test(row.count)
      ) {
        throw new Error("MTA response contains an invalid ridership row.");
      }
      const date = row.date.slice(0, 10);
      const riders = Number(row.count);
      if (!validDate(date) || !Number.isSafeInteger(riders) || seen.has(date)) {
        throw new Error(`Invalid or duplicate MTA observation for ${date}.`);
      }
      seen.add(date);
      return { date, riders };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchRidership(asOf: string): Promise<Observation[]> {
  const url = new URL("https://data.ny.gov/resource/sayj-mze2.json");
  url.search = new URLSearchParams({
    $select: "date,count",
    $where: `mode = 'Subway' AND date >= '${addDays(asOf, -HISTORY_DAYS)}T00:00:00' AND date < '${asOf}T00:00:00'`,
    $order: "date",
    $limit: "1000",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok)
    throw new Error(`MTA ridership request failed: HTTP ${response.status}.`);
  return observations(await response.json());
}
