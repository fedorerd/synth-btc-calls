import type { KellyResult, Direction, DistributionAnalysis } from "./types";

interface KellyInputs {
  pUp: number;
  marketPrice: number; // up price
  direction: Direction;
  pdfAtReference: number;
  coneWidthPct: number;
  percentile5: number;
  percentile50: number;
  percentile95: number;
  currentPrice: number;
  bankroll: number;
  riskTolerance: number;
  maxKellyFraction: number;
  useDistributionAdjustments: boolean;
}
const PDF_BASELINE = 0.05;

function computeKelly(inputs: KellyInputs): KellyResult {
  const {
    pUp,
    marketPrice,
    direction,
    pdfAtReference,
    coneWidthPct,
    percentile5,
    percentile50,
    percentile95,
    bankroll,
    riskTolerance,
  } = inputs;

  // --- Naive Kelly ---
  // Buying "Up" at price m: profit if Up = (1-m), loss if Down = m
  // Buying "Down" at price (1-m): profit if Down = m, loss if Up = (1-m)
  const naiveKelly =
    direction === "UP"
      ? (pUp - marketPrice) / (1 - marketPrice)
      : (1 - pUp - (1 - marketPrice)) / marketPrice;

  // --- Distribution adjustment factors (can be disabled for "Raw Signal" mode) ---
  const useAdj = inputs.useDistributionAdjustments;

  const pdfNormalized = Math.min(pdfAtReference / PDF_BASELINE, 1);
  const sensitivityFactor = useAdj ? 1 - 0.3 * pdfNormalized : 1;
  
  const uncertaintyFactor = useAdj ? 1 / (1 + coneWidthPct * 10) : 1;

  const rightTail = percentile95 - percentile50;
  const leftTail = percentile50 - percentile5;
  const coneWidth = rightTail + leftTail;
  const rawSkew = coneWidth > 0
    ? (direction === "UP"
        ? (rightTail - leftTail) / coneWidth
        : (leftTail - rightTail) / coneWidth)
    : 0;
  const skewFactor = useAdj ? 1 + 0.2 * rawSkew : 1;

  const distributionKelly =
    naiveKelly * sensitivityFactor * uncertaintyFactor * skewFactor;

  // risk tolerance + hard cap
  const finalFraction = Math.max(
    0,
    Math.min(distributionKelly * riskTolerance, inputs.maxKellyFraction),
  );
  const betAmount = Math.round(finalFraction * bankroll * 100) / 100;

  // probability-weighted EV
  const pWin = direction === "UP" ? pUp : 1 - pUp;
  const pLose = 1 - pWin;
  const entryPrice = direction === "UP" ? marketPrice : 1 - marketPrice;
  const expectedValue =
    betAmount > 0
      ? Math.round(betAmount * (pWin * ((1 - entryPrice) / entryPrice) - pLose) * 100) / 100
      : 0;

  const potentialProfit =
    betAmount > 0
      ? Math.round(betAmount * ((1 - entryPrice) / entryPrice) * 100) / 100
      : 0;

  return {
    naiveKelly,
    sensitivityFactor,
    uncertaintyFactor,
    skewFactor,
    distributionKelly,
    finalFraction,
    betAmount,
    expectedValue,
    potentialProfit,
  };
}

export function kellyFromDistribution(
  distribution: DistributionAnalysis,
  marketPrice: number,
  direction: Direction,
  currentPrice: number,
  bankroll: number,
  riskTolerance: number,
  useDistributionAdjustments: boolean = true,
  maxKellyFraction: number = 0.15,
): KellyResult {
  return computeKelly({
    pUp: distribution.pUp,
    marketPrice,
    direction,
    pdfAtReference: distribution.pdfAtReference,
    coneWidthPct: distribution.coneWidthPct,
    percentile5: distribution.percentile5,
    percentile50: distribution.percentile50,
    percentile95: distribution.percentile95,
    currentPrice,
    bankroll,
    riskTolerance,
    maxKellyFraction,
    useDistributionAdjustments,
  });
}