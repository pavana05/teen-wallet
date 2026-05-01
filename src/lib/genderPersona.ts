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

// U+FE0F (VARIATION SELECTOR-16) requests color-emoji presentation. Chained
// after each glyph so devices that would otherwise render a monochrome
// "text-style" fallback (older Windows/Linux, some Android WebViews) reliably
// render the colored pictograph. Combined with the emoji-font stack on the
// `.hp-greeting-emoji` span, this is the most portable safe fallback we can
// ship without bundling Twemoji.
const VS16 = "\uFE0F";

export function personaTheme(persona: Persona): PersonaTheme {
  if (persona === "boy") {
    return {
      persona,
      // 😎 renders consistently across iOS / Android / Windows as a color emoji,
      // unlike 🎮 which can fall back to a monochrome glyph on some devices.
      emoji: "\u{1F60E}" + VS16, // 😎
      subtitle: "Level up, champ",
      accentClass: "persona-boy",
      offerFilter: ["boy", "all"],
    };
  }
  if (persona === "girl") {
    return {
      persona,
      emoji: "\u{1F338}" + VS16, // 🌸
      subtitle: "Shine on, star",
      accentClass: "persona-girl",
      offerFilter: ["girl", "all"],
    };
  }
  return {
    persona,
    emoji: "\u{1F44B}" + VS16, // 👋
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
