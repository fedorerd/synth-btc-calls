"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageFooter } from "@/components/page-shell";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function Formula({ label, formula }: { label: string; formula: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-4 py-3 font-mono text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground">{formula}</span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title="How It Works" subtitle="The math behind Synth Bet Advisor" />

        <Section title="What This Does">
          <p className="text-foreground">
            Synth Bet Advisor finds mispriced BTC up/down contracts on Polymarket by comparing
            Synth&apos;s probabilistic forecasts against Polymarket&apos;s market prices. When
            there&apos;s a gap, it tells you exactly how much to bet using distribution-aware Kelly sizing.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-foreground">L1</p>
              <p className="text-xs">Term Structure</p>
              <p className="text-[10px]">Which market to trade</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-foreground">L2</p>
              <p className="text-xs">Kelly Sizer</p>
              <p className="text-[10px]">How much to bet</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-foreground">Output</p>
              <p className="text-xs">Bet Card</p>
              <p className="text-[10px]">Actionable recommendation</p>
            </div>
          </div>
        </Section>

        <Section title="Data Pipeline">
          <p>Every refresh cycle pulls 5 endpoints from the Synth API, plus live orderbooks from Polymarket:</p>
          <div className="space-y-1 font-mono text-xs">
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>/polymarket/up-down/15min</span>
              <Badge variant="outline" className="text-[10px]">P(up) at 15min</Badge>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>/polymarket/up-down/hourly</span>
              <Badge variant="outline" className="text-[10px]">P(up) at 1h</Badge>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>/polymarket/up-down/daily</span>
              <Badge variant="outline" className="text-[10px]">P(up) at 24h</Badge>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>/prediction-percentiles</span>
              <Badge variant="outline" className="text-[10px]">Price distribution</Badge>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>/lp-probabilities</span>
              <Badge variant="outline" className="text-[10px]">Full CDF</Badge>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span>Polymarket CLOB /book</span>
              <Badge variant="outline" className="text-[10px]">Live orderbook</Badge>
            </div>
          </div>
        </Section>

        <Section title="Layer 1: Probability Term Structure">
          <p>
            Synth provides P(up) independently for 15min, 1h, and 24h horizons. Plotting these
            as a curve creates a <span className="text-foreground font-medium">term structure</span> &mdash;
            a concept borrowed from fixed income that doesn&apos;t exist yet in prediction markets.
          </p>

          <p className="font-medium text-foreground">Shape Classification</p>
          <Formula label="Slope" formula="P(up)_24h - P(up)_15min" />
          <Formula label="Curvature" formula="P(up)_1h - avg(P(up)_15min, P(up)_24h)" />

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border p-2"><span className="font-medium text-green-400">STEEP BULLISH</span> &mdash; all timeframes agree up</div>
            <div className="rounded border p-2"><span className="font-medium text-red-400">STEEP BEARISH</span> &mdash; all timeframes agree down</div>
            <div className="rounded border p-2"><span className="font-medium text-yellow-400">HUMPED</span> &mdash; mid-term diverges, mean reversion</div>
            <div className="rounded border p-2"><span className="font-medium text-blue-400">INVERTED</span> &mdash; short-term spike, expected reversal</div>
            <div className="rounded border p-2"><span className="font-medium text-purple-400">ACCELERATING</span> &mdash; momentum building over time</div>
            <div className="rounded border p-2"><span className="font-medium text-muted-foreground">FLAT</span> &mdash; no conviction, low information</div>
          </div>

          <p className="font-medium text-foreground">Edge Detection</p>
          <p>
            For each timeframe, the edge is the gap between Synth&apos;s probability and Polymarket&apos;s
            implied price, minus the bid-ask spread:
          </p>
          <Formula label="Edge" formula="|P_synth - P_polymarket|" />
          <Formula label="Net Edge" formula="Edge - Spread" />
          <Formula label="Score" formula="Net Edge * Consistency * ln(1 + Liquidity)" />
        </Section>

        <Section title="Key Concepts">
          <div className="space-y-3">
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">CDF (Cumulative Distribution Function)</p>
              <p className="text-xs">Answers: &quot;What&apos;s the probability BTC will be below price X?&quot; At price $70k, CDF = 0.3 means 30% chance BTC ends below $70k. Goes from 0 to 1 as price increases.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">PDF (Probability Density Function)</p>
              <p className="text-xs">The derivative of the CDF &mdash; shows where probability mass is concentrated. High PDF at a price means many predicted paths land near that price. We measure PDF at the market&apos;s reference price (the up/down boundary) to gauge how &quot;coin-flippy&quot; the outcome is.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Kelly Criterion</p>
              <p className="text-xs">A formula from information theory that gives the mathematically optimal fraction of your bankroll to bet. Too much = risk of ruin. Too little = leaving money on the table. Kelly maximizes long-term growth rate. In practice, fractional Kelly (1/4, 1/2) is used for safety.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Edge</p>
              <p className="text-xs">The gap between what Synth thinks the probability is and what Polymarket is pricing it at. If Synth says 65% and Polymarket says 50%, the edge is 15%. After subtracting the bid-ask spread, the remaining &quot;net edge&quot; is the actual opportunity.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Prediction Cone</p>
              <p className="text-xs">The range between the 5th and 95th percentile of Synth&apos;s price forecast. Narrow cone = Synth is confident. Wide cone = high uncertainty. We use cone width to dampen Kelly sizing when the model is less sure.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Skew</p>
              <p className="text-xs">Asymmetry in the distribution. If the right tail (prices going up) is longer than the left tail, the distribution is right-skewed. We adjust bet sizing slightly when skew favors our direction.</p>
            </div>
          </div>
        </Section>

        <Section title="Layer 2: Distribution-Aware Kelly Criterion">
          <p>
            Standard Kelly criterion gives the optimal bet fraction for a binary outcome.
            We extend it with three adjustment factors derived from the <span className="text-foreground font-medium">shape</span> of
            Synth&apos;s probability distribution.
          </p>

          <p className="font-medium text-foreground">Naive Kelly</p>
          <p>For a binary contract priced at <code className="text-foreground">m</code> with estimated win probability <code className="text-foreground">p</code>:</p>
          <Formula label="f*" formula="(p - m) / (1 - m)" />

          <p className="font-medium text-foreground">Sensitivity Factor</p>
          <p>
            High PDF at the reference price means the outcome is &quot;coin-flippy&quot; &mdash; small price
            moves flip the result. We reduce position size when this is the case.
          </p>
          <Formula label="Sensitivity" formula="1 - 0.3 * min(PDF_ref / 0.05, 1)" />

          <p className="font-medium text-foreground">Uncertainty Factor</p>
          <p>
            Wide prediction cone = more model uncertainty. The 5th-95th percentile range
            relative to price measures how confident Synth is.
          </p>
          <Formula label="Uncertainty" formula="1 / (1 + ConeWidth% * 10)" />

          <p className="font-medium text-foreground">Skew Factor</p>
          <p>
            If the distribution is skewed in our bet&apos;s favor (right tail heavier for UP bets),
            we slightly increase sizing. Normalized by cone width for scale-independence.
          </p>
          <Formula label="RawSkew" formula="(RightTail - LeftTail) / ConeWidth" />
          <Formula label="SkewFactor" formula="1 + 0.2 * RawSkew" />

          <p className="font-medium text-foreground">Final Sizing</p>
          <Formula label="Dist-Kelly" formula="NaiveKelly * Sensitivity * Uncertainty * Skew" />
          <Formula label="Final" formula="min(Dist-Kelly * RiskTolerance, MaxKellyCap)" />
          <Formula label="Bet Amount" formula="Final * Bankroll" />
        </Section>

        <Section title="CDF Reconstruction">
          <p>
            The distribution analysis requires a smooth CDF. We build it by merging two data sources:
          </p>
          <div className="space-y-2 text-xs">
            <div className="rounded border p-2">
              <span className="font-medium text-foreground">LP Probabilities</span> &mdash;
              P(above) and P(below) at ~11 evenly spaced price levels. This IS the CDF at coarse resolution over a wide range.
            </div>
            <div className="rounded border p-2">
              <span className="font-medium text-foreground">Prediction Percentiles</span> &mdash;
              9 price levels at standard percentiles (0.5%, 5%, 20%, ... 99.5%). This is the inverse CDF at fine resolution in a tight range.
            </div>
          </div>
          <p>
            Combined, we get ~20 (price, cumulative_probability) pairs. We fit a monotonic
            PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) spline for a smooth CDF,
            then differentiate numerically for the PDF.
          </p>
        </Section>

        <Section title="Backtesting Methodology">
          <p>
            We validate the strategy using real data: Synth insight snapshots collected every minute,
            matched against Polymarket market outcomes with real orderbook entry prices from Predexon.
          </p>

          <p className="font-medium text-foreground">5 Agent Scenarios</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span><span className="font-medium text-foreground">The Surgeon</span> &mdash; 1/4 Kelly, 8%+ edge, 10% cap</span>
              <span>Conservative</span>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span><span className="font-medium text-foreground">Steady Eddie</span> &mdash; 1/2 Kelly, 5%+ edge, 15% cap</span>
              <span>Moderate</span>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span><span className="font-medium text-foreground">The Shark</span> &mdash; 3/4 Kelly, 3%+ edge, 20% cap</span>
              <span>Aggressive</span>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span><span className="font-medium text-foreground">Raw Signal</span> &mdash; 1/2 Kelly, no distribution adjustments</span>
              <span>Control</span>
            </div>
            <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
              <span><span className="font-medium text-foreground">YOLO</span> &mdash; Full Kelly, 2%+ edge, 25% cap</span>
              <span>Full Kelly</span>
            </div>
          </div>

          <p className="font-medium text-foreground">What We Measure</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border p-2"><span className="font-medium text-foreground">Hit Rate</span> &mdash; % of bets won</div>
            <div className="rounded border p-2"><span className="font-medium text-foreground">PnL</span> &mdash; total profit/loss</div>
            <div className="rounded border p-2"><span className="font-medium text-foreground">Max Drawdown</span> &mdash; worst peak-to-trough decline</div>
            <div className="rounded border p-2"><span className="font-medium text-foreground">Profit Factor</span> &mdash; gross wins / gross losses</div>
          </div>

          <p>
            Each agent bets every ~5 minutes at randomized timestamps (seeded per agent for reproducibility).
            Entry prices use real orderbook ask prices from Predexon snapshots matched by closest timestamp.
            Trades without orderbook data are skipped entirely &mdash; no fallback to estimated prices.
          </p>
        </Section>

        <Section title="What's Novel">
          <div className="space-y-2">
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Probability Term Structure</p>
              <p className="text-xs">Plotting prediction market probabilities across timeframes as a curve and classifying the shape. This analytical framework doesn&apos;t exist in prediction markets yet.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Distribution-Aware Position Sizing</p>
              <p className="text-xs">Three adjustment factors (sensitivity, uncertainty, skew) derived from the shape of Synth&apos;s full probability distribution, not just the point estimate. Extends Kelly criterion with information that standard implementations ignore.</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium text-foreground">Multi-Source CDF Reconstruction</p>
              <p className="text-xs">Merging LP probabilities (wide range, coarse) with prediction percentiles (tight range, fine) via PCHIP interpolation to produce a smooth, monotonic probability distribution.</p>
            </div>
          </div>
        </Section>

        <PageFooter />
      </div>
    </div>
  );
}
