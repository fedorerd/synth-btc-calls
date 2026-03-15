export interface SynthUpDownResponse {
  slug: string;
  start_price: number;
  current_time: string;
  best_ask_size: number;
  best_bid_size: number;
  current_price: number;
  synth_outcome: "Up" | "Down";
  best_ask_price: number;
  best_bid_price: number;
  event_best_ask: number;
  event_best_bid: number;
  event_end_time: string;
  current_outcome: "Up" | "Down";
  event_start_time: string;
  polymarket_outcome: "Up" | "Down";
  event_creation_time: string;
  forecast_start_time: string;
  event_outcome_prices: [string, string]; // [up, down]
  synth_probability_up: number;
  event_last_trade_price: number;
  polymarket_probability_up: number;
  polymarket_last_trade_time: string;
  polymarket_last_trade_price: number;
  polymarket_last_trade_outcome: "Up" | "Down";
}

export interface SynthPercentileStep {
  "0.005": number;
  "0.05": number;
  "0.2": number;
  "0.35": number;
  "0.5": number;
  "0.65": number;
  "0.8": number;
  "0.95": number;
  "0.995": number;
}

export interface SynthPercentilesResponse {
  current_price: number;
  forecast_start_time: string;
  forecast_future: {
    percentiles: SynthPercentileStep[];
  };
}

export interface SynthLPProbabilitiesResponse {
  current_price: number;
  forecast_start_time: string;
  data: {
    "24h": {
      probability_above: Record<string, number>;
      probability_below: Record<string, number>;
    };
  };
}

export type TermStructureShape =
  | "steep_bullish"
  | "steep_bearish"
  | "humped"
  | "inverted"
  | "flat"
  | "accelerating_bull"
  | "accelerating_bear"
  | "mixed";

export interface TermStructure {
  asset: string;
  pUp15min: number;
  pUp1h: number;
  pUp24h: number;
  polyPUp15min: number;
  polyPUp1h: number;
  polyPUp24h: number;
  slope: number;
  curvature: number;
  shape: TermStructureShape;
  consistencyScore: number;
}

export interface DistributionAnalysis {
  asset: string;
  horizon: "1h" | "24h";
  cdfPoints: { price: number; cumulativeProb: number }[];
  pUp: number;
  pDown: number;
  coneWidthPct: number;
  pdfAtReference: number;
  skew: number;
  percentile5: number;
  percentile50: number;
  percentile95: number;
}

export interface KellyResult {
  naiveKelly: number;
  sensitivityFactor: number;
  uncertaintyFactor: number;
  skewFactor: number;
  distributionKelly: number;
  finalFraction: number;
  betAmount: number;
  expectedValue: number;
  potentialProfit: number;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type Direction = "UP" | "DOWN";
export type Timeframe = "15min" | "hourly" | "daily";

export interface OpportunityScore {
  score: number;
  direction: Direction;
  edge: number;
  netEdge: number;
  spreadCost: number;
  liquidity: number;
}

export interface BetRecommendation {
  asset: string;
  timeframe: Timeframe;
  direction: Direction;
  betAmount: number;
  entryPrice: number;
  synthFairValue: number;
  edge: number;
  netEdge: number;
  kelly: KellyResult;
  expectedValue: number;
  confidence: Confidence;
  termStructure: TermStructure;
  distribution: DistributionAnalysis;
  reasoning: string[];
  opportunityScore: number;
  timestamp: string;
  polymarketSlug: string;
  marketData: {
    currentPrice: number;
    startPrice: number;
    polymarketProbUp: number;
    synthProbUp: number;
    bestBidPrice: number;
    bestAskPrice: number;
    bestBidSize: number;
    bestAskSize: number;
  };
  liveOrderbook: {
    bestBid: number;
    bestAsk: number;
    spread: number;
    bidDepth: number;
    askDepth: number;
    lastTradePrice: number;
  } | null;
}

export type NoTradeReason =
  | "edge_below_threshold"
  | "negative_net_edge"
  | "low_liquidity"
  | "flat_term_structure"
  | "low_consistency";

export interface NoTradeRecommendation {
  asset: string;
  timeframe: Timeframe;
  reason: NoTradeReason;
  details: string;
  edge: number;
  netEdge: number;
  termStructure: TermStructure;
}

export type Recommendation = BetRecommendation | NoTradeRecommendation;

export function isBetRecommendation(r: Recommendation): r is BetRecommendation {
  return "betAmount" in r;
}

export interface UserSettings {
  bankroll: number;
  riskTolerance: number;
  minEdgeThreshold: number;
  maxKellyFraction: number;
  useDistributionAdjustments: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  bankroll: 0,
  riskTolerance: 0.5,
  minEdgeThreshold: 0.03,
  maxKellyFraction: 0.15,
  useDistributionAdjustments: true,
};
