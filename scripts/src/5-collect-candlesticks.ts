import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { program } from "commander";
import { writeFile, readFile, mkdir } from "fs/promises";

const BASE_URL = "https://priceapi.dataengine.chain.link";
const USER_ID = process.env.CHAIN_LINK_CANDLESTICK_USER!;
const API_KEY = process.env.CHAIN_LINK_CANDLESTICK_API_KEY!;

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

let cachedToken: { token: string; expiration: number } | null = null;

async function authorize(): Promise<string> {
  if (cachedToken && cachedToken.expiration > Date.now() / 1000 + 60) {
    return cachedToken.token;
  }

  const res = await fetch(`${BASE_URL}/api/v1/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `login=${encodeURIComponent(USER_ID)}&password=${encodeURIComponent(API_KEY)}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.s !== "ok") throw new Error(`Auth error: ${JSON.stringify(data)}`);

  cachedToken = { token: data.d.access_token, expiration: data.d.expiration };
  console.log(`  [auth] token obtained, expires ${new Date(data.d.expiration * 1000).toISOString()}`);
  return cachedToken.token;
}

async function fetchCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const token = await authorize();

  const url = `${BASE_URL}/api/v1/history/rows?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Candles failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.s !== "ok") throw new Error(`Candles error: ${JSON.stringify(data)}`);

  return (data.candles || []).map((c: number[]) => ({
    time: c[0],
    open: c[1] / 1e18,
    high: c[2] / 1e18,
    low: c[3] / 1e18,
    close: c[4] / 1e18,
  }));
}

async function fetchSymbols(): Promise<string[]> {
  const token = await authorize();
  const res = await fetch(`${BASE_URL}/api/v1/symbol_info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.symbol || [];
}

async function collectAsset(
  symbol: string,
  resolution: string,
  fromTs: number,
  toTs: number,
  outputDir: string,
) {
  console.log(`\nCollecting ${symbol} ${resolution} candles: ${new Date(fromTs * 1000).toISOString()} → ${new Date(toTs * 1000).toISOString()}`);

  // Chainlink supports max 24h window for 1m resolution
  // Chunk into 24h windows
  const maxWindowSec = getMaxWindow(resolution);
  let allCandles: Candle[] = [];
  let chunkFrom = fromTs;

  while (chunkFrom < toTs) {
    const chunkTo = Math.min(chunkFrom + maxWindowSec, toTs);
    console.log(`  [chunk] ${new Date(chunkFrom * 1000).toISOString()} → ${new Date(chunkTo * 1000).toISOString()}`);

    const candles = await fetchCandles(symbol, resolution, chunkFrom, chunkTo);
    console.log(`    ${candles.length} candles`);
    allCandles.push(...candles);

    chunkFrom = chunkTo + 1;
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate by timestamp
  const seen = new Set<number>();
  allCandles = allCandles.filter(c => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  });
  allCandles.sort((a, b) => a.time - b.time);

  // Save
  const assetDir = `${outputDir}/${symbol.toLowerCase().replace("usd", "")}`;
  await mkdir(assetDir, { recursive: true });

  const dateStr = new Date(fromTs * 1000).toISOString().split("T")[0];
  const endDateStr = new Date(toTs * 1000).toISOString().split("T")[0];
  const filename = dateStr === endDateStr
    ? `${resolution}-${dateStr}.json`
    : `${resolution}-${dateStr}-to-${endDateStr}.json`;

  const outPath = `${assetDir}/${filename}`;

  // Try to merge with existing file
  try {
    const existing: Candle[] = JSON.parse(await readFile(outPath, "utf-8"));
    const merged = new Map<number, Candle>();
    for (const c of existing) merged.set(c.time, c);
    for (const c of allCandles) merged.set(c.time, c);
    allCandles = Array.from(merged.values()).sort((a, b) => a.time - b.time);
    console.log(`  Merged with existing (${existing.length} → ${allCandles.length} candles)`);
  } catch {}

  await writeFile(outPath, JSON.stringify(allCandles, null, 2));
  console.log(`  Saved ${allCandles.length} candles to ${outPath}`);

  return allCandles;
}

function getMaxWindow(resolution: string): number {
  // Return max window size in seconds for each resolution tier
  const val = parseInt(resolution);
  const unit = resolution.replace(/\d+/g, "");

  if (unit === "m" && val <= 1) return 24 * 3600;        // 1m → 24h chunks
  if (unit === "m" && val <= 5) return 5 * 24 * 3600;    // 5m → 5d chunks
  if (unit === "m" && val <= 30) return 30 * 24 * 3600;  // 30m → 30d chunks
  if (unit === "h" && val <= 1) return 90 * 24 * 3600;   // 1h → 90d chunks
  return 24 * 3600; // default 24h
}

// --- CLI ---
program
  .description("Collect OHLC candlestick data from Chainlink Data Streams")
  .option("--symbols <list>", "Comma-separated symbols (e.g. BTCUSD,ETHUSD,SOLUSD)", "BTCUSD,ETHUSD,SOLUSD")
  .option("--resolution <res>", "Candle resolution (1m, 5m, 15m, 1h, etc)", "1m")
  .option("--start <time>", "Start time ISO8601", "")
  .option("--end <time>", "End time ISO8601", "")
  .option("--days <n>", "Number of days back from now (default if no start/end)", "1")
  .option("--output-dir <dir>", "Output directory", "data/candlesticks")
  .option("--list-symbols", "List available symbols and exit")
  .parse();

const opts = program.opts();

async function main() {
  if (opts.listSymbols) {
    console.log("Fetching available symbols...");
    const symbols = await fetchSymbols();
    console.log(`Available symbols: ${symbols.join(", ")}`);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const fromTs = opts.start
    ? Math.floor(new Date(opts.start).getTime() / 1000)
    : now - Number(opts.days) * 24 * 3600;
  const toTs = opts.end
    ? Math.floor(new Date(opts.end).getTime() / 1000)
    : now;

  const symbols = opts.symbols.split(",").map((s: string) => s.trim().toUpperCase());

  console.log("Chainlink Candlestick Collector");
  console.log(`  Symbols: ${symbols.join(", ")}`);
  console.log(`  Resolution: ${opts.resolution}`);
  console.log(`  Range: ${new Date(fromTs * 1000).toISOString()} → ${new Date(toTs * 1000).toISOString()}`);
  console.log(`  Output: ${opts.outputDir}`);

  await mkdir(opts.outputDir, { recursive: true });

  for (const symbol of symbols) {
    try {
      await collectAsset(symbol, opts.resolution, fromTs, toTs, opts.outputDir);
    } catch (err) {
      console.error(`  ERROR collecting ${symbol}:`, err);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
