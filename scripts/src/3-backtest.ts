import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { program } from "commander";
import { writeFile, readFile, readdir, mkdir } from "fs/promises";
import type { PolymarketSnapshot } from "./lib/types.js";

function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const d = new Array<number>(n).fill(0);
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    delta.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  }
  if (n === 2) { d[0] = delta[0]; d[1] = delta[0]; return d; }
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) { d[i] = 0; }
    else {
      const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]);
      const w2 = (x[i + 1] - x[i]) + 2 * (x[i] - x[i - 1]);
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  d[0] = ((2 * (x[1] - x[0]) + (x[1] - x[0])) * delta[0]) / (2 * (x[1] - x[0]) + (x[1] - x[0]));
  if (delta.length > 1 && d[0] * delta[0] < 0) d[0] = 0;
  const last = n - 1;
  d[last] = delta[delta.length - 1];
  if (delta.length > 1 && d[last] * delta[delta.length - 1] < 0) d[last] = 0;
  return d;
}

function pchipInterpolate(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  for (let j = 0; j < n - 1; j++) {
    if (x >= xs[j] && x < xs[j + 1]) { i = j; break; }
  }
  const slopes = pchipSlopes(xs, ys);
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * ys[i] + h10 * h * slopes[i] + h01 * ys[i + 1] + h11 * h * slopes[i + 1];
}

function pdfAtPrice(xs: number[], ys: number[], price: number): number {
  if (xs.length < 2) return 0;
  const epsilons = [price * 0.00001, price * 0.0001, price * 0.001, price * 0.005];
  for (const epsilon of epsilons) {
    const cdfAbove = pchipInterpolate(xs, ys, price + epsilon);
    const cdfBelow = pchipInterpolate(xs, ys, price - epsilon);
    const pdf = (cdfAbove - cdfBelow) / (2 * epsilon);
    if (pdf > 1e-8) return pdf;
  }
  return 0;
}

function reconstructCDF(
  lpProbabilities: Record<string, number> | undefined,
  percentiles: Record<string, number> | undefined,
): { prices: number[]; cdfValues: number[] } {
  interface CDFPoint { price: number; cdf: number; }
  const lpPoints: CDFPoint[] = [];
  const percPoints: CDFPoint[] = [];

  if (lpProbabilities) {
    for (const [priceStr, prob] of Object.entries(lpProbabilities)) {
      lpPoints.push({ price: parseFloat(priceStr), cdf: prob });
    }
    lpPoints.sort((a, b) => a.price - b.price);
  }

  if (percentiles) {
    const pctKeys = ["0.005", "0.05", "0.2", "0.35", "0.5", "0.65", "0.8", "0.95", "0.995"];
    for (const key of pctKeys) {
      const price = Number(percentiles[key] ?? 0);
      if (price > 0) percPoints.push({ price, cdf: parseFloat(key) });
    }
    percPoints.sort((a, b) => a.price - b.price);
  }

  const combined: CDFPoint[] = [];
  if (percPoints.length > 0) {
    const percMin = percPoints[0].price;
    const percMax = percPoints[percPoints.length - 1].price;
    for (const lp of lpPoints) {
      if (lp.price < percMin - 100 || lp.price > percMax + 100) {
        combined.push(lp);
      }
    }
    for (const p of percPoints) combined.push(p);
  } else {
    for (const lp of lpPoints) combined.push(lp);
  }

  combined.sort((a, b) => a.price - b.price);

  const filtered: CDFPoint[] = [];
  for (const p of combined) {
    if (filtered.length === 0 || Math.abs(p.price - filtered[filtered.length - 1].price) > 1) {
      filtered.push(p);
    }
  }
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i].cdf <= filtered[i - 1].cdf) {
      filtered[i].cdf = filtered[i - 1].cdf + 0.0001;
    }
  }
  for (const p of filtered) {
    p.cdf = Math.max(0, Math.min(1, p.cdf));
  }

  return {
    prices: filtered.map((p) => p.price),
    cdfValues: filtered.map((p) => p.cdf),
  };
}

interface UpDownData {
  synthProbUp: number;
  polymarketProbUp: number;
  startPrice: number;
  currentPrice: number;
  bestBidPrice: number;
  bestAskPrice: number;
  bestBidSize: number;
  bestAskSize: number;
  eventEndTime: string;
  slug: string;
}

interface InsightSnapshot {
  timestamp: number;
  datetime: string;
  currentPrice: number;
  upDown15min: UpDownData | null;
  upDown1h: UpDownData | null;
  upDown24h: UpDownData | null;
  percentiles: Record<string, number> | null;
  lpProbabilities: Record<string, number> | null;
}

