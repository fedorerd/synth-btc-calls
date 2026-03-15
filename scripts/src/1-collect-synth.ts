import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import { program } from "commander";
import { writeFile, readFile, mkdir } from "fs/promises";

const API_BASE = "https://api.synthdata.co/insights";

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

function getApiKey(): string {
  const key = process.env.SYNTH_API_KEY;
  if (!key) { console.error("SYNTH_API_KEY required in .env"); process.exit(1); }
  return key;
}

async function fetchEndpoint<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Apikey ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`  [warn] ${path}: ${res.status}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    console.warn(`  [warn] ${path}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function parseUpDown(data: Record<string, unknown>): UpDownData {
  return {
    synthProbUp: Number(data.synth_probability_up ?? 0),
    polymarketProbUp: Number(data.polymarket_probability_up ?? 0),
    startPrice: Number(data.start_price ?? 0),
    currentPrice: Number(data.current_price ?? 0),
    bestBidPrice: Number(data.best_bid_price ?? 0),
    bestAskPrice: Number(data.best_ask_price ?? 0),
    bestBidSize: Number(data.best_bid_size ?? 0),
    bestAskSize: Number(data.best_ask_size ?? 0),
    eventEndTime: String(data.event_end_time ?? ""),
    slug: String(data.slug ?? ""),
  };
}

async function collectSnapshot(apiKey: string): Promise<InsightSnapshot> {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const ud15 = await fetchEndpoint<Record<string, unknown>>("/polymarket/up-down/15min?asset=BTC", apiKey);
  await delay(150);
  const ud1h = await fetchEndpoint<Record<string, unknown>>("/polymarket/up-down/hourly?asset=BTC", apiKey);
  await delay(150);
  const ud24h = await fetchEndpoint<Record<string, unknown>>("/polymarket/up-down/daily?asset=BTC", apiKey);
  await delay(150);
  const pctls = await fetchEndpoint<Record<string, unknown>>("/prediction-percentiles?asset=BTC&horizon=1h", apiKey);
  await delay(150);
  const lp = await fetchEndpoint<Record<string, unknown>>("/lp-probabilities?asset=BTC", apiKey);

  let percentiles: Record<string, number> | null = null;
  if (pctls?.forecast_future) {
    const steps = (pctls.forecast_future as Record<string, unknown>).percentiles as Record<string, number>[];
    if (Array.isArray(steps) && steps.length > 0) {
      percentiles = steps[steps.length - 1];
    }
  }

  let lpProbs: Record<string, number> | null = null;
  if (lp?.data) {
    const d = lp.data as Record<string, Record<string, Record<string, number>>>;
    lpProbs = d["24h"]?.probability_below ?? null;
  }

  const currentPrice = Number(ud1h?.current_price ?? ud15?.current_price ?? ud24h?.current_price ?? 0);

  return {
    timestamp: Math.floor(Date.now() / 1000),
    datetime: new Date().toISOString(),
    currentPrice,
    upDown15min: ud15 ? parseUpDown(ud15) : null,
    upDown1h: ud1h ? parseUpDown(ud1h) : null,
    upDown24h: ud24h ? parseUpDown(ud24h) : null,
    percentiles,
    lpProbabilities: lpProbs,
  };
}

async function main() {
  program
    .option("--output-dir <dir>", "Output directory", "data/synth-snapshots")
    .option("--once", "Collect once and exit (no loop)", false)
    .parse();

  const opts = program.opts();
  const apiKey = getApiKey();
  await mkdir(opts.outputDir, { recursive: true });

  console.log("Synth Insights Collector");
  console.log(`  Output: ${opts.outputDir}`);
  console.log(`  Mode: ${opts.once ? "single snapshot" : "every minute at :00"}`);

  const getFilename = () => {
    const date = new Date().toISOString().split("T")[0];
    return `${opts.outputDir}/btc-${date}.json`;
  };

  const collect = async () => {
    const snapshot = await collectSnapshot(apiKey);
    const filename = getFilename();

    let existing: InsightSnapshot[] = [];
    try {
      const content = await readFile(filename, "utf-8");
      existing = JSON.parse(content);
    } catch {}

    existing.push(snapshot);
    await writeFile(filename, JSON.stringify(existing, null, 2));

    const price = snapshot.currentPrice > 0 ? `$${snapshot.currentPrice.toLocaleString()}` : "N/A";
    const pUp = snapshot.upDown1h?.synthProbUp;
    console.log(`  [${snapshot.datetime}] BTC ${price} | P(up 1h): ${pUp != null ? (pUp * 100).toFixed(1) + "%" : "N/A"} | ${existing.length} snapshots today`);
  };

  await collect();

  if (opts.once) {
    console.log("Done (single snapshot).");
    return;
  }

  console.log(`\nPolling at :00 of every minute... (Ctrl+C to stop)\n`);

  const scheduleNext = () => {
    const now = Date.now();
    const msUntilNextMinute = 60_000 - (now % 60_000);
    setTimeout(async () => {
      await collect();
      scheduleNext();
    }, msUntilNextMinute);
  };
  scheduleNext();
}

main().catch(err => { console.error(err); process.exit(1); });
