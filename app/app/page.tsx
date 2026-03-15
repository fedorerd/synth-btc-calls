"use client";

import { useState, useEffect } from "react";
import { useRecommendations } from "@/hooks/use-recommendations";
import { RecommendationCard } from "@/components/recommendation-card";
import { SettingsPanel } from "@/components/settings-panel";
import { PageHeader, PageFooter } from "@/components/page-shell";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SETTINGS_KEY = "synth-bet-settings";

function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export default function Home() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = loadSettings();
    setSettings(stored.bankroll !== DEFAULT_SETTINGS.bankroll || stored.riskTolerance !== DEFAULT_SETTINGS.riskTolerance ? stored : null);
    setMounted(true);
  }, []);

  const handleSettingsChange = (newSettings: UserSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const ready = mounted && settings !== null && settings.bankroll > 0;
  const activeSettings = settings ?? DEFAULT_SETTINGS;

  const { recommendations, btcPrice, lastUpdated, loading, error, refresh } =
    useRecommendations(activeSettings, ready);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title="Synth Bet Advisor" subtitle="Distribution-aware Kelly sizing for Polymarket BTC contracts" />

        <div className="mb-6">
          <SettingsPanel settings={activeSettings} onChange={handleSettingsChange} />
        </div>

        {ready && (
          <Card className="mb-6">
            <CardContent>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  {btcPrice && (
                    <span className="text-muted-foreground">
                      BTC{" "}
                      <span className="font-medium text-foreground">
                        ${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </span>
                  )}
                  {lastUpdated && (
                    <Badge variant="outline" className="text-xs font-normal">
                      Updated {new Date(lastUpdated).toLocaleTimeString()}
                    </Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                  {loading ? "Refreshing..." : "Refresh"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!ready && (
          <Card>
            <CardContent>
              <div className="py-8 text-center text-sm text-muted-foreground">
                <p className="mb-2 text-lg font-medium text-foreground">Set your bankroll and risk profile</p>
                <p>Enter your bankroll amount above and select a risk strategy to get personalized bet recommendations.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {ready && error && (
          <Card className="mb-6 border-destructive/50 bg-destructive/10">
            <CardContent>
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {ready && loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse opacity-60">
                <CardContent>
                  <div className="flex items-center gap-3 pb-1">
                    <div className="h-6 w-28 rounded bg-muted/50" />
                    <div className="h-5 w-14 rounded-full bg-muted/50" />
                    <div className="h-5 w-16 rounded-full bg-muted/50" />
                  </div>
                  <div className="h-5 w-48 rounded bg-muted/30" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {ready && !loading && (
          <div className="space-y-4">
            {[...recommendations]
              .sort((a, b) => {
                const aIsBet = "betAmount" in a ? 0 : 1;
                const bIsBet = "betAmount" in b ? 0 : 1;
                return aIsBet - bIsBet;
              })
              .map((rec, i) => (
                <RecommendationCard key={i} recommendation={rec} />
              ))}
          </div>
        )}

        <PageFooter />
      </div>
    </div>
  );
}
