import { supabase } from "@/integrations/supabase/client";

export type FraudFlag = {
  rule: "VELOCITY" | "AMOUNT_ANOMALY" | "NEW_MERCHANT" | "DAILY_LIMIT" | "NIGHT_TIME" | "GEO_ANOMALY";
  severity: "block" | "warn" | "info";
  message: string;
};

export type FraudReport = {
  flags: FraudFlag[];
  blocked: boolean;
  riskScore: number; // 0-100
  remainingDailyLimit: number;
};

const DAILY_LIMIT = 10_000;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
const VELOCITY_MAX = 5;

interface ScanInput {
  userId: string;
  amount: number;
  upiId: string;
  geoSuspicious?: boolean;
}

export async function scanTransaction({ userId, amount, upiId, geoSuspicious }: ScanInput): Promise<FraudReport> {
  const flags: FraudFlag[] = [];
  const now = new Date();

  const { data: recent } = await supabase
    .from("transactions")
    .select("amount, upi_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  const txns = recent ?? [];

  // Rule 1 — Velocity
  const recentCount = txns.filter((t) => now.getTime() - new Date(t.created_at).getTime() < VELOCITY_WINDOW_MS).length;
  if (recentCount >= VELOCITY_MAX) {
    flags.push({
      rule: "VELOCITY",
      severity: "block",
      message: "Unusual activity detected. Please wait 10 minutes or contact support.",
    });
  }

  // Rule 2 — Amount anomaly (>3x average)
  if (txns.length >= 3) {
    const avg = txns.reduce((s, t) => s + Number(t.amount), 0) / txns.length;
    if (avg > 0 && amount > avg * 3) {
      flags.push({
        rule: "AMOUNT_ANOMALY",
        severity: "warn",
        message: `This is larger than your usual ₹${avg.toFixed(0)} payment. Are you sure?`,
      });
    }
  }

  // Rule 3 — New merchant (this user has never paid this UPI)
  const seen = txns.some((t) => t.upi_id === upiId);
  if (!seen) {
    flags.push({
      rule: "NEW_MERCHANT",
      severity: "warn",
      message: "First time paying this merchant — verify before proceeding.",
    });
  }

  // Rule 4 — Daily limit (calendar day)
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const spentToday = txns
    .filter((t) => new Date(t.created_at) >= dayStart)
    .reduce((s, t) => s + Number(t.amount), 0);
  const remaining = DAILY_LIMIT - spentToday;
  if (amount > remaining) {
    flags.push({
      rule: "DAILY_LIMIT",
      severity: "block",
      message: `Daily limit ₹${DAILY_LIMIT.toLocaleString("en-IN")} exceeded. ₹${remaining.toFixed(0)} remaining today.`,
    });
  }

  // Rule 5 — Night-time (11 PM – 6 AM)
  const hr = now.getHours();
  if (hr >= 23 || hr < 6) {
    flags.push({
      rule: "NIGHT_TIME",
      severity: "warn",
      message: "You're making a late-night payment. Confirm this is intentional.",
    });
  }

  // Rule 6 — Geo anomaly (from caller; placeholder signal)
  if (geoSuspicious) {
    flags.push({
      rule: "GEO_ANOMALY",
      severity: "warn",
      message: "Suspicious location detected for this device.",
    });
  }

  const blocked = flags.some((f) => f.severity === "block");
  const riskScore = Math.min(
    100,
    flags.reduce((s, f) => s + (f.severity === "block" ? 60 : f.severity === "warn" ? 20 : 5), 0),
  );

  return { flags, blocked, riskScore, remainingDailyLimit: Math.max(0, remaining) };
}

export async function logFraudFlags(userId: string, transactionId: string | null, flags: FraudFlag[], resolution: "blocked" | "user_confirmed" | "auto_passed") {
  if (flags.length === 0) return;
  const rows = flags.map((f) => ({
    user_id: userId,
    transaction_id: transactionId,
    rule_triggered: f.rule,
    resolution,
  }));
  await supabase.from("fraud_logs").insert(rows);
}
