"use client";

import { Card, CardContent } from "@/components/ui/card";

interface ReasoningPanelProps {
  reasoning: string[];
}

export function ReasoningPanel({ reasoning }: ReasoningPanelProps) {
  return (
    <Card className="bg-muted/30">
      <CardContent>
        <div className="font-mono text-xs leading-relaxed text-muted-foreground">
          {reasoning.map((line, i) => {
            if (/^\d+\./.test(line)) {
              return (
                <p key={i} className="mt-3 font-semibold text-foreground first:mt-0">
                  {line}
                </p>
              );
            }
            if (line.includes("\u2192")) {
              return (
                <p key={i} className="text-chart-1">
                  {line}
                </p>
              );
            }
            if (line.trim() === "") {
              return <div key={i} className="h-2" />;
            }
            return <p key={i}>{line}</p>;
          })}
        </div>
      </CardContent>
    </Card>
  );
}
