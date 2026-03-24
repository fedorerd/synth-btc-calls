import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { program } from "commander";
import { writeFile, readFile, readdir, mkdir } from "fs/promises";
import type { PolymarketSnapshot } from "./lib/types.js";

// Reuse types from main backtest
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

interface SpreadTrade {
  timestamp: number;
  datetime: string;
  slug: string;
  direction: "UP" | "DOWN";
  synthProb: number;
  entryPrice: number;
  exitPrice: number;
  exitMinute: number;
  betAmount: number;
  pnl: number;
  pnlPct: number;
  holdMinutes: number;
  exitReason: "spread_captured" | "time_limit" | "stop_loss" | "resolution";
  bankrollAfter: number;
}

interface SpreadScenario {
  name: string;
  bankroll: number;
  minEdge: number;
  maxKellyFraction: number;
  riskTolerance: number;
  profitTargetPct: number;  // exit if position is up this % (e.g. 0.2 = 20% profit)
  maxExitMinute: number;    // only try early exit within first N minutes, then hold to resolve
}

const SCENARIOS: SpreadScenario[] = [
  {
    name: "10% in 3min",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 0.10, maxExitMinute: 3,
  },
  {
    name: "20% in 5min",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 0.20, maxExitMinute: 5,
  },
  {
    name: "30% in 5min",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 0.30, maxExitMinute: 5,
  },
  {
    name: "20% in 3min",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 0.20, maxExitMinute: 3,
  },
  {
    name: "50% in 8min",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 0.50, maxExitMinute: 8,
  },
  {
    name: "Hold Only",
    bankroll: 1000, minEdge: 0.05, maxKellyFraction: 0.15, riskTolerance: 0.5,
    profitTargetPct: 99, maxExitMinute: 0, // never early exit
  },
];

async function loadSynthSnapshots(dir: string): Promise<InsightSnapshot[]> {
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort();
  const all: InsightSnapshot[] = [];
  for (const f of files) {
    const data = JSON.parse(await readFile(resolve(dir, f), "utf-8"));
    all.push(...data);
  }
  all.sort((a, b) => a.timestamp - b.timestamp);
  return all;
}

async function loadPolymarketData(dir: string): Promise<PolymarketSnapshot[]> {
  const all: PolymarketSnapshot[] = [];
  for (const tf of ["15min", "hourly"]) {
    const tfDir = resolve(dir, tf);
    try {
      const files = (await readdir(tfDir)).filter(f => f.endsWith(".json") && f !== "index.json");
      for (const f of files) {
        const data = JSON.parse(await readFile(resolve(tfDir, f), "utf-8"));
        all.push(data);
      }
    } catch {}
  }
  return all;
}

function findClosestMarket(slug: string, eventEndTime: string, markets: PolymarketSnapshot[]): PolymarketSnapshot | null {
  const targetEnd = new Date(eventEndTime).getTime() / 1000;
  let best: PolymarketSnapshot | null = null;
  let bestDiff = Infinity;
  for (const m of markets) {
    if (!m.endTime) continue;
    const mEnd = new Date(m.endTime).getTime() / 1000;
    const diff = Math.abs(mEnd - targetEnd);
    if (diff < bestDiff && diff < 300) { best = m; bestDiff = diff; }
  }
  return best;
}

function getBookPriceAtTime(
  side: "UP" | "DOWN",
  market: PolymarketSnapshot,
  timestampSec: number,
  orderType: "ask" | "bid",
): number | null {
  if (!market?.orderbook) return null;
  const books = side === "UP" ? market.orderbook.up : market.orderbook.down;
  if (!books || books.length === 0) return null;

  // Find closest snapshot
  let best = books[0];
  let bestDiff = Math.abs(books[0].timestamp / 1000 - timestampSec);
  for (const s of books) {
    const diff = Math.abs(s.timestamp / 1000 - timestampSec);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }

  if (orderType === "ask") {
    const asks = best.asks.filter(a => a.size > 0).sort((a, b) => a.price - b.price);
    return asks.length > 0 ? asks[0].price : null;
  } else {
    const bids = best.bids.filter(b => b.size > 0).sort((a, b) => b.price - a.price);
    return bids.length > 0 ? bids[0].price : null;
  }
}