interface Scenario {
  name: string;
  bankroll: number;
  riskTolerance: number;
  minEdge: number;
  maxKellyFraction: number;
  fixedBetAmount?: number;
  useSensitivity: boolean;
  useUncertainty: boolean;
}

interface Trade {
  timestamp: number;
  datetime: string;
  direction: "UP" | "DOWN";
  synthProb: number;
  polymarketProb: number;
  edge: number;
  entryPrice: number;
  betAmount: number;
  kellyFraction: number;
  outcome: "UP" | "DOWN" | "UNRESOLVED";
  pnl: number;
  bankrollAfter: number;
  slug: string;
}

interface SkipRecord {
  timestamp: number;
  datetime: string;
  slug: string;
  timeframe: string;
  reason: string;
  edge: number;
  synthProb: number;
  polyProb: number;
}

interface ScenarioResult {
  scenario: Scenario;
  trades: Trade[];
  skipped: SkipRecord[];
  totalTrades: number;
  skippedTrades: number;
  resolvedTrades: number;
  wins: number;
  losses: number;
  hitRate: number;
  totalPnl: number;
  finalBankroll: number;
  returnPct: number;
  maxDrawdownPct: number;
  avgEdge: number;
  avgBetSize: number;
  profitFactor: number;
  equityCurve: { timestamp: number; bankroll: number }[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "The Surgeon",
    bankroll: 1000,
    riskTolerance: 0.25,
    minEdge: 0.08,
    maxKellyFraction: 0.10,
    useSensitivity: true,
    useUncertainty: true,
  },
  {
    name: "Steady Eddie",
    bankroll: 1000,
    riskTolerance: 0.5,
    minEdge: 0.05,
    maxKellyFraction: 0.15,
    useSensitivity: true,
    useUncertainty: true,
  },
  {
    name: "The Shark",
    bankroll: 1000,
    riskTolerance: 0.75,
    minEdge: 0.03,
    maxKellyFraction: 0.20,
    useSensitivity: true,
    useUncertainty: false,
  },
  {
    name: "Raw Signal",
    bankroll: 1000,
    riskTolerance: 0.5,
    minEdge: 0.05,
    maxKellyFraction: 0.15,
    useSensitivity: false,
    useUncertainty: false,
  },
  {
    name: "YOLO",
    bankroll: 1000,
    riskTolerance: 1.0,
    minEdge: 0.02,
    maxKellyFraction: 0.25,
    useSensitivity: false,
    useUncertainty: false,
  },
  {
    name: "Sniper",
    bankroll: 1000,
    riskTolerance: 0.15,
    minEdge: 0.12,
    maxKellyFraction: 0.05,
    useSensitivity: true,
    useUncertainty: true,
  },
  {
    name: "Edge Hunter",
    bankroll: 1000,
    riskTolerance: 0.5,
    minEdge: 0.03,
    maxKellyFraction: 0.15,
    useSensitivity: true,
    useUncertainty: true,
  },
  {
    name: "Sensitivity Only",
    bankroll: 1000,
    riskTolerance: 0.5,
    minEdge: 0.05,
    maxKellyFraction: 0.15,
    useSensitivity: true,
    useUncertainty: false,
  },
  {
    name: "Uncertainty Only",
    bankroll: 1000,
    riskTolerance: 0.5,
    minEdge: 0.05,
    maxKellyFraction: 0.15,
    useSensitivity: false,
    useUncertainty: true,
  },
  {
    name: "Flat $50",
    bankroll: 1000,
    riskTolerance: 1.0,
    minEdge: 0.03,
    maxKellyFraction: 1.0,
    fixedBetAmount: 50,
    useSensitivity: false,
    useUncertainty: false,
  },
];

const PDF_BASELINE = 0.05;
const SENSITIVITY_WEIGHT = 0.3;
const UNCERTAINTY_MULTIPLIER = 10;
const SKEW_WEIGHT = 0.2;

function computeKelly(
  synthProbUp: number,
  marketPrice: number,
  direction: "UP" | "DOWN",
  scenario: Scenario,
  coneWidthPct: number,
  pdfAtRef: number,
  percentile5: number,
  percentile50: number,
  percentile95: number,
): number {
  const naiveKelly = direction === "UP"
    ? (synthProbUp - marketPrice) / (1 - marketPrice)
    : ((1 - synthProbUp) - (1 - marketPrice)) / marketPrice;

  let adjusted = naiveKelly;

  if (scenario.useSensitivity && pdfAtRef > 0) {
    const pdfNorm = Math.min(pdfAtRef / PDF_BASELINE, 1);
    adjusted *= (1 - SENSITIVITY_WEIGHT * pdfNorm);
  }

  if (scenario.useUncertainty && coneWidthPct > 0) {
    adjusted *= 1 / (1 + coneWidthPct * UNCERTAINTY_MULTIPLIER);
  }

  if (scenario.useSensitivity || scenario.useUncertainty) {
    const rightTail = percentile95 - percentile50;
    const leftTail = percentile50 - percentile5;
    const coneWidth = rightTail + leftTail;
    const rawSkew = coneWidth > 0
      ? (direction === "UP"
          ? (rightTail - leftTail) / coneWidth
          : (leftTail - rightTail) / coneWidth)
      : 0;
    adjusted *= (1 + SKEW_WEIGHT * rawSkew);
  }

  return Math.max(0, Math.min(adjusted * scenario.riskTolerance, scenario.maxKellyFraction));
}

