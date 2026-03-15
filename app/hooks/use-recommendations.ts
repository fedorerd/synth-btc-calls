"use client";

import { useState, useEffect, useCallback } from "react";
import type { Recommendation, UserSettings } from "@/lib/types";

interface RecommendationsResponse {
  recommendations: Recommendation[];
  meta: {
    timestamp: string;
    settings: UserSettings;
    btcPrice: number;
  };
}

interface UseRecommendationsReturn {
  recommendations: Recommendation[];
  btcPrice: number | null;
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRecommendations(
  settings: UserSettings,
  autoRefresh: boolean = true,
): UseRecommendationsReturn {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecs = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const params = new URLSearchParams({
        bankroll: String(settings.bankroll),
        riskTolerance: String(settings.riskTolerance),
        minEdgeThreshold: String(settings.minEdgeThreshold),
        maxKellyFraction: String(settings.maxKellyFraction),
        useDistributionAdjustments: String(settings.useDistributionAdjustments),
      });

      const res = await fetch(`/api/recommendations?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data: RecommendationsResponse = await res.json();
      setRecommendations(data.recommendations);
      setBtcPrice(data.meta.btcPrice);
      setLastUpdated(data.meta.timestamp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [settings.bankroll, settings.riskTolerance, settings.minEdgeThreshold, settings.maxKellyFraction, settings.useDistributionAdjustments]);

  useEffect(() => {
    if (!autoRefresh) return;

    fetchRecs();
  }, [fetchRecs, autoRefresh]);

  return { recommendations, btcPrice, lastUpdated, loading, error, refresh: fetchRecs };
}
