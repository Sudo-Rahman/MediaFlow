export { extractSeriesInfo } from '$lib/types/merge';

/** Parse season labels such as "Season 2" and "S02" from a path component. */
export function extractSeasonNumber(value: string): number | undefined {
  const match = value.match(
    /(?:^|[\s._\-[\](){}])(?:season[\s._-]*|s)(\d{1,4})(?=$|[\s._\-[\](){}])/i,
  );
  if (!match) {
    return undefined;
  }

  const season = Number.parseInt(match[1], 10);
  return Number.isInteger(season) && season > 0 ? season : undefined;
}
