// KYC step persistence — verifies that when the user refreshes/reopens
// the app at any point in the KYC journey, they resume on exactly the
// right screen instead of getting bounced back to the start.
//
// We test this at the localStorage + reconciler + route-decision layer
// (no DOM) because the KYC screens themselves do real Supabase calls
// that we don't want to mock at this level. The layer under test is the
// PERSISTENCE CONTRACT: the keys, shapes and boot decisions that drive
// "where does the user end up after refresh".

import { describe, it, expect, beforeEach } from "vitest";
import {
  PERSIST_KEY,
  PERMISSIONS_DONE_KEY,
  readPersistedSnapshot,
  stageRank,
} from "@/lib/bootSelfCheck";
import { reconcileAppState } from "@/lib/stateReconciler";
import type { Stage } from "@/lib/store";

// Storage keys owned by the KYC screens. Asserting on them directly
// guarantees the resume contract doesn't drift if a screen is rewritten.
const KYC_DRAFT_KEY = "tw-kyc-draft-v1";
const KYC_DOCS_KEY = "tw-kyc-docs-v1";
const KYC_LAST_SUBMISSION_KEY = "tw-kyc-last-submission-v1";
const KYC_PENDING_STATE_KEY = "tw-kyc-pending-state-v1";
const KYC_REJECTION_REASON_KEY = "tw-kyc-rejection-reason";
const REFERRAL_KEY = "tw-referral-prompt-v1";

function persist(stage: Stage, userId: string | null = "user-kyc") {
  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state: { stage, userId }, version: 2 }),
  );
}
function seedSession(userId = "user-kyc") {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  window.localStorage.setItem(
    "sb-x-auth-token",
    JSON.stringify({ access_token: "x", refresh_token: "x", expires_at: expiresAt, user: { id: userId } }),
  );
}

// Mirrors the OnboardingPage render switch.
type Screen = "AuthPhone" | "Referral" | "Permissions" | "KycFlow" | "KycPending" | "Home";
function resolveScreen(): Screen | "Onboarding" {
  reconcileAppState();
  const { stage } = readPersistedSnapshot();
  const permsSeen = window.localStorage.getItem(PERMISSIONS_DONE_KEY) === "1";
  const referralPending = window.localStorage.getItem(REFERRAL_KEY) !== "done";

  if (stage === "STAGE_0" || stage === "STAGE_1") return "Onboarding";
  if (stage === "STAGE_2") return "AuthPhone";
  if (referralPending && stageRank[stage] >= stageRank["STAGE_3"]) return "Referral";
  if (!permsSeen && stageRank[stage] >= stageRank["STAGE_3"]) return "Permissions";
  if (stage === "STAGE_3") return "KycFlow";
  if (stage === "STAGE_4") return "KycPending";
  return "Home";
}

// Simulate a full app reload: localStorage survives, all in-memory state
// is gone. Then re-resolve which screen the user lands on.
function resumeAfterReload(): Screen | "Onboarding" {
  // (jsdom localStorage already persists across renders within a test —
  //  this helper is a documentation marker for what's being simulated.)
  return resolveScreen();
}

