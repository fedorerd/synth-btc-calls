export interface PolymarketSnapshot {
  timestamp: number;
  timeframe: "15min" | "hourly" | "daily";
  marketConditionId: string;
  marketSlug: string;
  upTokenId: string;
  downTokenId: string;
  startTime: string;
  endTime: string;
  upBestBid: number;
  upBestAsk: number;
  downBestBid: number;
  downBestAsk: number;
  upMidPrice: number;
  outcome: "UP" | "DOWN" | null;
  referencePrice: number;
  actualPriceAtResolution: number | null;
  orderbook: {
    up: { bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; timestamp: number }[] | null;
    down: { bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; timestamp: number }[] | null;
  } | null;
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
