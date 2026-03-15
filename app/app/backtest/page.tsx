"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, PageFooter } from "@/components/page-shell";

interface ScenarioSummary {
  scenario: string;
  bankroll: number;
  totalTrades: number;
  skippedTrades: number;
  wins: number;
  losses: number;
  hitRate: number;
  totalPnl: number;
  finalBankroll: number;
  returnPct: number;
  maxDrawdownPct: number;
  avgEdge: number;
  avgBetSize: number;
  profitFactor: number;
}

interface Trade {
  timestamp: number;
  datetime: string;
  direction: "UP" | "DOWN";
  synthProb: number;
  polymarketProb: number;
  edge: number;
  entryPrice: number;
  betAmount: number;
  kellyFraction: number;
  outcome: "UP" | "DOWN" | "UNRESOLVED";
  pnl: number;
  bankrollAfter: number;
  slug: string;
}

interface ScenarioDetail {
  scenario: { name: string; bankroll: number; riskTolerance: number; minEdge: number; maxKellyFraction: number };
  metrics: ScenarioSummary;
  trades: Trade[];
  skipped: { timestamp: number; datetime: string; slug: string; timeframe: string; reason: string; edge: number }[];
  equityCurve: { timestamp: number; bankroll: number }[];
}

const COLORS = ["#6d9eeb", "#f6b26b", "#57bb8a", "#e06666", "#b4a7d6"];

const AGENT_TO_FRONTEND: Record<string, string> = {
  "The Surgeon": "Conservative",
  "Steady Eddie": "Moderate",
  "The Shark": "Aggressive",
  "Raw Signal": "Raw Signal",
  "YOLO": "Full Kelly",
};

function scenarioSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export default function BacktestPage() {
  const [summaries, setSummaries] = useState<ScenarioSummary[]>([]);
  const [details, setDetails] = useState<Map<string, ScenarioDetail>>(new Map());
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/backtest/summary.json")
      .then(r => r.json())
      .then(async (data: ScenarioSummary[]) => {
        setSummaries(data);
        const detailMap = new Map<string, ScenarioDetail>();
        await Promise.all(
          data.map(async (s) => {
            try {
              const res = await fetch(`/backtest/scenario-${scenarioSlug(s.scenario)}.json`);
              const detail: ScenarioDetail = await res.json();
              detailMap.set(s.scenario, detail);
            } catch {}
          }),
        );
        setDetails(detailMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const chartData = useMemo(() => {
    const allTimestamps = new Set<number>();
    for (const [, detail] of details) {
      for (const p of detail.equityCurve) allTimestamps.add(p.timestamp);
    }
    const sorted = [...allTimestamps].sort((a, b) => a - b);

    const agentCurves = new Map<string, { timestamp: number; bankroll: number }[]>();
    for (const [name, detail] of details) {
      agentCurves.set(name, [...detail.equityCurve].sort((a, b) => a.timestamp - b.timestamp));
    }

    const lastKnown = new Map<string, number>();
    for (const [name, detail] of details) {
      lastKnown.set(name, detail.scenario.bankroll);
    }

    return sorted.map(ts => {
      const row: Record<string, string | number> = {
        time: new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      for (const [name, curve] of agentCurves) {
        let val = lastKnown.get(name)!;
        for (const p of curve) {
          if (p.timestamp <= ts) val = p.bankroll;
          else break;
        }
        lastKnown.set(name, val);
        row[name] = +val.toFixed(2);
      }
      return row;
    });
  }, [details]);

  const allTrades = useMemo(() => {
    const trades: (Trade & { agent: string })[] = [];
    for (const [name, detail] of details) {
      for (const t of detail.trades) {
        trades.push({ ...t, agent: name });
      }
    }
    return trades.sort((a, b) => a.timestamp - b.timestamp);
  }, [details]);

  const filteredTrades = selectedAgent
    ? allTrades.filter(t => t.agent === selectedAgent)
    : allTrades;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading backtest results...</p>
      </div>
    );
  }

  const totalTrades = summaries.reduce((s, r) => s + r.totalTrades, 0);
  const totalWins = summaries.reduce((s, r) => s + r.wins, 0);
  const avgHitRate = totalTrades > 0 ? totalWins / totalTrades : 0;
  const avgReturn = summaries.length > 0 ? summaries.reduce((s, r) => s + r.returnPct, 0) / summaries.length : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Backtest Results" subtitle="5 agents tested against live Synth + Polymarket data" />

        <Card className="mb-6">
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricBox label="Total Trades" value={String(totalTrades)} />
              <MetricBox label="Win Rate" value={`${(avgHitRate * 100).toFixed(1)}%`} />
              <MetricBox label="Avg Return" value={`${(avgReturn * 100).toFixed(0)}%`} />
              <MetricBox label="Profitable" value={`${summaries.filter(s => s.totalPnl > 0).length}/${summaries.length}`} />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Profits Over Time
              {selectedAgent && (
                <Button variant="outline" size="xs" className="ml-3 h-5.5!" onClick={() => setSelectedAgent(null)}>
                  Show all
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--color-muted-foreground)" fontSize={9} tickLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={9} tickLine={false} width={45} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "var(--color-popover-foreground)",
                    }}
                    formatter={(v, name) => [`$${Number(v).toFixed(0)}`, name]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "11px", cursor: "pointer" }}
                    onClick={(e) => setSelectedAgent(prev => prev === e.value ? null : String(e.value))}
                  />
                  {summaries.map((s, i) => (
                    <Line
                      key={s.scenario}
                      type="monotone"
                      dataKey={s.scenario}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={(selectedAgent ?? hoveredAgent) === s.scenario ? 3 : (selectedAgent ?? hoveredAgent) ? 1 : 2}
                      strokeOpacity={(selectedAgent ?? hoveredAgent) && (selectedAgent ?? hoveredAgent) !== s.scenario ? 0.2 : 1}
                      dot={false}
                      connectNulls
                      activeDot={{
                        r: 5,
                        onMouseEnter: () => setHoveredAgent(s.scenario),
                        onMouseLeave: () => setHoveredAgent(null),
                        onClick: () => setSelectedAgent(prev => prev === s.scenario ? null : s.scenario),
                      }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2 cursor-help" title="Backtest agent name">Agent</th>
                    <th className="px-2 py-2 cursor-help" title="Corresponding frontend risk profile">Strategy</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Starting bankroll for this agent">Initial</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Total number of bets placed">Trades</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Wins / Losses">W/L</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Win rate: percentage of bets that were correct">Hit%</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Average bet size in dollars">Avg Bet</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Total profit or loss across all trades">PnL</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Return on initial bankroll">Return</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Maximum drawdown: largest peak-to-trough decline as % of peak">Max DD</th>
                    <th className="px-2 py-2 text-right cursor-help" title="Profit factor: gross profits / gross losses (higher is better)">PF</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s, i) => {
                    const isSelected = selectedAgent === s.scenario;
                    const dimmed = selectedAgent && !isSelected;
                    return (
                      <tr
                        key={s.scenario}
                        className={`border-b border-border/50 cursor-pointer transition-opacity ${dimmed ? "opacity-30" : ""} ${isSelected ? "bg-muted/50" : "hover:bg-muted/30"}`}
                        onClick={() => setSelectedAgent(prev => prev === s.scenario ? null : s.scenario)}
                      >
                        <td className="px-2 py-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        </td>
                        <td className="px-2 py-2 font-medium">{s.scenario}</td>
                        <td className="px-2 py-2 text-muted-foreground">{AGENT_TO_FRONTEND[s.scenario] ?? "—"}</td>
                        <td className="px-2 py-2 text-right">${s.bankroll}</td>
                        <td className="px-2 py-2 text-right">{s.totalTrades}</td>
                        <td className="px-2 py-2 text-right">{s.wins}/{s.losses}</td>
                        <td className="px-2 py-2 text-right">{(s.hitRate * 100).toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right">${s.avgBetSize.toFixed(0)}</td>
                        <td className={`px-2 py-2 text-right font-medium ${s.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(0)}
                        </td>
                        <td className={`px-2 py-2 text-right ${s.returnPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {(s.returnPct * 100).toFixed(1)}%
                        </td>
                        <td className="px-2 py-2 text-right">{(s.maxDrawdownPct * 100).toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right">{s.profitFactor > 100 ? "∞" : s.profitFactor.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Trade Log ({filteredTrades.length} trades)
              {selectedAgent && (
                <Badge variant="outline" className="ml-2">{selectedAgent}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-125 overflow-y-auto">
              <table className="w-full text-xs" style={{ minWidth: 800 }}>
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-1.5 cursor-help" title="Which backtest agent placed this trade">Agent</th>
                    <th className="px-2 py-1.5 cursor-help" title="Timestamp when the bet was placed">Time</th>
                    <th className="px-2 py-1.5 cursor-help" title="Bet direction: UP (price will rise) or DOWN (price will fall)">Dir</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Edge: difference between Synth probability and Polymarket price">Edge</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Entry price: actual ask price paid from the orderbook">Entry</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Dollar amount wagered on this trade">Bet</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Kelly fraction: % of bankroll allocated by the Kelly criterion">Kelly</th>
                    <th className="px-2 py-1.5 cursor-help" title="Outcome: W (won) or L (lost)">Result</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Profit or loss on this trade">PnL</th>
                    <th className="px-2 py-1.5 text-right cursor-help" title="Bankroll balance after this trade">Balance</th>
                    <th className="px-2 py-1.5 cursor-help" title="Link to the Polymarket market page">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map((t, i) => {
                    const won = t.direction === t.outcome;
                    const agentIdx = summaries.findIndex(s => s.scenario === t.agent);
                    return (
                      <tr
                        key={i}
                        className="border-b border-border/30 cursor-pointer hover:bg-muted/30"
                        onClick={() => setSelectedAgent(prev => prev === t.agent ? null : t.agent)}
                      >
                        <td className="px-2 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[agentIdx % COLORS.length] }} />
                            <span className="text-muted-foreground">{t.agent}</span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {new Date(t.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant={t.direction === "UP" ? "default" : "destructive"} className="text-[10px]">
                            {t.direction}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right">{(t.edge * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5 text-right">{t.entryPrice.toFixed(3)}</td>
                        <td className="px-2 py-1.5 text-right">${t.betAmount.toFixed(0)}</td>
                        <td className="px-2 py-1.5 text-right">{(t.kellyFraction * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5">
                          <Badge variant={won ? "default" : "destructive"} className="text-[10px]">
                            {won ? "W" : "L"}
                          </Badge>
                        </td>
                        <td className={`px-2 py-1.5 text-right font-medium ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-right">${t.bankrollAfter.toFixed(0)}</td>
                        <td className="px-2 py-1.5">
                          <a
                            href={`https://preddy.trade/event/${t.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-400 hover:underline truncate max-w-30 inline-block"
                          >
                            {t.slug.slice(0, 20)}...
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <PageFooter />
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
