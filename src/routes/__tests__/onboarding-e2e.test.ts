// End-to-end onboarding journey test.
//
// Drives the user through every step the app requires:
//   1. Onboarding intro      (STAGE_0 / STAGE_1)
//   2. Login / phone auth    (STAGE_2  → STAGE_3)
//   3. Permissions           (perms-seen flag flips)
//   4. KYC                   (STAGE_3  → STAGE_4)
//   5. Confirmation          (STAGE_4  → STAGE_5)
//   6. Home                  (boot decision flips to /home)
//
// At each transition we assert two things:
//   • the resolved boot/onboarding route target (no flash to /onboarding
//     once the user is fully onboarded), and
//   • the persisted `Stage` enum value in localStorage matches the
//     expected step (proving cross-restart resume works).
//
// We also explicitly test that an already-authenticated user (live
// supabase session) is sent to /home and never sees the referral or
// permissions intercept.

import { describe, it, expect, beforeEach } from "vitest";
import {
  runSelfCheck,
  stageRank,
  readPersistedSnapshot,
  readSessionFromStorage,
  PERSIST_KEY,
  PERMISSIONS_DONE_KEY,
} from "@/lib/bootSelfCheck";
import {
  shouldShowReferralPrompt,
  markReferralPromptDone,
} from "@/lib/referral";
import type { Stage } from "@/lib/store";

// Mirrors the rule baked into both /index and /onboarding beforeLoads.
function resolveOnboardingRoute(): "/home" | "/onboarding" {
  const { stage, userId } = readPersistedSnapshot();
  const session = readSessionFromStorage();
  const hasLiveSession = session.hasSession || !!session.userId;
  const isFullyOnboarded =
    !!(userId || session.userId) && hasLiveSession &&
    stageRank[stage] >= stageRank["STAGE_5"];
  return isFullyOnboarded ? "/home" : "/onboarding";
}

// Mirrors the OnboardingPage render switch so we can verify which
// SCREEN the user would see at every persisted state.
type Screen =
  | "Onboarding" | "AuthPhone" | "Referral" | "Permissions"
  | "KycFlow" | "KycPending" | "Home";

function resolveOnboardingScreen(): Screen {
  if (resolveOnboardingRoute() === "/home") return "Home";
  const { stage } = readPersistedSnapshot();
  const permsSeen = window.localStorage.getItem(PERMISSIONS_DONE_KEY) === "1";
  const referralPending = shouldShowReferralPrompt();

  if (stage === "STAGE_0" || stage === "STAGE_1") return "Onboarding";
  if (stage === "STAGE_2") return "AuthPhone";
  if (referralPending && stageRank[stage] >= stageRank["STAGE_3"]) return "Referral";
  if (!permsSeen && stageRank[stage] >= stageRank["STAGE_3"]) return "Permissions";
  if (stage === "STAGE_3") return "KycFlow";
  if (stage === "STAGE_4") return "KycPending";
  return "Home";
}

function setStage(stage: Stage, opts?: { userId?: string | null }) {
  const userId = opts?.userId ?? readPersistedSnapshot().userId ?? null;
  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state: { stage, userId }, version: 2 }),
  );
}

function seedSession(userId = "user-e2e-1") {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  window.localStorage.setItem(
    "sb-fixture-auth-token",
    JSON.stringify({
      access_token: "fixture",
      refresh_token: "fixture",
      expires_at: expiresAt,
      user: { id: userId },
    }),
  );
  return userId;
}