function runSpreadScenario(
  scenario: SpreadScenario,
  snapshots: InsightSnapshot[],
  markets: PolymarketSnapshot[],
  useConviction: boolean,
  fixedBankroll: boolean,
): { trades: SpreadTrade[]; skipped: number } {
  let bankroll = scenario.bankroll;
  const trades: SpreadTrade[] = [];
  let skipped = 0;
  const bettedSlugs = new Set<string>();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (bankroll <= 1) break;
    if (!snap.upDown15min || !snap.upDown1h || !snap.upDown24h) continue;

    const ud = snap.upDown15min;
    if (!ud.slug || !ud.eventEndTime) continue;

    // Only trade markets that haven't ended
    const slugParts = ud.slug.split("-");
    const slugTs = Number(slugParts[slugParts.length - 1]);
    if (slugTs > 0 && snap.timestamp >= slugTs + 900) continue;
    if (bettedSlugs.has(ud.slug)) continue;

    const synthProb = ud.synthProbUp;
    const synthProbDown = 1 - synthProb;

    // Term structure
    const pUp15min = synthProb;
    const pUp1h = snap.upDown1h!.synthProbUp;
    const pUp24h = snap.upDown24h!.synthProbUp;
    const slope = pUp24h - pUp15min;
    const curvature = pUp1h - (pUp15min + pUp24h) / 2;

    let shape: string;
    if (slope > 0.1 && curvature > 0.1) shape = "accelerating_bull";
    else if (slope < -0.1 && curvature < -0.1) shape = "accelerating_bear";
    else if (slope > 0.1) shape = "steep_bullish";
    else if (slope < -0.1) shape = "steep_bearish";
    else if (curvature > 0.1) shape = "humped";
    else if (curvature < -0.1) shape = "inverted";
    else shape = "flat";

    const consistencyScore = Math.max(0, 1 - Math.abs(pUp15min - pUp1h));
    if (shape === "flat" && consistencyScore < 0.6) { skipped++; continue; }

    // Find market for orderbook data
    const market = findClosestMarket(ud.slug, ud.eventEndTime, markets);
    if (!market?.orderbook) { skipped++; continue; }

    // Get entry prices from orderbook
    const upAsk = getBookPriceAtTime("UP", market, snap.timestamp, "ask");
    const downAsk = getBookPriceAtTime("DOWN", market, snap.timestamp, "ask");

    // Evaluate both sides
    const upEdge = upAsk != null && upAsk > 0.01 && upAsk < 0.99 ? synthProb - upAsk : -1;
    const downEdge = downAsk != null && downAsk > 0.01 && downAsk < 0.99 ? synthProbDown - downAsk : -1;

    interface Candidate { dir: "UP" | "DOWN"; edge: number; conviction: number; entryPrice: number }
    const candidates: Candidate[] = [];

    if ((!useConviction || synthProb >= 0.5) && upEdge >= scenario.minEdge && upAsk != null) {
      candidates.push({ dir: "UP", edge: upEdge, conviction: synthProb, entryPrice: upAsk });
    }
    if ((!useConviction || synthProbDown >= 0.5) && downEdge >= scenario.minEdge && downAsk != null) {
      candidates.push({ dir: "DOWN", edge: downEdge, conviction: synthProbDown, entryPrice: downAsk });
    }

    if (candidates.length === 0) { skipped++; continue; }

    const pick = candidates.sort((a, b) => b.edge - a.edge)[0];
    bettedSlugs.add(ud.slug);

    // Kelly sizing
    const kellyFrac = Math.max(0, Math.min(
      (pick.edge / (1 - pick.entryPrice)) * scenario.riskTolerance,
      scenario.maxKellyFraction,
    ));
    const sizingBankroll = fixedBankroll ? scenario.bankroll : bankroll;
    const betAmount = Math.round(kellyFrac * sizingBankroll * 100) / 100;
    if (betAmount < 1) continue;

    const shares = betAmount / pick.entryPrice;

    // --- Simulate exit: sell early if profit target hit, otherwise hold to resolution ---
    let exitPrice = pick.entryPrice;
    let exitMinute = 0;
    let exitReason: SpreadTrade["exitReason"] = "resolution";
    const targetSellPrice = pick.entryPrice * (1 + scenario.profitTargetPct);

    // Look for early exit opportunity within maxExitMinute window
    if (scenario.maxExitMinute > 0) {
      for (let j = i + 1; j < snapshots.length; j++) {
        const futureSnap = snapshots[j];
        const minutesIn = (futureSnap.timestamp - snap.timestamp) / 60;
        if (minutesIn > scenario.maxExitMinute) break;
        if (minutesIn > 14) break;

        // Check if bid has reached our profit target
        const bidPrice = getBookPriceAtTime(pick.dir, market, futureSnap.timestamp, "bid");
        if (bidPrice != null && bidPrice >= targetSellPrice) {
          exitPrice = targetSellPrice; // filled at our limit sell
          exitMinute = Math.round(minutesIn);
          exitReason = "spread_captured";
          break;
        }
      }
    }

    // If we never exited, resolve at market end
    if (exitReason === "resolution") {
      // Check actual outcome
      let outcome: "UP" | "DOWN" = "DOWN";
      if (market.outcome) {
        outcome = market.outcome;
      } else {
        const eventEndTs = new Date(ud.eventEndTime).getTime() / 1000;
        const laterSnap = snapshots.find(s => s.timestamp > eventEndTs);
        outcome = (laterSnap ?? snapshots[snapshots.length - 1]).currentPrice > ud.startPrice ? "UP" : "DOWN";
      }
      exitPrice = outcome === pick.dir ? 1.0 : 0.0;
      exitMinute = 15;
    }

    // PnL: (exit - entry) * shares
    const pnl = (exitPrice - pick.entryPrice) * shares;
    bankroll += pnl;
    if (bankroll < 0) bankroll = 0;

    // If we exited early, allow re-entry into same market
    if (exitReason === "spread_captured") {
      bettedSlugs.delete(ud.slug);
    }

    trades.push({
      timestamp: snap.timestamp,
      datetime: snap.datetime,
      slug: ud.slug,
      direction: pick.dir,
      synthProb,
      entryPrice: pick.entryPrice,
      exitPrice,
      exitMinute,
      betAmount,
      pnl,
      pnlPct: pnl / betAmount,
      holdMinutes: exitMinute,
      exitReason,
      bankrollAfter: bankroll,
    });
  }

  return { trades, skipped };
}

