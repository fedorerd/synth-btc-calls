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

async function loadSynthSnapshots(dir: string): Promise<InsightSnapshot[]> {
  const files = await readdir(dir);
  const all: InsightSnapshot[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
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

function runScenario(
  scenario: Scenario,
  snapshots: InsightSnapshot[],
  markets: PolymarketSnapshot[],
): ScenarioResult {
  let bankroll = scenario.bankroll;
  const trades: Trade[] = [];
  const skipped: SkipRecord[] = [];
  const equityCurve: { timestamp: number; bankroll: number }[] = [
    { timestamp: snapshots[0]?.timestamp ?? 0, bankroll },
  ];

  const seed = scenario.name.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  let rng = Math.abs(seed) || 1;
  const nextRng = () => { rng = (rng * 1664525 + 1013904223) & 0x7fffffff; return rng / 0x7fffffff; };

  const firstTs = snapshots[0].timestamp;
  const lastTs = snapshots[snapshots.length - 1].timestamp;
  const betTimes: number[] = [];
  const avgIntervalSec = 300;
  let t = firstTs + Math.floor(nextRng() * avgIntervalSec);
  while (t <= lastTs) {
    betTimes.push(t);
    t += Math.floor(avgIntervalSec * 0.6 + nextRng() * avgIntervalSec * 0.8);
  }

  const bettedSlugs = new Set<string>();

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

    const candidates: { ud: UpDownData; label: string }[] = [];
    if (bestSnap.upDown15min.slug) candidates.push({ ud: bestSnap.upDown15min, label: "15min" });
    if (bestSnap.upDown1h.slug) candidates.push({ ud: bestSnap.upDown1h, label: "1h" });

    for (const { ud, label } of candidates) {
      if (bankroll <= 1) break;
      if (!ud.eventEndTime) continue;
      if (bettedSlugs.has(ud.slug)) continue;
      bettedSlugs.add(ud.slug);

      const synthProb = ud.synthProbUp;
      const polyProb = ud.polymarketProbUp;
      const edge = Math.abs(synthProb - polyProb);
      const direction: "UP" | "DOWN" = synthProb > polyProb ? "UP" : "DOWN";

      const skipBase = { timestamp: bestSnap.timestamp, datetime: bestSnap.datetime, slug: ud.slug, timeframe: label, edge, synthProb, polyProb };

      if (edge < scenario.minEdge) {
        skipped.push({ ...skipBase, reason: `edge ${(edge * 100).toFixed(1)}% < min ${(scenario.minEdge * 100).toFixed(0)}%` });
        continue;
      }

      const market = findClosestMarket(ud.slug, ud.eventEndTime, markets);
      if (!market?.orderbook) {
        skipped.push({ ...skipBase, reason: "no orderbook data available" });
        continue;
      }

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
      const pdfAtRef = cdfPrices.length >= 2
        ? pdfAtPrice(cdfPrices, cdfValues, referencePrice)
        : 0;

      const kellyFraction = computeKelly(
        synthProb,
        direction === "UP" ? polyProb : 1 - polyProb,
        direction,
        scenario,
        coneWidthPct,
        pdfAtRef,
        p05,
        p50,
        p95,
      );
      if (kellyFraction <= 0) {
        skipped.push({ ...skipBase, reason: `kelly fraction <= 0 (${kellyFraction.toFixed(4)})` });
        continue;
      }

      const betAmount = scenario.fixedBetAmount
        ? Math.min(scenario.fixedBetAmount, bankroll)
        : Math.min(kellyFraction * bankroll, bankroll * 0.5);
      if (betAmount < 1) continue;

      const entryPrice = getEntryPrice(direction, market, bestSnap.timestamp, betAmount);
      if (entryPrice === null || entryPrice <= 0 || entryPrice >= 1) {
        skipped.push({ ...skipBase, reason: `invalid entry price: ${entryPrice}` });
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
      direction, synthProb, polymarketProb: polyProb,
      edge, entryPrice, betAmount, kellyFraction,
      outcome, pnl, bankrollAfter: bankroll, slug: ud.slug,
    });

      equityCurve.push({ timestamp: bestSnap.timestamp, bankroll });
    }
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
    .parse();

  const opts = program.opts();
  await mkdir(opts.outputDir, { recursive: true });

  console.log("Loading data...");
  const snapshots = await loadSynthSnapshots(opts.synthDir);
  console.log(`  Synth: ${snapshots.length} snapshots`);

  if (snapshots.length < 2) {
    console.error("Need more Synth snapshots. Let the collector run longer.");
    process.exit(1);
  }

  const markets = await loadPolymarketData(opts.polymarketDir);
  console.log(`  Polymarket: ${markets.length} markets (${markets.filter(m => m.orderbook).length} with orderbooks)`);

  const firstTs = snapshots[0].timestamp;
  const lastTs = snapshots[snapshots.length - 1].timestamp;
  console.log(`  Time span: ${((lastTs - firstTs) / 60).toFixed(0)} minutes`);

  console.log("\nRunning 5 scenarios...\n");
  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    const result = runScenario(scenario, snapshots, markets);
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
