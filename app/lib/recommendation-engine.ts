import type {
  BetRecommendation,
  NoTradeRecommendation,
  Recommendation,
  Confidence,
  UserSettings,
  Direction,
  Timeframe,
} from "./types";
import type { AllSynthData } from "./synth-client";
import { buildTermStructure, rankOpportunities, shapeDisplayName } from "./term-structure";
import { buildDistributionAnalysis } from "./distribution";
import { kellyFromDistribution } from "./kelly";
import { fetchLiveOrderbook, type LiveOrderbook } from "./polymarket-client";

function determineConfidence(
  netEdge: number,
  consistencyScore: number,
  coneWidthPct: number,
): Confidence {
  const edgeStrong = netEdge > 0.08;
  const consistent = consistencyScore > 0.85;
  const narrow = coneWidthPct < 0.003;

  if (edgeStrong && consistent && narrow) return "HIGH";
  if (netEdge > 0.04 && consistencyScore > 0.7) return "MEDIUM";
  return "LOW";
}

function buildReasoning(
  timeframe: Timeframe,
  direction: Direction,
  synthProb: number,
  polyProb: number,
  edge: number,
  netEdge: number,
  spreadCost: number,
  pUp15min: number,
  pUp1h: number,
  pUp24h: number,
  shapeName: string,
  consistencyScore: number,
  coneWidthPct: number,
  pdfAtReference: number,
  skew: number,
  naiveKelly: number,
  sensitivityFactor: number,
  uncertaintyFactor: number,
  skewFactor: number,
  distributionKelly: number,
  betAmount: number,
  bankroll: number,
  percentile5: number,
  currentPrice: number,
  riskTolerance: number,
  finalFraction: number,
): string[] {
  const synthProbDir = direction === "UP" ? synthProb : 1 - synthProb;
  const polyProbDir = direction === "UP" ? polyProb : 1 - polyProb;

  return [
    `1. OPPORTUNITY DETECTION`,
    `   Synth says ${(synthProbDir * 100).toFixed(1)}% probability BTC goes ${direction.toLowerCase()} in next ${timeframe}.`,
    `   Polymarket prices ${direction} at ${(polyProbDir * 100).toFixed(1)}%.`,
    `   Raw edge: ${(edge * 100).toFixed(1)}%.`,
    `   After spread cost ($${spreadCost.toFixed(2)}): net edge = ${(netEdge * 100).toFixed(1)}%.`,
    ``,
    `2. TERM STRUCTURE CONFIRMATION`,
    `   15-min: ${(pUp15min * 100).toFixed(0)}% up`,
    `   1-hour: ${(pUp1h * 100).toFixed(0)}% up`,
    `   24-hour: ${(pUp24h * 100).toFixed(0)}% up`,
    `   Shape: ${shapeName}`,
    `   Cross-timeframe consistency: ${(consistencyScore * 100).toFixed(0)}%.`,
    ``,
    `3. DISTRIBUTION ANALYSIS`,
    `   Prediction cone width (5th-95th): ${(coneWidthPct * 100).toFixed(2)}% of price.`,
    `   PDF at reference price: ${pdfAtReference.toFixed(4)}.`,
    `   ${pdfAtReference < 0.03 ? "→ Outcome is decisive, not coin-flippy." : "→ Outcome sensitive to small moves."}`,
    `   Skew: ${(skew * 100).toFixed(2)}%. ${skew > 0 ? "Right-skewed (favors UP)." : "Left-skewed (favors DOWN)."}`,
    ``,
    `4. POSITION SIZING`,
    `   Naive Kelly: ${(naiveKelly * 100).toFixed(1)}% of bankroll ($${(naiveKelly * bankroll).toFixed(0)})`,
    ...(sensitivityFactor !== 1 ? [`   Sensitivity adjustment: ×${sensitivityFactor.toFixed(2)}`] : []),
    ...(uncertaintyFactor !== 1 ? [`   Uncertainty adjustment: ×${uncertaintyFactor.toFixed(2)}`] : []),
    ...(Math.abs(skewFactor - 1) > 0.001 ? [`   Skew adjustment: ×${skewFactor.toFixed(2)}`] : []),
    ...(distributionKelly !== naiveKelly
      ? [`   → Distribution-aware Kelly: ${(distributionKelly * 100).toFixed(1)}% of bankroll ($${(distributionKelly * bankroll).toFixed(0)})`]
      : []),
    ...(riskTolerance !== 1 ? [`   Risk tolerance: ×${riskTolerance} → ${(distributionKelly * riskTolerance * 100).toFixed(1)}%`] : []),
    ...(finalFraction < distributionKelly * riskTolerance
      ? [`   Hard cap: ${(finalFraction * 100).toFixed(0)}% max → ${(finalFraction * 100).toFixed(1)}%`]
      : []),
    `   → BET AMOUNT: $${betAmount.toFixed(2)}`,
    ``,
    `5. RISK CHECK`,
    `   5th percentile: $${percentile5.toFixed(0)} (${(((percentile5 - currentPrice) / currentPrice) * 100).toFixed(1)}% from current)`,
    `   Max loss on this bet: $${betAmount.toFixed(2)}.`,
    `   Worst-case portfolio impact: -${((betAmount / bankroll) * 100).toFixed(1)}%.`,
  ];
}