async function loadSynthSnapshots(dir: string, asset?: string): Promise<InsightSnapshot[]> {
  const files = await readdir(dir);
  const all: InsightSnapshot[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (asset && !file.toLowerCase().startsWith(asset.toLowerCase())) continue;
    const content = await readFile(`${dir}/${file}`, "utf-8");
    const snapshots: InsightSnapshot[] = JSON.parse(content);
    all.push(...snapshots);
  }

  return all.sort((a, b) => a.timestamp - b.timestamp);
}

async function loadPolymarketData(dir: string): Promise<PolymarketSnapshot[]> {
  const all: PolymarketSnapshot[] = [];

  for (const tf of ["15min", "hourly", "daily"]) {
    const tfDir = `${dir}/${tf}`;
    try {
      const files = await readdir(tfDir);
      for (const file of files) {
        if (!file.endsWith(".json") || file === "index.json") continue;
        const content = await readFile(`${tfDir}/${file}`, "utf-8");
        const snap: PolymarketSnapshot = JSON.parse(content);
        all.push(snap);
      }
    } catch {
      try {
        const content = await readFile(`${dir}/btc-${tf}.json`, "utf-8");
        const snaps: PolymarketSnapshot[] = JSON.parse(content);
        all.push(...snaps);
      } catch {}
    }
  }

  return all.sort((a, b) => a.timestamp - b.timestamp);
}

function findClosestMarket(
  slug: string,
  eventEndTime: string,
  markets: PolymarketSnapshot[],
): PolymarketSnapshot | null {
  const bySlug = markets.find(m => m.marketSlug === slug);
  if (bySlug) return bySlug;

  const targetEnd = new Date(eventEndTime).getTime() / 1000;
  let best: PolymarketSnapshot | null = null;
  let bestDiff = Infinity;

  for (const m of markets) {
    if (!m.endTime) continue;
    const mEnd = new Date(m.endTime).getTime() / 1000;
    const diff = Math.abs(mEnd - targetEnd);
    if (diff < bestDiff && diff < 300) {
      best = m;
      bestDiff = diff;
    }
  }

  return best;
}

function findClosestOrderbook(
  snapshots: { bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; timestamp: number }[],
  targetTimestampSec: number,
): { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] } | null {
  if (snapshots.length === 0) return null;
  let best = snapshots[0];
  let bestDiff = Math.abs(snapshots[0].timestamp / 1000 - targetTimestampSec);
  for (const s of snapshots) {
    const diff = Math.abs(s.timestamp / 1000 - targetTimestampSec);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

function getEntryPrice(
  direction: "UP" | "DOWN",
  market: PolymarketSnapshot | null,
  betTimestamp: number,
  betAmountDollars: number,
): number | null {
  if (!market?.orderbook) return null;

  const books = direction === "UP" ? market.orderbook.up : market.orderbook.down;
  if (!books || books.length === 0) return null;

  const closest = findClosestOrderbook(books, betTimestamp);
  if (!closest) return null;

  const asks = closest.asks
    .filter((a) => a.size > 0)
    .sort((a, b) => a.price - b.price);
  if (asks.length === 0) return null;

  let remaining = betAmountDollars;
  let totalShares = 0;
  let totalCost = 0;

  for (const level of asks) {
    const maxSharesAtLevel = level.size;
    const costPerShare = level.price;
    const affordableShares = remaining / costPerShare;
    const sharesFilled = Math.min(maxSharesAtLevel, affordableShares);
    const cost = sharesFilled * costPerShare;

    totalShares += sharesFilled;
    totalCost += cost;
    remaining -= cost;

    if (remaining <= 0.01) break;
  }

  if (totalShares === 0) return null;
  return totalCost / totalShares;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface RegimeInfo {
  efficiency: number;
  atrPct: number;
}

async function loadCandles(dir: string, asset?: string): Promise<Candle[]> {
  const assetDir = asset ? `${dir}/${asset.toLowerCase()}` : dir;
  try {
    const files = await readdir(assetDir);
    const all: Candle[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(`${assetDir}/${file}`, "utf-8");
      const candles: Candle[] = JSON.parse(content);
      all.push(...candles);
    }
    // Deduplicate by time
    const seen = new Set<number>();
    const deduped = all.filter(c => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    });
    return deduped.sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

function getRegime(candles: Candle[], ts: number, lookbackMin: number): RegimeInfo | null {
  if (candles.length === 0) return null;

  // Binary search for start/end indices
  const fromTs = ts - lookbackMin * 60;
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < fromTs) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = lo;

  lo = startIdx; hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid].time <= ts) lo = mid;
    else hi = mid - 1;
  }
  const endIdx = lo;

  if (endIdx - startIdx < 4) return null;

  const slice = candles.slice(startIdx, endIdx + 1);

  // Efficiency ratio
  const netMove = Math.abs(slice[slice.length - 1].close - slice[0].open);
  let totalPath = 0;
  for (const c of slice) totalPath += Math.abs(c.close - c.open);
  const efficiency = totalPath > 0 ? netMove / totalPath : 0;

  // ATR %
  let atrSum = 0;
  for (const c of slice) atrSum += c.high - c.low;
  const atr = atrSum / slice.length;
  const atrPct = (atr / slice[slice.length - 1].close) * 100;

  return { efficiency, atrPct };
}