describe("E2E onboarding journey: Onboarding → Login → Permissions → KYC → Confirm → Home", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("walks every stage end-to-end and persists the correct enum at each step", () => {
    // ── Step 1: fresh launch — Onboarding intro ──────────────────────
    setStage("STAGE_0");
    expect(readPersistedSnapshot().stage).toBe("STAGE_0");
    expect(resolveOnboardingScreen()).toBe("Onboarding");
    expect(resolveOnboardingRoute()).toBe("/onboarding");

    // Intro completes → STAGE_2 (login).
    setStage("STAGE_2");
    expect(readPersistedSnapshot().stage).toBe("STAGE_2");
    expect(resolveOnboardingScreen()).toBe("AuthPhone");

    // ── Step 2: phone-verified, session created ──────────────────────
    const userId = seedSession();
    setStage("STAGE_3", { userId });
    expect(readPersistedSnapshot()).toMatchObject({
      stage: "STAGE_3",
      userId,
    });
    // Referral prompt is still pending → that screen wins first.
    expect(resolveOnboardingScreen()).toBe("Referral");

    // User taps "Skip for now".
    markReferralPromptDone();
    expect(shouldShowReferralPrompt()).toBe(false);

    // ── Step 3: Permissions ───────────────────────────────────────────
    expect(resolveOnboardingScreen()).toBe("Permissions");
    expect(window.localStorage.getItem(PERMISSIONS_DONE_KEY)).toBeNull();

    window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
    expect(resolveOnboardingScreen()).toBe("KycFlow");

    // ── Step 4: KYC submitted → STAGE_4 (pending confirmation) ────────
    setStage("STAGE_4", { userId });
    expect(readPersistedSnapshot().stage).toBe("STAGE_4");
    expect(resolveOnboardingScreen()).toBe("KycPending");
    // Boot decision still onboarding (KYC not yet approved).
    expect(resolveOnboardingRoute()).toBe("/onboarding");

    // ── Step 5: KYC approved → STAGE_5 ───────────────────────────────
    setStage("STAGE_5", { userId });
    expect(readPersistedSnapshot().stage).toBe("STAGE_5");

    // ── Step 6: Home — boot decision flips, self-check passes ────────
    expect(resolveOnboardingRoute()).toBe("/home");
    expect(resolveOnboardingScreen()).toBe("Home");

    const finalCheck = runSelfCheck();
    expect(finalCheck.ok).toBe(true);
    expect(finalCheck.snapshot).toMatchObject({
      stage: "STAGE_5",
      permsSeen: true,
      hasSession: true,
      userId,
      sessionUserId: userId,
    });
  });

  it("each transition is monotonically forward — stage rank never regresses across the journey", () => {
    const journey: Stage[] = [
      "STAGE_0", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5",
    ];
    seedSession();
    let prevRank = -1;
    for (const stage of journey) {
      setStage(stage, { userId: "user-e2e-monotonic" });
      const rank = stageRank[readPersistedSnapshot().stage];
      expect(rank).toBeGreaterThan(prevRank);
      prevRank = rank;
    }
    expect(prevRank).toBe(stageRank["STAGE_5"]);
  });

  it("fully onboarded user (STAGE_5 + live session) is sent to /home immediately — never lands on referral or permissions", () => {
    const userId = seedSession();
    setStage("STAGE_5", { userId });

    // Even if local-only flags suggest pending prompts, the route must
    // resolve to /home — no flash through referral / permissions.
    expect(shouldShowReferralPrompt()).toBe(true); // never marked done
    expect(window.localStorage.getItem(PERMISSIONS_DONE_KEY)).toBeNull();

    expect(resolveOnboardingRoute()).toBe("/home");
    expect(resolveOnboardingScreen()).toBe("Home");
  });

  it("authenticated user with stale local storage on a new device — referral nag is suppressed", () => {
    // Simulate: user signed in on this device for the first time, so
    // there's a live session but persisted state is fresh. The
    // /onboarding beforeLoad should call markReferralPromptDone on
    // their behalf so they never see the optional referral prompt
    // from a previous device.
    seedSession("returning-user");
    // Pretend the route guard ran (it calls markReferralPromptDone for
    // any live session).
    markReferralPromptDone();

    setStage("STAGE_3", { userId: "returning-user" });
    expect(resolveOnboardingScreen()).not.toBe("Referral");
    // Permissions still gates them (it's device-local), but referral is gone.
    expect(resolveOnboardingScreen()).toBe("Permissions");
  });

  it("does not advance to /home if the session is missing, even when stage=STAGE_5", () => {
    // Edge case: persisted stage somehow reached STAGE_5 but no auth
    // session exists. We must NOT route to /home — the user needs to
    // re-authenticate.
    setStage("STAGE_5", { userId: "ghost-user" });
    expect(readSessionFromStorage().hasSession).toBe(false);
    expect(resolveOnboardingRoute()).toBe("/onboarding");
  });
});
