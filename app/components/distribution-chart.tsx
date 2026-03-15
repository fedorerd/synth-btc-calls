"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { DistributionAnalysis, Direction } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const WIN_COLOR = "#57bb8a";
const LOSE_COLOR = "#e06666";

interface DistributionChartProps {
  distribution: DistributionAnalysis;
  referencePrice: number;
  direction: Direction;
}

function interpolatePoints(
  rawPoints: { price: number; density: number }[],
  numPoints: number,
): { price: number; density: number }[] {
  if (rawPoints.length < 2) return rawPoints;
  const result: { price: number; density: number }[] = [];
  const minP = rawPoints[0].price;
  const maxP = rawPoints[rawPoints.length - 1].price;
  const step = (maxP - minP) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const price = minP + step * i;
    let lo = 0;
    for (let j = 0; j < rawPoints.length - 1; j++) {
      if (rawPoints[j + 1].price >= price) {
        lo = j;
        break;
      }
    }
    const hi = Math.min(lo + 1, rawPoints.length - 1);
    if (lo === hi) {
      result.push({ price: +price.toFixed(0), density: rawPoints[lo].density });
      continue;
    }
    const t = (price - rawPoints[lo].price) / (rawPoints[hi].price - rawPoints[lo].price);
    const density = rawPoints[lo].density + t * (rawPoints[hi].density - rawPoints[lo].density);
    result.push({ price: +price.toFixed(0), density: Math.max(0, +density.toFixed(8)) });
  }
  return result;
}

function formatDensity(density: number): string {
  const pctPer100 = density * 100 * 100;
  if (pctPer100 >= 1) return `${pctPer100.toFixed(1)}% per $100`;
  if (pctPer100 >= 0.1) return `${pctPer100.toFixed(2)}% per $100`;
  return `${(pctPer100 * 10).toFixed(2)}% per $1k`;
}

export function DistributionChart({
  distribution,
  referencePrice,
  direction,
}: DistributionChartProps) {
  const rawPdf: { price: number; density: number }[] = [];
  const pts = distribution.cdfPoints;
  for (let i = 1; i < pts.length; i++) {
    const midPrice = (pts[i].price + pts[i - 1].price) / 2;
    const dx = pts[i].price - pts[i - 1].price;
    if (dx <= 0) continue;
    const density = (pts[i].cumulativeProb - pts[i - 1].cumulativeProb) / dx;
    rawPdf.push({ price: midPrice, density });
  }

  const maxDensity = Math.max(...rawPdf.map((p) => p.density));
  const threshold = maxDensity * 0.005;
  const meaningful = rawPdf.filter((p) => p.density > threshold);

  if (meaningful.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Insufficient data for distribution chart
      </div>
    );
  }

  const priceMin = meaningful[0].price;
  const priceMax = meaningful[meaningful.length - 1].price;
  const priceRange = priceMax - priceMin;
  const cropMin = priceMin - priceRange * 0.15;
  const cropMax = priceMax + priceRange * 0.15;
  const cropped = rawPdf.filter((p) => p.price >= cropMin && p.price <= cropMax);
  const smoothed = interpolatePoints(cropped, 60);

  const chartData = smoothed.map((p) => {
    const isWinning =
      direction === "UP" ? p.price > referencePrice : p.price < referencePrice;
    return {
      price: p.price,
      win: isWinning ? p.density : 0,
      lose: isWinning ? 0 : p.density,
    };
  });

  const coneWidth = ((distribution.percentile95 - distribution.percentile5) / distribution.percentile50) * 100;
  const pWin = direction === "UP" ? distribution.pUp : distribution.pDown;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-medium text-muted-foreground">
          Probability distribution ({distribution.horizon} horizon)
        </p>
        <div className="flex gap-1.5">
          <Badge variant="outline" className="text-xs font-normal">
            P(win) = {(pWin * 100).toFixed(1)}%
          </Badge>
          <Badge variant="outline" className="text-xs font-normal">
            Cone: {coneWidth.toFixed(2)}%
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: WIN_COLOR }}
          />
          Winning region
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: LOSE_COLOR }}
          />
          Losing region
        </span>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 40, bottom: 4, left: 0 }}
          >
            <defs>
              <linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={WIN_COLOR} stopOpacity={0.6} />
                <stop offset="100%" stopColor={WIN_COLOR} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="loseGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LOSE_COLOR} stopOpacity={0.5} />
                <stop offset="100%" stopColor={LOSE_COLOR} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />
            <XAxis
              dataKey="price"
              stroke="var(--color-muted-foreground)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
              interval="preserveStartEnd"
              tickCount={5}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                fontSize: "12px",
                color: "var(--color-popover-foreground)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
              formatter={(value, name) => {
                const v = Number(value);
                if (v === 0) return [null, null];
                return [
                  formatDensity(v),
                  name === "win" ? "Winning" : "Losing",
                ];
              }}
              labelFormatter={(v) => `$${Number(v).toLocaleString()}`}
            />
            <ReferenceLine
              x={+referencePrice.toFixed(0)}
              stroke="var(--color-foreground)"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              label={{
                value: `Entry $${referencePrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                position: "top",
                fill: "var(--color-foreground)",
                fontSize: 10,
                fontWeight: 500,
              }}
            />
            <Area
              type="monotone"
              dataKey="win"
              stroke={WIN_COLOR}
              strokeWidth={1.5}
              fill="url(#winGrad)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="lose"
              stroke={LOSE_COLOR}
              strokeWidth={1.5}
              fill="url(#loseGrad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 px-1">
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">5th pctl</p>
          <p className="text-xs font-semibold">
            ${distribution.percentile5.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Median</p>
          <p className="text-xs font-semibold">
            ${distribution.percentile50.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">95th pctl</p>
          <p className="text-xs font-semibold">
            ${distribution.percentile95.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>
    </div>
  );
}
