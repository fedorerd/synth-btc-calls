import type {
  SynthPercentilesResponse,
  SynthLPProbabilitiesResponse,
  DistributionAnalysis,
  SynthPercentileStep,
} from "./types";

// ---
// PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)
// monotone-preserving cubic interpolation
// ---

function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const d = new Array<number>(n).fill(0);
  const delta: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    delta.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  }

  if (n === 2) {
    d[0] = delta[0];
    d[1] = delta[0];
    return d;
  }

  // interior points
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      d[i] = 0;
    } else {
      // harmonic mean weighted by interval lengths
      const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]);
      const w2 = (x[i + 1] - x[i]) + 2 * (x[i] - x[i - 1]);
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  // endpoints: one-sided shape-preserving
  d[0] = ((2 * (x[1] - x[0]) + (x[1] - x[0])) * delta[0]) / (2 * (x[1] - x[0]) + (x[1] - x[0]));
  if (delta.length > 1 && d[0] * delta[0] < 0) d[0] = 0;

  const last = n - 1;
  d[last] = delta[delta.length - 1];
  if (delta.length > 1 && d[last] * delta[delta.length - 1] < 0) d[last] = 0;

  return d;
}

function pchipInterpolate(xs: number[], ys: number[], x: number): number {
  const n = xs.length;

  // clamp to range
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  // find interval
  let i = 0;
  for (let j = 0; j < n - 1; j++) {
    if (x >= xs[j] && x < xs[j + 1]) {
      i = j;
      break;
    }
  }

  const slopes = pchipSlopes(xs, ys);
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  // hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * ys[i] + h10 * h * slopes[i] + h01 * ys[i + 1] + h11 * h * slopes[i + 1];
}

// numerical CDF derivative at a point
function pdfAtPrice(xs: number[], ys: number[], price: number): number {
  if (xs.length < 2) return 0;

  // multiple epsilon scales to get a non-zero derivative (widen till we get some signal)
  const epsilons = [
    price * 0.00001,  // ~$70k -> ~$0.70
    price * 0.0001,   // -> ~$7
    price * 0.001,    // -> ~$70
    price * 0.005,    // -> ~$350
  ];

  for (const epsilon of epsilons) {
    const cdfAbove = pchipInterpolate(xs, ys, price + epsilon);
    const cdfBelow = pchipInterpolate(xs, ys, price - epsilon);
    const pdf = (cdfAbove - cdfBelow) / (2 * epsilon);
    if (pdf > 1e-8) return pdf;
  }

  return 0;
}

// ---
// CDF Reconstruction
// ---

interface CDFPoint {
  price: number;
  cdf: number;
}

function getLastPercentileStep(percentiles: SynthPercentileStep[]): SynthPercentileStep {
  return percentiles[percentiles.length - 1];
}

function reconstructCDF(
  lpProbabilities: SynthLPProbabilitiesResponse,
  percentiles: SynthPercentilesResponse,
): { prices: number[]; cdfValues: number[] } {
  const lpPoints: CDFPoint[] = [];
  const percPoints: CDFPoint[] = [];

  // LP probabilities: probability_below is the CDF (wide price range, coarser)
  const lpBelow = lpProbabilities.data["24h"].probability_below;
  for (const [priceStr, prob] of Object.entries(lpBelow)) {
    lpPoints.push({ price: parseFloat(priceStr), cdf: prob });
  }
  lpPoints.sort((a, b) => a.price - b.price);

  // prediction percentiles (last timestep = end of horizon): inverse CDF (tight range, finer)
  const lastStep = getLastPercentileStep(percentiles.forecast_future.percentiles);
  const percentileKeys = ["0.005", "0.05", "0.2", "0.35", "0.5", "0.65", "0.8", "0.95", "0.995"] as const;
  for (const pctKey of percentileKeys) {
    const price = lastStep[pctKey];
    const cdf = parseFloat(pctKey);
    percPoints.push({ price, cdf });
  }
  percPoints.sort((a, b) => a.price - b.price);

  // determine the price range covered by percentiles
  const percMin = percPoints[0].price;
  const percMax = percPoints[percPoints.length - 1].price;

  // use LP points outside percentile range, percentile points inside
  // this avoids conflicts where LP's coarser CDF disagrees with the finer percentile data
  const combined: CDFPoint[] = [];

  for (const lp of lpPoints) {
    if (lp.price < percMin - 100 || lp.price > percMax + 100) {
      combined.push(lp);
    }
  }
  for (const p of percPoints) {
    combined.push(p);
  }

  combined.sort((a, b) => a.price - b.price);

  // remove near-duplicate prices (withni $1)
  const filtered: CDFPoint[] = [];
  for (const p of combined) {
    if (filtered.length === 0 || Math.abs(p.price - filtered[filtered.length - 1].price) > 1) {
      filtered.push(p);
    }
  }

  // ensure strict monotonicity of CDF values
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i].cdf <= filtered[i - 1].cdf) {
      filtered[i].cdf = filtered[i - 1].cdf + 0.0001;
    }
  }
  // clamp to 0, 1
  for (const p of filtered) {
    p.cdf = Math.max(0, Math.min(1, p.cdf));
  }

  return {
    prices: filtered.map((p) => p.price),
    cdfValues: filtered.map((p) => p.cdf),
  };
}

function evaluateCDF(
  prices: number[],
  cdfValues: number[],
  targetPrice: number,
): number {
  return pchipInterpolate(prices, cdfValues, targetPrice);
}

export function buildDistributionAnalysis(
  lpProbabilities: SynthLPProbabilitiesResponse,
  percentiles: SynthPercentilesResponse,
  referencePrice: number,
): DistributionAnalysis {
  const { prices, cdfValues } = reconstructCDF(lpProbabilities, percentiles);

  const lastStep = getLastPercentileStep(percentiles.forecast_future.percentiles);
  const p5 = lastStep["0.05"];
  const p50 = lastStep["0.5"];
  const p95 = lastStep["0.95"];
  const currentPrice = percentiles.current_price;

  const pDown = evaluateCDF(prices, cdfValues, referencePrice);
  const pUp = 1 - pDown;
  const coneWidthPct = (p95 - p5) / currentPrice;
  const pdf = pdfAtPrice(prices, cdfValues, referencePrice);

  // skew: positive = right tail heavier (favorable for UP)
  const rightTail = p95 - p50;
  const leftTail = p50 - p5;
  const skew = (rightTail - leftTail) / currentPrice;

  return {
    asset: "BTC",
    horizon: "1h",
    cdfPoints: prices.map((price, i) => ({
      price,
      cumulativeProb: cdfValues[i],
    })),
    pUp,
    pDown,
    coneWidthPct,
    pdfAtReference: pdf,
    skew,
    percentile5: p5,
    percentile50: p50,
    percentile95: p95,
  };
}