function runScenario(
  scenario: Scenario,
  snapshots: InsightSnapshot[],
  markets: PolymarketSnapshot[],
  useConviction: boolean = true,
  fixedBankroll: boolean = false,
  confirmCount: number = 1,
  minConviction: number = 0.5,
  minCone: number = 0,
  maxEntry: number = 1,
  candles: Candle[] = [],
  effMin: number = 0,
  effMax: number = 1,
  effLookback: number = 15,
  atrMin: number = 0,
  atrMax: number = 100,
): ScenarioResult {
  let bankroll = scenario.bankroll;
  const trades: Trade[] = [];
  const skipped: SkipRecord[] = [];
  const equityCurve: { timestamp: number; bankroll: number }[] = [
    { timestamp: snapshots[0]?.timestamp ?? 0, bankroll },
  ];

  // Use every snapshot as a potential bet time (like the bot checking every minute)
  const betTimes = snapshots.map(s => s.timestamp);

  const bettedSlugs = new Set<string>();
  // Confirmation tracking: slug → { direction, count }
  const confirmTracker = new Map<string, { dir: "UP" | "DOWN"; count: number }>();

  for (const betTime of betTimes) {
    if (bankroll <= 1) break;

    let bestSnap: InsightSnapshot | null = null;
    let bestDiff = Infinity;
    for (const s of snapshots) {
      const diff = Math.abs(s.timestamp - betTime);
      if (diff < bestDiff) { bestSnap = s; bestDiff = diff; }
    }
    if (!bestSnap || bestDiff > 120) continue;
    if (!bestSnap.upDown15min || !bestSnap.upDown1h || !bestSnap.upDown24h) continue;

    // Only trade 15min markets
    const ud = bestSnap.upDown15min;
    if (!ud.slug || !ud.eventEndTime) continue;
    // Only trade markets that haven't ended yet (slug timestamp = start, market lasts 900s)
    const slugParts = ud.slug.split("-");
    const slugTs = Number(slugParts[slugParts.length - 1]);
    if (slugTs > 0 && bestSnap.timestamp >= slugTs + 900) continue;
    if (bettedSlugs.has(ud.slug)) continue;
    if (bankroll <= 1) break;

    const synthProb = ud.synthProbUp;
    const synthProbDown = 1 - synthProb;

    // --- Term structure (matches bot logic) ---
    const pUp15min = synthProb;
    const pUp1h = bestSnap.upDown1h!.synthProbUp;
    const pUp24h = bestSnap.upDown24h!.synthProbUp;

    const slope = pUp24h - pUp15min;
    const curvature = pUp1h - (pUp15min + pUp24h) / 2;

    const SLOPE_THRESHOLD = 0.10;
    const CURVATURE_THRESHOLD = 0.10;
    const steepBull = slope > SLOPE_THRESHOLD;
    const steepBear = slope < -SLOPE_THRESHOLD;
    const highCurve = curvature > CURVATURE_THRESHOLD;
    const lowCurve = curvature < -CURVATURE_THRESHOLD;
    let shape: string;
    if (steepBull && highCurve) shape = "accelerating_bull";
    else if (steepBear && lowCurve) shape = "accelerating_bear";
    else if (steepBull) shape = "steep_bullish";
    else if (steepBear) shape = "steep_bearish";
    else if (highCurve) shape = "humped";
    else if (lowCurve) shape = "inverted";
    else shape = "flat";

    const consistencyScore = Math.max(0, 1 - Math.abs(pUp15min - pUp1h));

    const skipBase = { timestamp: bestSnap.timestamp, datetime: bestSnap.datetime, slug: ud.slug, timeframe: "15min", edge: 0, synthProb, polyProb: ud.polymarketProbUp };

    // --- Flat term structure filter (matches bot) ---
    if (shape === "flat" && consistencyScore < 0.6) {
      skipped.push({ ...skipBase, reason: `flat term structure + low consistency (${(consistencyScore * 100).toFixed(0)}%)` });
      continue;
    }

    // --- Find market orderbook ---
    const market = findClosestMarket(ud.slug, ud.eventEndTime, markets);
    if (!market?.orderbook) {
      skipped.push({ ...skipBase, reason: "no orderbook data available" });
      continue;
    }

    // --- Get entry prices for BOTH sides from orderbook ---
    const upEntryPrice = getEntryPrice("UP", market, bestSnap.timestamp, 1); // probe with $1 to get best ask
    const downEntryPrice = getEntryPrice("DOWN", market, bestSnap.timestamp, 1);

    // --- Evaluate both sides independently (matches bot) ---
    const upEdge = upEntryPrice != null && upEntryPrice > 0 ? synthProb - upEntryPrice : -1;
    const downEdge = downEntryPrice != null && downEntryPrice > 0 ? synthProbDown - downEntryPrice : -1;

    interface SideCandidate { dir: "UP" | "DOWN"; edge: number; conviction: number; entryProbe: number }
    const sideCandidates: SideCandidate[] = [];

    if ((!useConviction || synthProb >= minConviction) && upEdge >= scenario.minEdge && upEntryPrice != null && upEntryPrice > 0.01 && upEntryPrice < 0.99) {
      sideCandidates.push({ dir: "UP", edge: upEdge, conviction: synthProb, entryProbe: upEntryPrice });
    }
    if ((!useConviction || synthProbDown >= minConviction) && downEdge >= scenario.minEdge && downEntryPrice != null && downEntryPrice > 0.01 && downEntryPrice < 0.99) {
      sideCandidates.push({ dir: "DOWN", edge: downEdge, conviction: synthProbDown, entryProbe: downEntryPrice });
    }

    if (sideCandidates.length === 0) {
      const bestEdge = Math.max(upEdge, downEdge);
      confirmTracker.delete(ud.slug); // reset confirmation if no edge
      skipped.push({ ...skipBase, edge: Math.abs(synthProb - ud.polymarketProbUp), reason: `no viable side (UP: conv=${(synthProb*100).toFixed(0)}% edge=${(upEdge*100).toFixed(1)}% | DOWN: conv=${(synthProbDown*100).toFixed(0)}% edge=${(downEdge*100).toFixed(1)}%)` });
      continue;
    }

    // Pick side with higher edge
    const pick = sideCandidates.sort((a, b) => b.edge - a.edge)[0];
    const direction = pick.dir;
    const liveEdge = pick.edge;

    // Adaptive confirmation: extreme conviction early = likely wick, needs confirmation
    // Medium conviction = expected early signal, can trade sooner
    const requiredConfirms = confirmCount <= 1 ? 1
      : pick.conviction >= 0.8 ? 3    // extreme: likely wick noise, wait
      : pick.conviction >= 0.65 ? 2   // high: confirm once
      : 1;                            // moderate (50-65%): expected signal, trade now

    if (requiredConfirms > 1) {
      const tracker = confirmTracker.get(ud.slug);
      if (!tracker || tracker.dir !== direction) {
        confirmTracker.set(ud.slug, { dir: direction, count: 1 });
        skipped.push({ ...skipBase, edge: liveEdge, reason: `confirming ${direction} (1/${requiredConfirms}, conv=${(pick.conviction*100).toFixed(0)}%)` });
        continue;
      }
      tracker.count++;
      if (tracker.count < requiredConfirms) {
        skipped.push({ ...skipBase, edge: liveEdge, reason: `confirming ${direction} (${tracker.count}/${requiredConfirms}, conv=${(pick.conviction*100).toFixed(0)}%)` });
        continue;
      }
    }

    bettedSlugs.add(ud.slug);

    // --- Distribution + Kelly (matches bot) ---
    const { prices: cdfPrices, cdfValues } = reconstructCDF(bestSnap.lpProbabilities ?? undefined, bestSnap.percentiles ?? undefined);
    const referencePrice = ud.startPrice || bestSnap.currentPrice;

    let p05 = 0, p50 = 0, p95 = 0;
    if (bestSnap.percentiles) {
      p05 = Number(bestSnap.percentiles["0.05"] ?? 0);
      p50 = Number(bestSnap.percentiles["0.5"] ?? 0);
      p95 = Number(bestSnap.percentiles["0.95"] ?? 0);
    }
    const coneWidthPct = p95 > 0 && bestSnap.currentPrice > 0
      ? (p95 - p05) / bestSnap.currentPrice
      : 0;

    if (minCone > 0 && coneWidthPct < minCone) {
      skipped.push({ ...skipBase, edge: liveEdge, reason: `cone ${(coneWidthPct*100).toFixed(2)}% < min ${(minCone*100).toFixed(1)}%` });
      continue;
    }

    // --- Regime filter (candlestick-based) ---
    if (candles.length > 0 && (effMin > 0 || effMax < 1 || atrMin > 0 || atrMax < 100)) {
      const regime = getRegime(candles, bestSnap.timestamp, effLookback);
      if (regime) {
        if (regime.efficiency < effMin || regime.efficiency > effMax) {
          skipped.push({ ...skipBase, edge: liveEdge, reason: `efficiency ${(regime.efficiency*100).toFixed(1)}% outside ${(effMin*100).toFixed(0)}-${(effMax*100).toFixed(0)}%` });
          continue;
        }
        if (regime.atrPct < atrMin || regime.atrPct > atrMax) {
          skipped.push({ ...skipBase, edge: liveEdge, reason: `ATR ${regime.atrPct.toFixed(3)}% outside ${atrMin}-${atrMax}%` });
          continue;
        }
      }
    }

    const pdfAtRef = cdfPrices.length >= 2
      ? pdfAtPrice(cdfPrices, cdfValues, referencePrice)
      : 0;

    // Kelly: pass P(UP) derived from the side we're trading (matches bot)
    const kellyProbUp = direction === "UP"
      ? pick.entryProbe
      : (1 - pick.entryProbe);

    const kellyFraction = computeKelly(
      synthProb,
      kellyProbUp,
      direction,
      scenario,
      coneWidthPct,
      pdfAtRef,
      p05,
      p50,
      p95,
    );
    if (kellyFraction <= 0) {
      skipped.push({ ...skipBase, edge: liveEdge, reason: `kelly fraction <= 0 (${kellyFraction.toFixed(4)})` });
      continue;
    }

    const sizingBankroll = fixedBankroll ? scenario.bankroll : bankroll;
    const betAmount = scenario.fixedBetAmount
      ? Math.min(scenario.fixedBetAmount, sizingBankroll)
      : Math.min(kellyFraction * sizingBankroll, sizingBankroll * 0.5);
    if (betAmount < 1) continue;

    // Get real fill price with actual bet amount
    const entryPrice = getEntryPrice(direction, market, bestSnap.timestamp, betAmount);
    if (entryPrice === null || entryPrice <= 0 || entryPrice >= 1) {
      skipped.push({ ...skipBase, edge: liveEdge, reason: `invalid entry price: ${entryPrice}` });
      continue;
    }

    if (maxEntry < 1 && entryPrice > maxEntry) {
      skipped.push({ ...skipBase, edge: liveEdge, reason: `entry ${entryPrice.toFixed(2)} > max ${maxEntry.toFixed(2)}` });
      continue;
    }

    // Spread check (matches bot)
    const spread = Math.max(0.01, entryPrice - (pick.entryProbe * 0.98)); // approximate spread from fill vs probe
    const netEdge = liveEdge - 0.01; // 1 tick spread approximation
    if (netEdge <= 0) {
      skipped.push({ ...skipBase, edge: liveEdge, reason: `edge doesn't cover spread` });
      continue;
    }

    let outcome: "UP" | "DOWN";
    if (market?.outcome) {
      outcome = market.outcome;
    } else {
      const eventEndTs = new Date(ud.eventEndTime).getTime() / 1000;
      const laterSnap = snapshots.find(s => s.timestamp > eventEndTs);
      if (laterSnap) {
        outcome = laterSnap.currentPrice > ud.startPrice ? "UP" : "DOWN";
      } else {
        outcome = snapshots[snapshots.length - 1].currentPrice > ud.startPrice ? "UP" : "DOWN";
      }
    }

    const won = direction === outcome;
    const pnl = won
      ? betAmount * ((1 - entryPrice) / entryPrice)
      : -betAmount;

    bankroll += pnl;
    if (bankroll < 0) bankroll = 0;

    trades.push({
      timestamp: bestSnap.timestamp,
      datetime: bestSnap.datetime,
      direction, synthProb, polymarketProb: ud.polymarketProbUp,
      edge: liveEdge, entryPrice, betAmount, kellyFraction,
      outcome, pnl, bankrollAfter: bankroll, slug: ud.slug,
    });

    equityCurve.push({ timestamp: bestSnap.timestamp, bankroll });
  }

  const resolved = trades.filter(t => t.outcome !== "UNRESOLVED");
  const wins = resolved.filter(t => t.direction === t.outcome);
  const losses = resolved.filter(t => t.direction !== t.outcome);

  let peak = scenario.bankroll, maxDD = 0, current = scenario.bankroll;
  for (const t of trades) {
    current += t.pnl;
    if (current > peak) peak = current;
    const dd = peak > 0 ? (peak - current) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  return {
    scenario, trades, skipped,
    totalTrades: trades.length,
    skippedTrades: skipped.length,
    resolvedTrades: resolved.length,
    wins: wins.length,
    losses: losses.length,
    hitRate: resolved.length > 0 ? wins.length / resolved.length : 0,
    totalPnl: trades.reduce((s, t) => s + t.pnl, 0),
    finalBankroll: bankroll,
    returnPct: (bankroll - scenario.bankroll) / scenario.bankroll,
    maxDrawdownPct: maxDD,
    avgEdge: trades.length > 0 ? trades.reduce((s, t) => s + t.edge, 0) / trades.length : 0,
    avgBetSize: trades.length > 0 ? trades.reduce((s, t) => s + t.betAmount, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    equityCurve,
  };
}

async function main() {
  program
    .option("--synth-dir <dir>", "Synth snapshots directory", "data/synth-snapshots")
    .option("--polymarket-dir <dir>", "Polymarket data directory", "data/polymarket")
    .option("--output-dir <dir>", "Output directory", "data/results")
    .option("--no-conviction", "Disable conviction filter")
    .option("--min-conviction <pct>", "Minimum conviction threshold (0-1)", "0.5")
    .option("--fixed-bankroll", "Don't compound — always size against initial bankroll")
    .option("--confirm <n>", "Require N consecutive snapshots confirming signal before trading", "1")
    .option("--min-cone <pct>", "Minimum cone width % to trade (skip low-vol)", "0")
    .option("--max-entry <price>", "Maximum entry price (skip expensive entries)", "1")
    .option("--start <time>", "Start time ISO8601 (filter snapshots)")
    .option("--end <time>", "End time ISO8601 (filter snapshots)")
    .option("--asset <name>", "Filter by asset (btc, eth, sol)")
    .option("--candles-dir <dir>", "Candlestick data directory", "data/candlesticks")
    .option("--eff-min <n>", "Min efficiency ratio to trade (0-1)", "0")
    .option("--eff-max <n>", "Max efficiency ratio to trade (0-1)", "1")
    .option("--eff-lookback <n>", "Efficiency lookback in minutes", "15")
    .option("--atr-min <n>", "Min ATR % to trade", "0")
    .option("--atr-max <n>", "Max ATR % to trade", "100")
    .parse();

  const opts = program.opts();
  await mkdir(opts.outputDir, { recursive: true });

  console.log("Loading data...");
  let snapshots = await loadSynthSnapshots(opts.synthDir, opts.asset);
  if (opts.start) {
    const startTs = Math.floor(new Date(opts.start).getTime() / 1000);
    snapshots = snapshots.filter(s => s.timestamp >= startTs);
  }
  if (opts.end) {
    const endTs = Math.floor(new Date(opts.end).getTime() / 1000);
    snapshots = snapshots.filter(s => s.timestamp <= endTs);
  }
  console.log(`  Synth: ${snapshots.length} snapshots${opts.asset ? ` (${opts.asset.toUpperCase()})` : ""}${opts.start || opts.end ? ` (filtered)` : ""}`);

  if (snapshots.length < 2) {
    console.error("Need more Synth snapshots. Let the collector run longer.");
    process.exit(1);
  }

  const markets = await loadPolymarketData(opts.polymarketDir);
  console.log(`  Polymarket: ${markets.length} markets (${markets.filter(m => m.orderbook).length} with orderbooks)`);

  const firstTs = snapshots[0].timestamp;
  const lastTs = snapshots[snapshots.length - 1].timestamp;
  console.log(`  Time span: ${((lastTs - firstTs) / 60).toFixed(0)} minutes`);

  const candleData = await loadCandles(opts.candlesDir, opts.asset);
  if (candleData.length > 0) {
    console.log(`  Candles: ${candleData.length} (${opts.asset?.toUpperCase() || "all"})`);
  }

  console.log("\nRunning 5 scenarios...\n");
  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    const result = runScenario(scenario, snapshots, markets, opts.conviction, opts.fixedBankroll, Number(opts.confirm), Number(opts.minConviction), Number(opts.minCone), Number(opts.maxEntry), candleData, Number(opts.effMin), Number(opts.effMax), Number(opts.effLookback), Number(opts.atrMin), Number(opts.atrMax));
    results.push(result);

    const icon = result.totalPnl >= 0 ? "+" : "";
    console.log(`  ${scenario.name.padEnd(14)} → ${result.totalTrades} trades (${result.skippedTrades} skipped), ${result.wins}W/${result.losses}L (${(result.hitRate * 100).toFixed(0)}%), PnL: ${icon}$${result.totalPnl.toFixed(2)}`);
  }

  console.log("\nWriting output...");
  for (const r of results) {
    const slug = r.scenario.name.toLowerCase().replace(/\s+/g, "-");
    await writeFile(`${opts.outputDir}/scenario-${slug}.json`, JSON.stringify({
      scenario: r.scenario,
      metrics: {
        totalTrades: r.totalTrades,
        skippedTrades: r.skippedTrades,
        resolvedTrades: r.resolvedTrades,
        wins: r.wins,
        losses: r.losses,
        hitRate: r.hitRate,
        totalPnl: r.totalPnl,
        finalBankroll: r.finalBankroll,
        returnPct: r.returnPct,
        maxDrawdownPct: r.maxDrawdownPct,
        avgEdge: r.avgEdge,
        avgBetSize: r.avgBetSize,
        profitFactor: r.profitFactor,
      },
      trades: r.trades,
      skipped: r.skipped,
      equityCurve: r.equityCurve,
    }, null, 2));
    console.log(`  scenario-${slug}.json (${r.totalTrades} trades, ${r.skippedTrades} skipped)`);
  }

  await writeFile(`${opts.outputDir}/summary.json`, JSON.stringify(
    results.map(r => ({
      scenario: r.scenario.name,
      bankroll: r.scenario.bankroll,
      totalTrades: r.totalTrades,
      skippedTrades: r.skippedTrades,
      wins: r.wins,
      losses: r.losses,
      hitRate: r.hitRate,
      totalPnl: r.totalPnl,
      finalBankroll: r.finalBankroll,
      returnPct: r.returnPct,
      maxDrawdownPct: r.maxDrawdownPct,
      avgEdge: r.avgEdge,
      avgBetSize: r.avgBetSize,
      profitFactor: r.profitFactor,
    })),
    null, 2,
  ));

  console.log("\n" + "=".repeat(110));
  console.log("BACKTEST RESULTS");
  console.log("=".repeat(110));
  console.log(`${"Scenario".padEnd(16)} ${"Init$".padStart(6)} ${"Trades".padStart(6)} ${"Skip".padStart(5)} ${"Wins".padStart(5)} ${"Hit%".padStart(6)} ${"AvgBet".padStart(8)} ${"$Won".padStart(10)} ${"$Lost".padStart(10)} ${"AvgEntry".padStart(8)} ${"PnL".padStart(10)} ${"Return".padStart(8)} ${"MaxDD".padStart(7)} ${"PF".padStart(6)}`);
  console.log("-".repeat(120));
  for (const r of results) {
    const pf = r.profitFactor === Infinity ? "  ∞" : r.profitFactor.toFixed(2);
    const totalWon = r.trades.filter(t => t.direction === t.outcome).reduce((s, t) => s + t.pnl, 0);
    const totalLost = Math.abs(r.trades.filter(t => t.direction !== t.outcome).reduce((s, t) => s + t.pnl, 0));
    const avgEntry = r.trades.length > 0 ? r.trades.reduce((s, t) => s + t.entryPrice, 0) / r.trades.length : 0;
    console.log(
      `${r.scenario.name.padEnd(16)} ${("$" + r.scenario.bankroll).padStart(6)} ${String(r.totalTrades).padStart(6)} ${String(r.skippedTrades).padStart(5)} ${String(r.wins).padStart(5)} ${((r.hitRate * 100).toFixed(1) + "%").padStart(6)} ${("$" + r.avgBetSize.toFixed(0)).padStart(8)} ${("$" + totalWon.toFixed(2)).padStart(10)} ${("$" + totalLost.toFixed(2)).padStart(10)} ${avgEntry.toFixed(3).padStart(8)} ${("$" + r.totalPnl.toFixed(2)).padStart(10)} ${((r.returnPct * 100).toFixed(1) + "%").padStart(8)} ${((r.maxDrawdownPct * 100).toFixed(1) + "%").padStart(7)} ${pf.padStart(6)}`
    );
  }
  console.log("=".repeat(120));
  console.log(`\nOutputs: ${opts.outputDir}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
