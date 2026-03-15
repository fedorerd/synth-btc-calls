import type {
  SynthUpDownResponse,
  SynthPercentilesResponse,
  SynthLPProbabilitiesResponse,
} from "./types";

const BASE_URL = "https://api.synthdata.co/insights";

function getApiKey(): string {
  const key = process.env.SYNTH_API_KEY;
  if (!key) throw new Error("SYNTH_API_KEY not set");
  return key;
}

async function fetchSynth<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Apikey ${getApiKey()}` },
    next: { revalidate: 5 }
  });
  if (!res.ok) {
    throw new Error(`Synth API error: ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json() as Promise<T>;
}

async function getUpDown15min(): Promise<SynthUpDownResponse> {
  return fetchSynth<SynthUpDownResponse>("/polymarket/up-down/15min?asset=BTC");
}

async function getUpDownHourly(): Promise<SynthUpDownResponse> {
  return fetchSynth<SynthUpDownResponse>("/polymarket/up-down/hourly?asset=BTC");
}

async function getUpDownDaily(): Promise<SynthUpDownResponse> {
  return fetchSynth<SynthUpDownResponse>("/polymarket/up-down/daily?asset=BTC");
}

async function getPredictionPercentiles(
  horizon: "1h" | "24h" = "1h",
): Promise<SynthPercentilesResponse> {
  return fetchSynth<SynthPercentilesResponse>(
    `/prediction-percentiles?asset=BTC&horizon=${horizon}`,
  );
}

async function getLPProbabilities(): Promise<SynthLPProbabilitiesResponse> {
  return fetchSynth<SynthLPProbabilitiesResponse>("/lp-probabilities?asset=BTC");
}

export interface AllSynthData {
  upDown15min: SynthUpDownResponse;
  upDownHourly: SynthUpDownResponse;
  upDownDaily: SynthUpDownResponse;
  percentiles1h: SynthPercentilesResponse;
  lpProbabilities: SynthLPProbabilitiesResponse;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchAllSynthData(): Promise<AllSynthData> {
  const upDown15min = await getUpDown15min();
  await delay(120);
  const upDownHourly = await getUpDownHourly();
  await delay(120);
  const upDownDaily = await getUpDownDaily();
  await delay(120);
  const percentiles1h = await getPredictionPercentiles("1h");
  await delay(120);
  const lpProbabilities = await getLPProbabilities();

  return { upDown15min, upDownHourly, upDownDaily, percentiles1h, lpProbabilities };
}