export async function generateRecommendations(
  data: AllSynthData,
  settings: UserSettings,
): Promise<Recommendation[]> {
  const { upDown15min, upDownHourly, upDownDaily, percentiles1h, lpProbabilities } = data;

  const termStructure = buildTermStructure(upDown15min, upDownHourly, upDownDaily);
  const ranked = rankOpportunities(
    upDown15min,
    upDownHourly,
    upDownDaily,
    termStructure.consistencyScore,
  );

  const recommendations: Recommendation[] = [];

  for (const opp of ranked) {
    const { timeframe, score, upDownData } = opp;

    const referencePrice = upDownData.start_price;
    const distribution = buildDistributionAnalysis(
      lpProbabilities,
      percentiles1h,
      referencePrice,
    );

    if (score.edge < settings.minEdgeThreshold) {
      recommendations.push({
        asset: "BTC",
        timeframe,
        reason: "edge_below_threshold",
        details: `Edge ${(score.edge * 100).toFixed(1)}% below ${(settings.minEdgeThreshold * 100).toFixed(0)}% threshold.`,
        edge: score.edge,
        netEdge: score.netEdge,
        termStructure,
      } satisfies NoTradeRecommendation);
      continue;
    }

    if (score.netEdge <= 0) {
      recommendations.push({
        asset: "BTC",
        timeframe,
        reason: "negative_net_edge",
        details: `Edge ${(score.edge * 100).toFixed(1)}% doesn't cover spread cost ($${score.spreadCost.toFixed(2)}).`,
        edge: score.edge,
        netEdge: score.netEdge,
        termStructure,
      } satisfies NoTradeRecommendation);
      continue;
    }

    if (termStructure.shape === "flat" && termStructure.consistencyScore < 0.6) {
      recommendations.push({
        asset: "BTC",
        timeframe,
        reason: "flat_term_structure",
        details: "No conviction across timeframes and low consistency.",
        edge: score.edge,
        netEdge: score.netEdge,
        termStructure,
      } satisfies NoTradeRecommendation);
      continue;
    }

    const kelly = kellyFromDistribution(
      distribution,
      upDownData.polymarket_probability_up,
      score.direction,
      upDownData.current_price,
      settings.bankroll,
      settings.riskTolerance,
      settings.useDistributionAdjustments,
      settings.maxKellyFraction,
    );

    if (kelly.betAmount <= 0) {
      recommendations.push({
        asset: "BTC",
        timeframe,
        reason: "edge_below_threshold",
        details: "Kelly sizing produced zero bet — edge insufficient after adjustments.",
        edge: score.edge,
        netEdge: score.netEdge,
        termStructure,
      } satisfies NoTradeRecommendation);
      continue;
    }

    const confidence = determineConfidence(
      score.netEdge,
      termStructure.consistencyScore,
      distribution.coneWidthPct,
    );

    const liveBooks = await fetchLiveOrderbook(upDownData.slug);
    const liveBook: LiveOrderbook | null = score.direction === "UP" ? liveBooks.up : liveBooks.down;

    const entryPrice = liveBook
      ? liveBook.bestAsk
      : score.direction === "UP"
        ? upDownData.best_ask_price
        : 1 - upDownData.best_bid_price;

    const synthFairValue =
      score.direction === "UP"
        ? upDownData.synth_probability_up
        : 1 - upDownData.synth_probability_up;

    const reasoning = buildReasoning(
      timeframe,
      score.direction,
      upDownData.synth_probability_up,
      upDownData.polymarket_probability_up,
      score.edge,
      score.netEdge,
      score.spreadCost,
      termStructure.pUp15min,
      termStructure.pUp1h,
      termStructure.pUp24h,
      shapeDisplayName(termStructure.shape),
      termStructure.consistencyScore,
      distribution.coneWidthPct,
      distribution.pdfAtReference,
      distribution.skew,
      kelly.naiveKelly,
      kelly.sensitivityFactor,
      kelly.uncertaintyFactor,
      kelly.skewFactor,
      kelly.distributionKelly,
      kelly.betAmount,
      settings.bankroll,
      distribution.percentile5,
      upDownData.current_price,
      settings.riskTolerance,
      kelly.finalFraction,
    );

    recommendations.push({
      asset: "BTC",
      timeframe,
      direction: score.direction,
      betAmount: kelly.betAmount,
      entryPrice,
      synthFairValue,
      edge: score.edge,
      netEdge: score.netEdge,
      kelly,
      expectedValue: kelly.expectedValue,
      confidence,
      termStructure,
      distribution,
      reasoning,
      polymarketSlug: upDownData.slug,
      opportunityScore: Math.round(score.score * 100),
      timestamp: new Date().toISOString(),
      marketData: {
        currentPrice: upDownData.current_price,
        startPrice: upDownData.start_price,
        polymarketProbUp: upDownData.polymarket_probability_up,
        synthProbUp: upDownData.synth_probability_up,
        bestBidPrice: upDownData.best_bid_price,
        bestAskPrice: upDownData.best_ask_price,
        bestBidSize: upDownData.best_bid_size,
        bestAskSize: upDownData.best_ask_size,
      },
      liveOrderbook: liveBook,
    } satisfies BetRecommendation);
  }

  return recommendations;
}
