"use client";

import { useState } from "react";
import type { BetRecommendation, NoTradeRecommendation, Recommendation } from "@/lib/types";
import { isBetRecommendation } from "@/lib/types";
import { shapeDisplayName } from "@/lib/term-structure";
import { ReasoningPanel } from "./reasoning-panel";
import { DistributionChart } from "./distribution-chart";
import { TermStructureChart } from "./term-structure-chart";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    HIGH: "bg-green-500/20 text-green-400 border border-green-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    LOW: "bg-red-500/20 text-red-400 border border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence] ?? styles.LOW}`}>
      {confidence}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const isUp = direction === "UP";
  return (
    <Badge variant={isUp ? "default" : "destructive"}>
      {isUp ? "\u25B2" : "\u25BC"} {direction}
    </Badge>
  );
}

function BetCard({ rec }: { rec: BetRecommendation }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const [showTermStructure, setShowTermStructure] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">BTC {rec.timeframe.toUpperCase()}</CardTitle>
          <DirectionBadge direction={rec.direction} />
          <ConfidenceBadge confidence={rec.confidence} />
        </div>
        <CardAction>
          <span className="text-sm font-semibold text-muted-foreground">
            Score: {rec.opportunityScore}
          </span>
        </CardAction>
        <CardDescription>
          {shapeDisplayName(rec.termStructure.shape)} term structure
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-end justify-between">
          <span className="text-3xl font-bold tracking-tight">
            BET ${rec.betAmount.toFixed(0)}
          </span>
          <a
            href={`https://preddy.trade/event/${rec.polymarketSlug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              Trade on Preddy &rarr;
            </Button>
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCell label="Edge" value={`${(rec.edge * 100).toFixed(1)}%`} />
          <MetricCell
            label="Kelly"
            value={`${(rec.kelly.finalFraction * 100).toFixed(1)}%`}
          />
          <MetricCell
            label="Potential Profit"
            value={`+$${rec.kelly.potentialProfit.toFixed(2)}`}
            className="text-green-400"
          />
          <MetricCell
            label="Term Structure"
            value={shapeDisplayName(rec.termStructure.shape)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Synth:{" "}
            <span className="font-medium text-chart-1">
              {(rec.marketData.synthProbUp * 100).toFixed(1)}% up
            </span>
          </span>
          <span className="text-border">|</span>
          <span>
            Polymarket:{" "}
            <span className="font-medium text-chart-4">
              {(rec.marketData.polymarketProbUp * 100).toFixed(1)}% up
            </span>
          </span>
          <span className="text-border">|</span>
          <span>
            Entry:{" "}
            <span className="font-medium text-foreground">
              ${rec.entryPrice.toFixed(3)}
            </span>
            {rec.liveOrderbook && (
              <span className="ml-1 text-green-400">(live)</span>
            )}
          </span>
          <span className="text-border">|</span>
          <span>
            Spread:{" "}
            <span className="font-medium text-foreground">
              ${(rec.liveOrderbook?.spread ?? rec.marketData.bestAskPrice - rec.marketData.bestBidPrice).toFixed(3)}
            </span>
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            variant={showReasoning ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setShowReasoning(!showReasoning); setShowDistribution(false); setShowTermStructure(false); }}
          >
            Reasoning {showReasoning ? "\u25B2" : "\u25BC"}
          </Button>
          <Button
            variant={showDistribution ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setShowDistribution(!showDistribution); setShowReasoning(false); setShowTermStructure(false); }}
          >
            Distribution {showDistribution ? "\u25B2" : "\u25BC"}
          </Button>
          <Button
            variant={showTermStructure ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setShowTermStructure(!showTermStructure); setShowReasoning(false); setShowDistribution(false); }}
          >
            Term Structure {showTermStructure ? "\u25B2" : "\u25BC"}
          </Button>
        </div>

        {showReasoning && (
          <ReasoningPanel reasoning={rec.reasoning} />
        )}
        {showDistribution && (
          <DistributionChart
            distribution={rec.distribution}
            referencePrice={rec.marketData.startPrice}
            direction={rec.direction}
          />
        )}
        {showTermStructure && (
          <TermStructureChart termStructure={rec.termStructure} />
        )}
      </CardContent>
    </Card>
  );
}

function MetricCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${className || ""}`}>{value}</p>
    </div>
  );
}

function NoTradeCard({ rec }: { rec: NoTradeRecommendation }) {
  const reasonLabels: Record<string, string> = {
    edge_below_threshold: "Edge below threshold",
    negative_net_edge: "Negative net edge",
    low_liquidity: "Low liquidity",
    flat_term_structure: "Flat term structure",
    low_consistency: "Low consistency",
  };

  return (
    <Card className="opacity-60">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base text-muted-foreground">
            BTC {rec.timeframe.toUpperCase()}
          </CardTitle>
          <Badge variant="outline">NO TRADE</Badge>
        </div>
        <CardDescription>
          {reasonLabels[rec.reason] || rec.reason}: {rec.details}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  if (isBetRecommendation(recommendation)) {
    return <BetCard rec={recommendation} />;
  }
  return <NoTradeCard rec={recommendation} />;
}
