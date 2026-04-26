// Gender-based personalization helper.
// Reads `profiles.gender` (already collected at KYC) and derives a "persona"
// used across the home screen for: accent color, greeting copy/emoji, and the
// gender filter we send when fetching offers/rewards from the database.
//
// Defaults to "neutral" for unset, "other", or any unknown value — that gives
// a curated mix of offers and the standard champagne accent (no theme shift).
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";

export type Persona = "boy" | "girl" | "neutral";

export interface PersonaTheme {
  persona: Persona;
  // Emoji shown after "Hey, {first}"
  emoji: string;
  // Copy shown under the greeting
  subtitle: string;
  // CSS class to apply to the home root so accent tokens swap (see styles.css)
  accentClass: string;
  // Filter value for queries against gender_target column.
  // boy/girl include their own + "all"; neutral includes everything.
  offerFilter: ("boy" | "girl" | "all")[];
}

function normalize(g: string | null | undefined): Persona {
  const s = (g ?? "").toLowerCase().trim();
  if (s === "boy" || s === "male" || s === "m") return "boy";
  if (s === "girl" || s === "female" || s === "f") return "girl";
  return "neutral";
}

export function personaTheme(persona: Persona): PersonaTheme {
  if (persona === "boy") {
    return {
      persona,
      emoji: "🎮",
      subtitle: "Level up, champ",
      accentClass: "persona-boy",
      offerFilter: ["boy", "all"],
    };
  }
  if (persona === "girl") {
    return {
      persona,
      emoji: "✨",
      subtitle: "Shine on, star",
      accentClass: "persona-girl",
      offerFilter: ["girl", "all"],
    };
  }
  return {
    persona,
    emoji: "👋",
    subtitle: "Welcome back",
    accentClass: "persona-neutral",
    offerFilter: ["boy", "girl", "all"],
  };
}

/**
 * Reads the user's gender from `profiles` once on mount and returns the
 * derived persona theme. Falls back to neutral while loading or if the
 * profile/gender is unavailable.
 */
export function useGenderPersona(): PersonaTheme {
  const { userId } = useApp();
  const [gender, setGender] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("gender")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setGender((data?.gender as string | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return useMemo(() => personaTheme(normalize(gender)), [gender]);
}
