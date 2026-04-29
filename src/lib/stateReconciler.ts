// State reconciler — runs on every app boot AND when entering /onboarding.
// Detects every known "stuck" / "wrong screen" combination and repairs it
// in-place by mutating the persisted state to a consistent snapshot the
// router can immediately make a correct decision from.
//
// The reconciler is intentionally pure-ish: takes a snapshot of localStorage,
// returns a list of repairs it applied + the final snapshot. The caller is
// expected to apply the repairs (write back to storage). This makes the
// logic trivially unit-testable — no DOM, no router, no async.
//
// Inconsistencies we know about and what we do:
//   • permsSeen=true but stage<STAGE_3 (impossible state from clearing data
//     mid-flow) → drop permsSeen so the user re-grants them.
//   • stage>=STAGE_3 but no userId AND no live session → reset stage to
//     STAGE_2 so the user re-authenticates instead of staring at KYC for
//     a logged-out account.
//   • referralPending=true but stage>=STAGE_4 (KYC submitted) → mark
//     referral done; the optional prompt should never re-appear once KYC
//     is in motion.
//   • Live Supabase session present → mark referral done so a returning
//     user on a new device never sees the "Got an invite?" nag.
//   • Stage is not a valid enum value → reset to STAGE_0.
//   • KYC pending state cached but stage<STAGE_4 → clear the cache so we
//     don't show "verifying…" for a user who never submitted.
//   • KYC pending state cached but stage>=STAGE_5 (already approved) →
//     clear the cache; the user is past the pending screen.
//   • KYC rejection reason cached but stage>=STAGE_5 → clear it.

import {
  PERSIST_KEY,
  PERMISSIONS_DONE_KEY,
  readPersistedSnapshot,
  readSessionFromStorage,
  stageRank,
} from "./bootSelfCheck";
import type { Stage } from "./store";

const REFERRAL_PROMPT_KEY = "tw-referral-prompt-v1";
const KYC_PENDING_STATE_KEY = "tw-kyc-pending-state-v1";
const KYC_REJECTION_REASON_KEY = "tw-kyc-rejection-reason";

export type RepairCode =
  | "PERMS_DROPPED_STAGE_TOO_LOW"
  | "STAGE_RESET_NO_AUTH"
  | "REFERRAL_DISMISSED_KYC_IN_FLIGHT"
  | "REFERRAL_DISMISSED_LIVE_SESSION"
  | "STAGE_RESET_INVALID_ENUM"
  | "KYC_PENDING_CLEARED_STAGE_TOO_LOW"
  | "KYC_PENDING_CLEARED_ALREADY_APPROVED"
  | "KYC_REJECTION_CLEARED_ALREADY_APPROVED";

export interface Repair {
  code: RepairCode;
  detail: Record<string, unknown>;
}

export interface ReconcileResult {
  repairs: Repair[];
  finalStage: Stage;
  finalUserId: string | null;
  changed: boolean;
}

const VALID_STAGES = new Set<Stage>([
  "STAGE_0", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5",
]);

function writePersistedStage(stage: Stage, userId: string | null, storage: Storage) {
  const raw = storage.getItem(PERSIST_KEY);
  let parsed: { state?: Record<string, unknown>; version?: number } = {};
  if (raw) { try { parsed = JSON.parse(raw); } catch { /* fall through */ } }
  const state = (parsed.state ?? {}) as Record<string, unknown>;
  state.stage = stage;
  state.userId = userId;
  parsed.state = state;
  parsed.version = parsed.version ?? 2;
  storage.setItem(PERSIST_KEY, JSON.stringify(parsed));
}

/**
 * Inspect persisted state and apply every repair needed to bring it back to
 * a consistent shape. Safe to call repeatedly; idempotent — a freshly
 * reconciled snapshot produces zero new repairs on the next call.
 */
