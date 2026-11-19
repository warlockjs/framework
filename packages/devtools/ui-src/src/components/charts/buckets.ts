const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const time = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const clock = (at: number) => time.format(at).replace(/^24:/, "00:");

/**
 * The axis label of a bucket by its width: `HH:mm` for hours (with the date on
 * the first bucket of each day), `ddd HH:mm` for six hours, `MMM d` for days.
 */
export function bucketLabel(at: number, stepMs: number, index = 1): string {
  if (stepMs >= DAY) return monthDay.format(at);
  if (stepMs >= 6 * HOUR) return `${weekday.format(at)} ${clock(at)}`;

  const date = new Date(at);
  const firstOfDay = date.getHours() === 0 && date.getMinutes() === 0;

  return index === 0 || firstOfDay ? `${monthDay.format(at)} ${clock(at)}` : clock(at);
}

/** The full title of a bucket, for tooltips and tables: the date is always there. */
export function bucketTitle(at: number, stepMs: number): string {
  return stepMs >= DAY ? monthDay.format(at) : `${monthDay.format(at)} ${clock(at)}`;
}

/** A round upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;

  const power = 10 ** Math.floor(Math.log10(value));

  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }

  return 10 * power;
}
