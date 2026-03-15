import { NextRequest, NextResponse } from "next/server";
import { fetchAllSynthData } from "@/lib/synth-client";
import { generateRecommendations } from "@/lib/recommendation-engine";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const settings: UserSettings = {
      bankroll: Number(searchParams.get("bankroll")) || DEFAULT_SETTINGS.bankroll,
      riskTolerance:
        Number(searchParams.get("riskTolerance")) || DEFAULT_SETTINGS.riskTolerance,
      minEdgeThreshold:
        Number(searchParams.get("minEdgeThreshold")) || DEFAULT_SETTINGS.minEdgeThreshold,
      maxKellyFraction:
        Number(searchParams.get("maxKellyFraction")) || DEFAULT_SETTINGS.maxKellyFraction,
      useDistributionAdjustments:
        searchParams.get("useDistributionAdjustments") !== "false",
    };

    const data = await fetchAllSynthData();
    const recommendations = await generateRecommendations(data, settings);

    return NextResponse.json({
      recommendations,
      meta: {
        timestamp: new Date().toISOString(),
        settings,
        btcPrice: data.upDown15min.current_price,
      },
    });
  } catch (error) {
    console.error("Recommendation engine error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
