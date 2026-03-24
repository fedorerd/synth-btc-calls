import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import { program } from "commander";
import { writeFile, mkdir } from "fs/promises";
import type { PolymarketSnapshot } from "./lib/types.js";
import { groupBy } from "./lib/stats.js";

const API_BASE = "https://api.predexon.com";

type Timeframe = "5m" | "15m" | "1h" | "4h" | "daily";

interface PredexonMarket {
  condition_id: string;
  market_slug: string;
  title: string;
  asset: string;
  timeframe: string;
  status: string;
  winning_side: string | null;
  up_price: number | null;
  down_price: number | null;
  up_token_id: string;
  down_token_id: string;
  start_time: string | null;
  end_time: string | null;
  total_volume_usd: number;
  liquidity_usd: number;
}

interface OrderbookSnapshot {
  asks: { size: number; price: number }[];
  bids: { size: number; price: number }[];
  timestamp: number; // ms
  assetId: string;
  market: string;
}

const TIMEFRAME_MAP: Record<string, "15min" | "hourly" | "daily"> = {
  "5m": "15min",
  "15m": "15min",
  "1h": "hourly",
  "4h": "hourly",
  "daily": "daily",
};

const TIMEFRAME_DURATION_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "daily": 24 * 60 * 60_000,
};

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries && err instanceof Error &&
        (err.message.includes("429") || err.message.includes("RATE"))) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`  Rate limited, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

function nextResolutionBoundary(timeframe: Timeframe): number {
  const now = Math.floor(Date.now() / 1000);
  const intervals: Record<Timeframe, number> = {
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "daily": 86400,
  };
  const interval = intervals[timeframe];
  return Math.ceil(now / interval) * interval;
}

async function fetchMarkets(
  apiKey: string,
  timeframe: Timeframe,
  startDate?: string,
  endDate?: string,
  asset: string = "btc",
): Promise<PredexonMarket[]> {
  const allMarkets: PredexonMarket[] = [];
  let offset = 0;
  const limit = 200;

  const toUnix = (d: string) => {
    if (d.includes("T")) return Math.floor(new Date(d).getTime() / 1000);
    return Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000);
  };
  const endAfter = startDate ? toUnix(startDate) : undefined;
  const endBefore = endDate ? toUnix(endDate) : nextResolutionBoundary(timeframe);

  console.log(`  end_after=${endAfter} end_before=${endBefore} (${new Date(endBefore * 1000).toISOString()})`);

  while (true) {
    let url = `${API_BASE}/v2/polymarket/crypto-updown?asset=${asset}&timeframe=${timeframe}&sort=asc&limit=${limit}&offset=${offset}`;
    if (endAfter) url += `&end_after=${endAfter}`;
    if (endBefore) url += `&end_before=${endBefore}`;
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });

    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const markets: PredexonMarket[] = data.markets ?? [];

    if (markets.length === 0) break;
    allMarkets.push(...markets);
    offset += markets.length;

    if (!data.pagination?.has_more) break;
    await new Promise(r => setTimeout(r, 100));
  }

  return allMarkets;
}

async function fetchOrderbooks(
  apiKey: string,
  tokenId: string,
  startTimeMs: number,
  endTimeMs: number,
  minuteOnly: boolean = false,
): Promise<OrderbookSnapshot[]> {
  // If minuteOnly, fetch one snapshot per minute instead of all snapshots
  if (minuteOnly) {
    const all: OrderbookSnapshot[] = [];
    const intervalMs = 60_000;
    for (let t = startTimeMs; t < endTimeMs; t += intervalMs) {
      // Fetch a 2-second window around each minute mark
      const windowStart = t;
      const windowEnd = t + 2000;
      const url = `${API_BASE}/v2/polymarket/orderbooks?token_id=${tokenId}&start_time=${windowStart}&end_time=${windowEnd}&limit=1`;
      try {
        const res = await fetch(url, { headers: { "x-api-key": apiKey } });
        if (!res.ok) continue;
        const data = await res.json();
        const snapshots: OrderbookSnapshot[] = data.snapshots ?? [];
        if (snapshots.length > 0) all.push(snapshots[0]);
      } catch {}
    }
    return all;
  }

  const all: OrderbookSnapshot[] = [];
  let paginationKey: string | null = null;

  while (true) {
    let url = `${API_BASE}/v2/polymarket/orderbooks?token_id=${tokenId}&start_time=${startTimeMs}&end_time=${endTimeMs}&limit=200`;
    if (paginationKey) url += `&pagination_key=${encodeURIComponent(paginationKey)}`;

    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const snapshots: OrderbookSnapshot[] = data.snapshots ?? [];
    all.push(...snapshots);

    if (!data.pagination?.has_more || !data.pagination?.pagination_key) break;
    paginationKey = data.pagination.pagination_key;
    await new Promise(r => setTimeout(r, 50));
  }

  return all;
}

function extractBestBidAsk(
  orderbook: OrderbookSnapshot,
): { bestBid: number; bestAsk: number } {
  const bids = orderbook.bids.filter(b => b.size > 0);
  const asks = orderbook.asks.filter(a => a.size > 0);

  const bestBid = bids.length > 0 ? Math.max(...bids.map(b => b.price)) : 0;
  const bestAsk = asks.length > 0 ? Math.min(...asks.map(a => a.price)) : 1;

  return { bestBid, bestAsk };
}

function toPolymarketSnapshot(
  market: PredexonMarket,
  upBooks: OrderbookSnapshot[],
  downBooks: OrderbookSnapshot[],
): PolymarketSnapshot | null {
  const timeframe = TIMEFRAME_MAP[market.timeframe];
  if (!timeframe) return null;

  const winner = market.winning_side?.toLowerCase();
  const outcome = winner === "up" ? "UP" as const
    : winner === "down" ? "DOWN" as const
    : null;
  const firstUp = upBooks[0] ?? null;
  const firstDown = downBooks[0] ?? null;

  const upBA = firstUp
    ? extractBestBidAsk(firstUp)
    : { bestBid: (market.up_price ?? 0.5) - 0.01, bestAsk: (market.up_price ?? 0.5) + 0.01 };

  const downBA = firstDown
    ? extractBestBidAsk(firstDown)
    : { bestBid: (market.down_price ?? 0.5) - 0.01, bestAsk: (market.down_price ?? 0.5) + 0.01 };

  const duration = TIMEFRAME_DURATION_MS[market.timeframe] ?? 3600_000;
  const marketStartMs = market.end_time
    ? new Date(market.end_time).getTime() - duration
    : 0;

  const timestamp = firstUp
    ? Math.floor(firstUp.timestamp / 1000)
    : marketStartMs > 0
      ? Math.floor(marketStartMs / 1000)
      : 0;

  if (timestamp === 0) return null;

  const toBook = (snaps: OrderbookSnapshot[]) =>
    snaps.map(s => ({ bids: s.bids, asks: s.asks, timestamp: s.timestamp }));

  return {
    timestamp,
    timeframe,
    marketConditionId: market.condition_id,
    marketSlug: market.market_slug,
    upTokenId: market.up_token_id,
    downTokenId: market.down_token_id,
    startTime: marketStartMs > 0 ? new Date(marketStartMs).toISOString() : "",
    endTime: market.end_time ?? "",
    upBestBid: upBA.bestBid,
    upBestAsk: upBA.bestAsk,
    downBestBid: downBA.bestBid,
    downBestAsk: downBA.bestAsk,
    upMidPrice: (upBA.bestBid + upBA.bestAsk) / 2,
    outcome,
    referencePrice: 0,
    actualPriceAtResolution: null,
    orderbook: (upBooks.length > 0 || downBooks.length > 0) ? {
      up: upBooks.length > 0 ? toBook(upBooks) : null,
      down: downBooks.length > 0 ? toBook(downBooks) : null,
    } : null,
  };
}

async function main() {
  program
    .option("--api-key <key>", "Predexon API key (or set PREDEXON_API_KEY env var)", process.env.PREDEXON_API_KEY)
    .option("--start-date <date>", "Start date YYYY-MM-DD or ISO8601", "2026-03-14T23:00:00Z")
    .option("--output-dir <dir>", "Output directory", "data/polymarket")
    .option("--end-date <date>", "End date YYYY-MM-DD or ISO8601 (default: next resolution boundary)")
    .option("--asset <asset>", "Asset to collect (btc, eth, sol)", "btc")
    .option("--timeframes <types>", "Comma-separated timeframes", "15m,1h,daily")
    .option("--minute-only", "Fetch one orderbook snapshot per minute instead of all")
    .parse();

  const opts = program.opts();
  if (!opts.apiKey) { console.error("Predexon API key required (--api-key or PREDEXON_API_KEY)"); process.exit(1); }
  await mkdir(opts.outputDir, { recursive: true });

  const timeframes = opts.timeframes.split(",") as Timeframe[];

  console.log(`Collecting Polymarket data via Predexon (${opts.asset.toUpperCase()})`);
  console.log(`  Start: ${opts.startDate}${opts.endDate ? ` → End: ${opts.endDate}` : ""}`);
  console.log(`  Timeframes: ${timeframes.join(", ")}`);
  console.log(`  Orderbooks: enabled`);

  const allSnapshots: PolymarketSnapshot[] = [];

  for (const tf of timeframes) {
    console.log(`\n--- ${tf} markets ---`);

    const markets = await fetchWithRetry(() => fetchMarkets(opts.apiKey, tf, opts.startDate, opts.endDate, opts.asset));
    const resolved = markets.filter(m => m.winning_side);
    console.log(`  Total: ${markets.length} (${resolved.length} resolved, ${markets.length - resolved.length} open)`);

    let collected = 0;

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];

      try {
        let upBooks: OrderbookSnapshot[] = [];
        let downBooks: OrderbookSnapshot[] = [];

        if (market.end_time) {
          const endMs = new Date(market.end_time).getTime();
          const duration = TIMEFRAME_DURATION_MS[market.timeframe] ?? 3600_000;
          const startMs = endMs - duration;

          process.stdout.write(`    ${market.market_slug} orderbooks...`);
          [upBooks, downBooks] = await Promise.all([
            fetchWithRetry(() => fetchOrderbooks(opts.apiKey, market.up_token_id, startMs, endMs, opts.minuteOnly)),
            fetchWithRetry(() => fetchOrderbooks(opts.apiKey, market.down_token_id, startMs, endMs, opts.minuteOnly)),
          ]);
          process.stdout.write(` ${upBooks.length} up + ${downBooks.length} down\n`);
        }

        const snap = toPolymarketSnapshot(market, upBooks, downBooks);
        if (snap) {
          allSnapshots.push(snap);
          collected++;
        }
      } catch (err) {
        console.warn(`  Error on ${market.market_slug}: ${err instanceof Error ? err.message : err}`);
      }

      if ((i + 1) % 50 === 0 || i === markets.length - 1) {
        process.stdout.write(`  ${i + 1}/${markets.length} (${collected} collected)\r`);
      }

      if (i % 5 === 4) await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n  Collected ${collected} snapshots for ${tf}`);
  }

  const byTimeframe = groupBy(allSnapshots, s => s.timeframe);
  for (const [timeframe, snapshots] of Object.entries(byTimeframe)) {
    const tfDir = `${opts.outputDir}/${timeframe}`;
    await mkdir(tfDir, { recursive: true });

    for (const snap of snapshots) {
      const slug = snap.marketSlug || snap.marketConditionId.slice(0, 16);
      const outPath = `${tfDir}/${slug}.json`;
      await writeFile(outPath, JSON.stringify(snap));
    }

    const index = snapshots
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(s => ({
        timestamp: s.timestamp,
        marketSlug: s.marketSlug,
        startTime: s.startTime,
        endTime: s.endTime,
        upBestBid: s.upBestBid,
        upBestAsk: s.upBestAsk,
        upMidPrice: s.upMidPrice,
        outcome: s.outcome,
        file: `${s.marketSlug || s.marketConditionId.slice(0, 16)}.json`,
      }));
    await writeFile(`${tfDir}/index.json`, JSON.stringify(index, null, 2));

    console.log(`Written ${snapshots.length} markets → ${tfDir}/ (+ index.json)`);
  }

  console.log(`\nDone. Total: ${allSnapshots.length} markets across ${Object.keys(byTimeframe).length} timeframes`);
}

main().catch(err => { console.error(err); process.exit(1); });
