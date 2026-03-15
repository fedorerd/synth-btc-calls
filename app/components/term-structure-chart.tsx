"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { TermStructure } from "@/lib/types";
import { shapeDisplayName } from "@/lib/term-structure";
import { Badge } from "@/components/ui/badge";

const SYNTH_COLOR = "#f6b26b";
const POLY_COLOR = "#6d9eeb";

interface TermStructureChartProps {
  termStructure: TermStructure;
}

export function TermStructureChart({
  termStructure,
}: TermStructureChartProps) {
  const data = [
    {
      timeframe: "15min",
      synth: +(termStructure.pUp15min * 100).toFixed(1),
      polymarket: +(termStructure.polyPUp15min * 100).toFixed(1),
    },
    {
      timeframe: "1h",
      synth: +(termStructure.pUp1h * 100).toFixed(1),
      polymarket: +(termStructure.polyPUp1h * 100).toFixed(1),
    },
    {
      timeframe: "24h",
      synth: +(termStructure.pUp24h * 100).toFixed(1),
      polymarket: +(termStructure.polyPUp24h * 100).toFixed(1),
    },
  ];

  const allValues = data.flatMap((d) => [d.synth, d.polymarket]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = Math.max((maxVal - minVal) * 0.3, 10);
  const yMin = Math.max(0, Math.floor(minVal - padding));
  const yMax = Math.min(100, Math.ceil(maxVal + padding));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-medium text-muted-foreground">
          P(Up) across timeframes
        </p>
        <Badge variant="outline" className="text-xs font-normal">
          {shapeDisplayName(termStructure.shape)}
        </Badge>
      </div>

      <div className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: SYNTH_COLOR }}
          />
          Synth
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-muted-foreground"
            style={{ backgroundColor: POLY_COLOR, opacity: 0.4 }}
          />
          Polymarket
        </span>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 40, bottom: 4, left: 0 }}
            barCategoryGap="25%"
            barGap={4}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />
            <XAxis
              dataKey="timeframe"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                fontSize: "12px",
                color: "var(--color-popover-foreground)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
              formatter={(value, name) => [
                `${value}%`,
                name === "synth" ? "Synth" : "Polymarket",
              ]}
            />
            <ReferenceLine
              y={50}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="6 3"
              strokeOpacity={0.4}
              label={{
                value: "50%",
                position: "right",
                fill: "var(--color-muted-foreground)",
                fontSize: 10,
              }}
            />
            <Bar
              dataKey="synth"
              fill={SYNTH_COLOR}
              fillOpacity={0.85}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
            <Bar
              dataKey="polymarket"
              fill={POLY_COLOR}
              fillOpacity={0.4}
              stroke={POLY_COLOR}
              strokeWidth={1}
              strokeDasharray="3 2"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 px-1">
        {data.map((d) => {
          const edge = d.synth - d.polymarket;
          return (
            <div
              key={d.timeframe}
              className="rounded-md bg-muted/50 px-2 py-1.5 text-center"
            >
              <p className="text-[10px] text-muted-foreground">{d.timeframe} edge</p>
              <p
                className={`text-xs font-semibold ${Math.abs(edge) > 3 ? (edge > 0 ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}
              >
                {edge > 0 ? "+" : ""}
                {edge.toFixed(1)}pp
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
