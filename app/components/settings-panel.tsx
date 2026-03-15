"use client";

import { useState, useEffect, useRef } from "react";
import { type UserSettings } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type RiskProfile = "conservative" | "moderate" | "aggressive" | "raw" | "max";

interface ProfileConfig {
  riskTolerance: number;
  minEdgeThreshold: number;
  maxKellyFraction: number;
  useDistributionAdjustments: boolean;
  label: string;
  description: string;
}

const RISK_PROFILES: Record<RiskProfile, ProfileConfig> = {
  conservative: {
    riskTolerance: 0.25,
    minEdgeThreshold: 0.08,
    maxKellyFraction: 0.10,
    useDistributionAdjustments: true,
    label: "Conservative",
    description: '1/4 Kelly, 10% cap, 8%+ edge \u00B7 "The Surgeon" 73% win +52%',
  },
  moderate: {
    riskTolerance: 0.5,
    minEdgeThreshold: 0.05,
    maxKellyFraction: 0.15,
    useDistributionAdjustments: true,
    label: "Moderate",
    description: '1/2 Kelly, 15% cap, 5%+ edge \u00B7 "Steady Eddie" 86% win +203%',
  },
  aggressive: {
    riskTolerance: 0.75,
    minEdgeThreshold: 0.03,
    maxKellyFraction: 0.20,
    useDistributionAdjustments: true,
    label: "Aggressive",
    description: '3/4 Kelly, 20% cap, 3%+ edge \u00B7 "The Shark" 77% win +472%',
  },
  raw: {
    riskTolerance: 0.5,
    minEdgeThreshold: 0.05,
    maxKellyFraction: 0.15,
    useDistributionAdjustments: false,
    label: "Raw Signal",
    description: '1/2 Kelly, 15% cap, no adjustments \u00B7 "Raw Signal" 65% win +143%',
  },
  max: {
    riskTolerance: 1.0,
    minEdgeThreshold: 0.02,
    maxKellyFraction: 0.25,
    useDistributionAdjustments: false,
    label: "Full Kelly",
    description: 'Full Kelly, 25% cap, 2%+ edge \u00B7 "YOLO" 75% win +166%',
  },
};

export function riskProfileFromSettings(settings: UserSettings): RiskProfile {
  if (settings.riskTolerance <= 0.25) return "conservative";
  if (settings.riskTolerance >= 1.0) return "max";
  if (settings.riskTolerance <= 0.5 && !settings.useDistributionAdjustments) return "raw";
  if (settings.riskTolerance <= 0.5) return "moderate";
  return "aggressive";
}

interface SettingsPanelProps {
  settings: UserSettings;
  onChange: (settings: UserSettings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const currentProfile = riskProfileFromSettings(settings);
  const [bankrollInput, setBankrollInput] = useState(settings.bankroll > 0 ? String(settings.bankroll) : "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const val = settings.bankroll > 0 ? String(settings.bankroll) : "";
    setBankrollInput(val);
  }, [settings.bankroll]);

  const handleBankrollChange = (value: string) => {
    setBankrollInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...settings, bankroll: Number(value) || 0 });
    }, 500);
  };

  const handleProfileChange = (profile: RiskProfile) => {
    const p = RISK_PROFILES[profile];
    onChange({
      ...settings,
      riskTolerance: p.riskTolerance,
      minEdgeThreshold: p.minEdgeThreshold,
      maxKellyFraction: p.maxKellyFraction,
      useDistributionAdjustments: p.useDistributionAdjustments,
    });
  };

  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-5">
          <div className="w-full sm:w-40">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Bankroll
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                type="number"
                value={bankrollInput}
                placeholder="Enter amount"
                onChange={(e) => handleBankrollChange(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Risk
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1 sm:grid-cols-5">
              {(
                Object.entries(RISK_PROFILES) as [RiskProfile, (typeof RISK_PROFILES)[RiskProfile]][]
              ).map(([key, profile]) => (
                <button
                  key={key}
                  onClick={() => handleProfileChange(key)}
                  className={`rounded-md px-2 py-2 text-center text-xs font-medium transition-all ${
                    currentProfile === key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={profile.description}
                >
                  {profile.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {RISK_PROFILES[currentProfile].description}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