export function reconcileAppState(storage?: Storage): ReconcileResult {
  const ls = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!ls) {
    return { repairs: [], finalStage: "STAGE_0", finalUserId: null, changed: false };
  }

  const repairs: Repair[] = [];

  // Inspect the RAW persisted blob first so we can detect invalid stage
  // enums BEFORE readPersistedSnapshot silently coerces them to STAGE_0.
  let rawStage: unknown = undefined;
  let rawCorrupt = false;
  const rawBlob = ls.getItem(PERSIST_KEY);
  if (rawBlob) {
    try {
      const parsed = JSON.parse(rawBlob) as { state?: { stage?: unknown } };
      rawStage = parsed?.state?.stage;
    } catch {
      rawCorrupt = true;
    }
  }

  const snap = readPersistedSnapshot(ls);
  let stage: Stage = snap.stage;
  let userId: string | null = snap.userId;
  const session = readSessionFromStorage(ls);
  const hasLiveSession = session.hasSession || !!session.userId;
  let permsSeen = ls.getItem(PERMISSIONS_DONE_KEY) === "1";
  let referralPending = ls.getItem(REFERRAL_PROMPT_KEY) !== "done";

  // 1) Stage is not a valid enum (corruption / version skew) → reset and
  // record a repair. We compare against the RAW value so the coercion
  // inside readPersistedSnapshot doesn't mask the inconsistency.
  const rawStageInvalid =
    rawBlob != null && !rawCorrupt &&
    typeof rawStage === "string" && !VALID_STAGES.has(rawStage as Stage);
  if (rawCorrupt || rawStageInvalid || !VALID_STAGES.has(stage)) {
    repairs.push({
      code: "STAGE_RESET_INVALID_ENUM",
      detail: { from: rawStage ?? snap.stage, corrupt: rawCorrupt },
    });
    stage = "STAGE_0";
    userId = null;
    writePersistedStage(stage, userId, ls);
  }

  // 2) Stage advanced past phone-verified but no userId AND no live session.
  // This is the "logged out but stuck on KYC" trap. Send them back to login.
  if (stageRank[stage] >= stageRank["STAGE_3"] && !userId && !hasLiveSession) {
    repairs.push({
      code: "STAGE_RESET_NO_AUTH",
      detail: { from: stage, to: "STAGE_2" },
    });
    stage = "STAGE_2";
    writePersistedStage(stage, userId, ls);
  }

  // 3) permsSeen=true but stage too low to have ever reached the
  // permissions screen → user must have cleared partial state. Drop it.
  if (permsSeen && stageRank[stage] < stageRank["STAGE_3"]) {
    repairs.push({
      code: "PERMS_DROPPED_STAGE_TOO_LOW",
      detail: { stage },
    });
    try { ls.removeItem(PERMISSIONS_DONE_KEY); } catch { /* ignore */ }
    permsSeen = false;
  }

  // 4) Referral prompt still pending but KYC already submitted → user is
  // way past the optional referral nag; suppress it forever.
  if (referralPending && stageRank[stage] >= stageRank["STAGE_4"]) {
    repairs.push({
      code: "REFERRAL_DISMISSED_KYC_IN_FLIGHT",
      detail: { stage },
    });
    try { ls.setItem(REFERRAL_PROMPT_KEY, "done"); } catch { /* ignore */ }
    referralPending = false;
  }

  // 5) Any live auth session at all → suppress the optional referral
  // prompt; auth implies returning user. This is the fix for the
  // "after referral, app stops loading" trap on a fresh device.
  if (referralPending && hasLiveSession) {
    repairs.push({
      code: "REFERRAL_DISMISSED_LIVE_SESSION",
      detail: { sessionUserId: session.userId },
    });
    try { ls.setItem(REFERRAL_PROMPT_KEY, "done"); } catch { /* ignore */ }
    referralPending = false;
  }

  // 6) KYC pending cache present but the user can't possibly be on the
  // pending screen yet → clear it so KycPending doesn't seed stale data.
  const hasPendingCache = !!ls.getItem(KYC_PENDING_STATE_KEY);
  if (hasPendingCache && stageRank[stage] < stageRank["STAGE_4"]) {
    repairs.push({
      code: "KYC_PENDING_CLEARED_STAGE_TOO_LOW",
      detail: { stage },
    });
    try { ls.removeItem(KYC_PENDING_STATE_KEY); } catch { /* ignore */ }
  }
  if (hasPendingCache && stageRank[stage] >= stageRank["STAGE_5"]) {
    repairs.push({
      code: "KYC_PENDING_CLEARED_ALREADY_APPROVED",
      detail: { stage },
    });
    try { ls.removeItem(KYC_PENDING_STATE_KEY); } catch { /* ignore */ }
  }

  // 7) Stale rejection reason for an approved user.
  const hasRejection = !!ls.getItem(KYC_REJECTION_REASON_KEY);
  if (hasRejection && stageRank[stage] >= stageRank["STAGE_5"]) {
    repairs.push({
      code: "KYC_REJECTION_CLEARED_ALREADY_APPROVED",
      detail: { stage },
    });
    try { ls.removeItem(KYC_REJECTION_REASON_KEY); } catch { /* ignore */ }
  }

  return {
    repairs,
    finalStage: stage,
    finalUserId: userId,
    changed: repairs.length > 0,
  };
}
