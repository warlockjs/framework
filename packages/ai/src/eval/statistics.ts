import type {
  EvalCaseResult,
  EvalInterval,
  EvalMetricStats,
  EvalStats,
} from "../contracts/agent/eval.type";

export const DEFAULT_CONFIDENCE = 0.95;

/** Mean of a list; `0` for an empty list. */
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation,
 * relative error below 1.2e-9).
 */
export function normalQuantile(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));

    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > 1 - low) {
    return -normalQuantile(1 - p);
  }

  const q = p - 0.5;
  const r = q * q;

  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Natural log of the gamma function (Lanczos approximation). */
function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;

  tmp -= (x + 0.5) * Math.log(tmp);

  let series = 1.000000000190015;

  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }

  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

/** Continued-fraction evaluation used by the regularized incomplete beta. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);

  if (Math.abs(d) < tiny) d = tiny;

  d = 1 / d;

  let h = d;

  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));

    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;

    const delta = d * c;

    h *= delta;

    if (Math.abs(delta - 1) < 1e-12) break;
  }

  return h;
}

/** Regularized incomplete beta function `I_x(a, b)`. */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }

  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** CDF of Student's t distribution with `df` degrees of freedom. */
function studentCdf(t: number, df: number): number {
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5);

  return t >= 0 ? 1 - tail : tail;
}

/**
 * Two-sided critical value of Student's t: the `t` with
 * `P(-t <= T <= t) = confidence` for `df` degrees of freedom, found by
 * bisection on the CDF.
 */
export function tCritical(df: number, confidence = DEFAULT_CONFIDENCE): number {
  const target = 1 - (1 - confidence) / 2;
  let low = 0;
  let high = 1;

  while (studentCdf(high, df) < target && high < 1e9) {
    high *= 2;
  }

  for (let step = 0; step < 100; step++) {
    const mid = (low + high) / 2;

    if (studentCdf(mid, df) < target) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

/**
 * Wilson score interval for a binomial proportion. Unlike the normal
 * approximation it stays inside `[0, 1]`, is non-degenerate at 0 and
 * `total` successes, and is wide for small samples. `total = 0` yields the
 * uninformative `[0, 1]`.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  confidence = DEFAULT_CONFIDENCE,
): EvalInterval {
  if (total <= 0) {
    return { low: 0, high: 1 };
  }

  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

/**
 * Student-t confidence interval for the mean of `values`, clamped to the
 * `[0, 1]` score range. Fewer than two samples carry no variance estimate,
 * so the interval is the uninformative `[0, 1]`.
 */
export function tInterval(values: number[], confidence = DEFAULT_CONFIDENCE): EvalInterval {
  const n = values.length;

  if (n < 2) {
    return { low: 0, high: 1 };
  }

  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (n - 1);
  const margin = tCritical(n - 1, confidence) * Math.sqrt(variance / n);

  return {
    low: Math.max(0, average - margin),
    high: Math.min(1, average + margin),
  };
}

/** One run's contribution to the statistics. */
type Sample = { score: number; passed: boolean };

/** Samples of a case: its recorded runs, or the case itself for legacy reports. */
export function samplesOf(entry: EvalCaseResult): Sample[] {
  if (entry.runs && entry.runs.length > 0) {
    return entry.runs;
  }

  return [{ score: entry.score, passed: entry.passed }];
}

/** Build the statistics of one metric group from flat samples. */
function metricStats(samples: Sample[], confidence: number): EvalMetricStats {
  const passes = samples.filter((sample) => sample.passed).length;
  const scores = samples.map((sample) => sample.score);

  return {
    runs: samples.length,
    passes,
    passRate: samples.length > 0 ? passes / samples.length : 0,
    passRateInterval: wilsonInterval(passes, samples.length, confidence),
    meanScore: mean(scores),
    meanScoreInterval: tInterval(scores, confidence),
  };
}

/**
 * Compute {@link EvalStats} for a set of case results: overall and per
 * `category`. Every run of every case is one sample, so a report with
 * `repeat: 3` over 10 cases pools 30 samples. Reports without recorded runs
 * (older baselines) contribute one sample per case.
 */
export function computeStats(cases: EvalCaseResult[], confidence = DEFAULT_CONFIDENCE): EvalStats {
  const groups = new Map<string, Sample[]>();
  const all: Sample[] = [];

  for (const entry of cases) {
    const samples = samplesOf(entry);

    all.push(...samples);

    const category = entry.case.category;

    if (category !== undefined) {
      groups.set(category, [...(groups.get(category) ?? []), ...samples]);
    }
  }

  const categories: Record<string, EvalMetricStats> = {};

  for (const [category, samples] of groups) {
    categories[category] = metricStats(samples, confidence);
  }

  return { confidence, overall: metricStats(all, confidence), categories };
}

/** Per-case score interval from its runs (`[0, 1]` when under two runs). */
export function caseScoreInterval(
  entry: EvalCaseResult,
  confidence = DEFAULT_CONFIDENCE,
): EvalInterval {
  return tInterval(
    samplesOf(entry).map((sample) => sample.score),
    confidence,
  );
}