async function main() {
  program
    .option("--synth-dir <dir>", "Synth snapshots directory", "data/synth-snapshots")
    .option("--polymarket-dir <dir>", "Polymarket data directory", "data/polymarket")
    .option("--output-dir <dir>", "Output directory", "data/results-spread")
    .option("--no-conviction", "Disable 50% conviction filter")
    .option("--fixed-bankroll", "Don't compound")
    .option("--start <time>", "Start time ISO8601")
    .option("--end <time>", "End time ISO8601")
    .parse();

  const opts = program.opts();
  await mkdir(opts.outputDir, { recursive: true });

  let snapshots = await loadSynthSnapshots(opts.synthDir);
  if (opts.start) snapshots = snapshots.filter(s => s.timestamp >= new Date(opts.start).getTime() / 1000);
  if (opts.end) snapshots = snapshots.filter(s => s.timestamp <= new Date(opts.end).getTime() / 1000);
  console.log(`Synth: ${snapshots.length} snapshots`);

  const markets = await loadPolymarketData(opts.polymarketDir);
  console.log(`Polymarket: ${markets.length} markets`);
  console.log();

  for (const scenario of SCENARIOS) {
    const { trades, skipped } = runSpreadScenario(scenario, snapshots, markets, opts.conviction, opts.fixedBankroll);

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const totalWon = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLost = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
    const avgHold = trades.length > 0 ? trades.reduce((s, t) => s + t.holdMinutes, 0) / trades.length : 0;

    // Exit reason breakdown
    const byReason: Record<string, number> = {};
    for (const t of trades) byReason[t.exitReason] = (byReason[t.exitReason] ?? 0) + 1;

    const hitRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(0) : "0";
    const pf = totalLost > 0 ? (totalWon / totalLost).toFixed(2) : "∞";

    console.log(`${scenario.name.padEnd(18)} ${trades.length} trades (${skipped} skip) | ${wins.length}W/${losses.length}L (${hitRate}%) | PnL: $${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)} | PF: ${pf} | AvgHold: ${avgHold.toFixed(1)}min | Exit: ${Object.entries(byReason).map(([k,v]) => `${k}=${v}`).join(" ")}`);

    await writeFile(resolve(opts.outputDir, `spread-${scenario.name.toLowerCase().replace(/\s+/g, "-")}.json`), JSON.stringify({ scenario, trades, skipped }, null, 2));
  }
}

main().catch(console.error);