describe("KYC step persistence — user resumes on the right screen after refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedSession();
    window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
    window.localStorage.setItem(REFERRAL_KEY, "done");
  });

  it("resumes the KYC FORM mid-flow: draft + docs persisted across reload", () => {
    persist("STAGE_3");
    // User filled in step 2 of the KYC form before refresh.
    window.localStorage.setItem(KYC_DRAFT_KEY, JSON.stringify({
      name: "Asha Rao", dob: "2008-04-12", gender: "female",
      aadhaar: "1234-5678-9012", step: 2,
      schoolName: "DPS", addrLine1: "1 Foo Rd", addrCity: "Mumbai",
      addrState: "MH", addrPincode: "400001",
    }));
    window.localStorage.setItem(KYC_DOCS_KEY, JSON.stringify({
      front: "kyc/front-uuid.jpg", back: "kyc/back-uuid.jpg",
    }));

    expect(resumeAfterReload()).toBe("KycFlow");

    // Draft + docs survived intact.
    const draft = JSON.parse(window.localStorage.getItem(KYC_DRAFT_KEY)!);
    expect(draft).toMatchObject({ name: "Asha Rao", step: 2 });
    const docs = JSON.parse(window.localStorage.getItem(KYC_DOCS_KEY)!);
    expect(docs.front).toMatch(/kyc\//);
  });

  it("resumes on the PENDING screen after submission: STAGE_4 + persisted submission state", () => {
    persist("STAGE_4");
    // The KycFlow.onDone path persists the last submission and KycPending
    // seeds its UI from this cached state on mount.
    const submittedAt = new Date(Date.now() - 60_000).toISOString();
    window.localStorage.setItem(KYC_LAST_SUBMISSION_KEY, JSON.stringify({
      submissionId: "sub-abc", status: "pending", submittedAt,
    }));
    window.localStorage.setItem(KYC_PENDING_STATE_KEY, JSON.stringify({
      submittedAt, lastSeenAt: submittedAt, lastFetchAt: submittedAt,
      submissionId: "sub-abc",
    }));

    expect(resumeAfterReload()).toBe("KycPending");

    const cached = JSON.parse(window.localStorage.getItem(KYC_PENDING_STATE_KEY)!);
    expect(cached.submissionId).toBe("sub-abc");
    expect(cached.submittedAt).toBe(submittedAt);
  });

  it("resumes on the PENDING screen with rejection reason hydrated for instant render", () => {
    persist("STAGE_4");
    const submittedAt = new Date().toISOString();
    window.localStorage.setItem(KYC_PENDING_STATE_KEY, JSON.stringify({
      submittedAt, lastSeenAt: submittedAt, lastFetchAt: submittedAt,
      submissionId: "sub-rejected",
    }));
    window.localStorage.setItem(KYC_REJECTION_REASON_KEY, "Selfie blurry");

    expect(resumeAfterReload()).toBe("KycPending");
    expect(window.localStorage.getItem(KYC_REJECTION_REASON_KEY)).toBe("Selfie blurry");
  });

  it("resumes on HOME after KYC approval (STAGE_5) — pending cache is auto-cleared", () => {
    persist("STAGE_5");
    // Stale pending cache from before approval — reconciler must clear it
    // so KycPending doesn't briefly show "verifying…" on refresh.
    window.localStorage.setItem(KYC_PENDING_STATE_KEY, JSON.stringify({
      submittedAt: "2025-01-01T00:00:00Z", lastSeenAt: "2025-01-01T00:00:00Z",
      lastFetchAt: "2025-01-01T00:00:00Z", submissionId: "old",
    }));
    window.localStorage.setItem(KYC_REJECTION_REASON_KEY, "stale-reason");

    expect(resumeAfterReload()).toBe("Home");
    expect(window.localStorage.getItem(KYC_PENDING_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem(KYC_REJECTION_REASON_KEY)).toBeNull();
  });

  it("does NOT advance to KycPending if the user logged out (no session, no userId)", () => {
    window.localStorage.removeItem("sb-x-auth-token");
    persist("STAGE_4", null);
    // Reconciler should drop the impossible state to STAGE_2 (re-login).
    expect(resumeAfterReload()).toBe("AuthPhone");
  });

  it("KYC progression is monotonic across simulated reloads at every step", () => {
    const journey: Array<{ stage: Stage; expected: Screen }> = [
      { stage: "STAGE_3", expected: "KycFlow" },
      { stage: "STAGE_4", expected: "KycPending" },
      { stage: "STAGE_5", expected: "Home" },
    ];
    for (const step of journey) {
      persist(step.stage);
      // Each iteration is a fresh "reload" — only persisted state remains.
      expect(resumeAfterReload()).toBe(step.expected);
      // And the persisted enum is exactly what we set.
      expect(readPersistedSnapshot().stage).toBe(step.stage);
    }
  });
});
