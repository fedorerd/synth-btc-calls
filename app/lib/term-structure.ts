import type {
  TermStructure,
  TermStructureShape,
  OpportunityScore,
  Direction,
  Timeframe,
  SynthUpDownResponse,
} from "./types";

const SLOPE_THRESHOLD = 0.10;
const CURVATURE_THRESHOLD = 0.10;

export function classifyShape(slope: number, curvature: number): TermStructureShape {
  const steepBull = slope > SLOPE_THRESHOLD;
  const steepBear = slope < -SLOPE_THRESHOLD;
  const highCurve = curvature > CURVATURE_THRESHOLD;
  const lowCurve = curvature < -CURVATURE_THRESHOLD;

  if (steepBull && highCurve) return "accelerating_bull";
  if (steepBear && lowCurve) return "accelerating_bear";
  if (steepBull) return "steep_bullish";
  if (steepBear) return "steep_bearish";
  if (highCurve) return "humped";
  if (lowCurve) return "inverted";
  return "flat";
}

export function computeConsistencyScore(pUp15min: number, pUp1h: number): number {
  return Math.max(0, 1 - Math.abs(pUp15min - pUp1h));
}

export function buildTermStructure(
  upDown15min: SynthUpDownResponse,
  upDownHourly: SynthUpDownResponse,
  upDownDaily: SynthUpDownResponse,
): TermStructure {
  const pUp15min = upDown15min.synth_probability_up;
  const pUp1h = upDownHourly.synth_probability_up;
  const pUp24h = upDownDaily.synth_probability_up;

  const slope = pUp24h - pUp15min;
  const curvature = pUp1h - (pUp15min + pUp24h) / 2;
  const shape = classifyShape(slope, curvature);
  const consistencyScore = computeConsistencyScore(pUp15min, pUp1h);

  return {
    asset: "BTC",
    pUp15min,
    pUp1h,
    pUp24h,
    polyPUp15min: upDown15min.polymarket_probability_up,
    polyPUp1h: upDownHourly.polymarket_probability_up,
    polyPUp24h: upDownDaily.polymarket_probability_up,
    slope,
    curvature,
    shape,
    consistencyScore,
  };
}

export function scoreOpportunity(
  synthProb: number,
  polymarketProb: number,
  bestBidSize: number,
  bestAskSize: number,
  bestBidPrice: number,
  bestAskPrice: number,
  consistencyScore: number,
): OpportunityScore {
  const edge = Math.abs(synthProb - polymarketProb);
  const direction: Direction = synthProb > polymarketProb ? "UP" : "DOWN";
  const liquidity = Math.min(bestBidSize, bestAskSize);
  const spreadCost = bestAskPrice - bestBidPrice;
  const netEdge = edge - spreadCost;
  const score = Math.max(0, netEdge * consistencyScore * Math.log(1 + liquidity));

  return { score, direction, edge, netEdge, spreadCost, liquidity };
}

export interface RankedOpportunity {
  timeframe: Timeframe;
  score: OpportunityScore;
  upDownData: SynthUpDownResponse;
}

export function rankOpportunities(
  upDown15min: SynthUpDownResponse,
  upDownHourly: SynthUpDownResponse,
  upDownDaily: SynthUpDownResponse,
  consistencyScore: number,
): RankedOpportunity[] {
  const entries: { timeframe: Timeframe; data: SynthUpDownResponse }[] = [
    { timeframe: "15min", data: upDown15min },
    { timeframe: "hourly", data: upDownHourly },
    { timeframe: "daily", data: upDownDaily },
  ];

  const ranked = entries.map(({ timeframe, data }) => ({
    timeframe,
    score: scoreOpportunity(
      data.synth_probability_up,
      data.polymarket_probability_up,
      data.best_bid_size,
      data.best_ask_size,
      data.best_bid_price,
      data.best_ask_price,
      consistencyScore,
    ),
    upDownData: data,
  }));

  ranked.sort((a, b) => b.score.score - a.score.score);
  return ranked;
}

export function shapeDisplayName(shape: TermStructureShape): string {
  const names: Record<TermStructureShape, string> = {
    steep_bullish: "STEEP BULLISH",
    steep_bearish: "STEEP BEARISH",
    humped: "HUMPED",
    inverted: "INVERTED",
    flat: "FLAT",
    accelerating_bull: "ACCELERATING BULL",
    accelerating_bear: "ACCELERATING BEAR",
    mixed: "MIXED",
  };
  return names[shape];
}
