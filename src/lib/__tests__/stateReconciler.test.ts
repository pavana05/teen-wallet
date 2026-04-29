import { describe, it, expect, beforeEach } from "vitest";
import { reconcileAppState } from "@/lib/stateReconciler";
import {
  PERSIST_KEY,
  PERMISSIONS_DONE_KEY,
  readPersistedSnapshot,
  readSessionFromStorage,
} from "@/lib/bootSelfCheck";
import type { Stage } from "@/lib/store";

const REFERRAL_KEY = "tw-referral-prompt-v1";
const KYC_PENDING_KEY = "tw-kyc-pending-state-v1";
const KYC_REJECT_KEY = "tw-kyc-rejection-reason";

function persist(stage: Stage, userId: string | null = null) {
  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state: { stage, userId }, version: 2 }),
  );
}
function seedSession(userId = "user-1") {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  window.localStorage.setItem(
    "sb-x-auth-token",
    JSON.stringify({ access_token: "x", refresh_token: "x", expires_at: expiresAt, user: { id: userId } }),
  );
}

describe("reconcileAppState — repairs every known stuck state", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("is a no-op for a clean STAGE_0 snapshot", () => {
    persist("STAGE_0", null);
    const r = reconcileAppState();
    expect(r.changed).toBe(false);
    expect(r.repairs).toEqual([]);
    expect(r.finalStage).toBe("STAGE_0");
  });

  it("invalid stage enum → reset to STAGE_0", () => {
    window.localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { stage: "STAGE_99", userId: "u" }, version: 2 }),
    );
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).toContain("STAGE_RESET_INVALID_ENUM");
    expect(readPersistedSnapshot().stage).toBe("STAGE_0");
  });

  it("stage>=STAGE_3 with no auth at all → reset to STAGE_2 (re-login)", () => {
    persist("STAGE_4", null);
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).toContain("STAGE_RESET_NO_AUTH");
    expect(readPersistedSnapshot().stage).toBe("STAGE_2");
  });

  it("stage>=STAGE_3 with live session and no userId → keeps stage (auth exists)", () => {
    persist("STAGE_4", null);
    seedSession("session-user");
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).not.toContain("STAGE_RESET_NO_AUTH");
    expect(readPersistedSnapshot().stage).toBe("STAGE_4");
  });

  it("permsSeen=true but stage<STAGE_3 → drops permsSeen", () => {
    persist("STAGE_1", null);
    window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).toContain("PERMS_DROPPED_STAGE_TOO_LOW");
    expect(window.localStorage.getItem(PERMISSIONS_DONE_KEY)).toBeNull();
  });

  it("referralPending + KYC in flight → suppress referral nag", () => {
    persist("STAGE_4", "u");
    seedSession("u");
    // referral key absent = pending
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).toContain("REFERRAL_DISMISSED_KYC_IN_FLIGHT");
    expect(window.localStorage.getItem(REFERRAL_KEY)).toBe("done");
  });

  it("referralPending + any live session → suppress nag (returning user)", () => {
    persist("STAGE_3", "u");
    seedSession("u");
    const r = reconcileAppState();
    const codes = r.repairs.map(x => x.code);
    // either path is acceptable (KYC_IN_FLIGHT triggers at STAGE_4+, this is STAGE_3)
    expect(codes).toContain("REFERRAL_DISMISSED_LIVE_SESSION");
    expect(window.localStorage.getItem(REFERRAL_KEY)).toBe("done");
  });

  it("KYC pending cache present but stage<STAGE_4 → clear it", () => {
    persist("STAGE_3", "u");
    seedSession("u");
    window.localStorage.setItem(KYC_PENDING_KEY, JSON.stringify({ submittedAt: "x" }));
    const r = reconcileAppState();
    expect(r.repairs.map(x => x.code)).toContain("KYC_PENDING_CLEARED_STAGE_TOO_LOW");
    expect(window.localStorage.getItem(KYC_PENDING_KEY)).toBeNull();
  });

  it("KYC pending cache present but already approved → clear it", () => {
    persist("STAGE_5", "u");
    seedSession("u");
    window.localStorage.setItem(KYC_PENDING_KEY, JSON.stringify({ submittedAt: "x" }));
    window.localStorage.setItem(KYC_REJECT_KEY, "stale reason");
    const r = reconcileAppState();
    const codes = r.repairs.map(x => x.code);
    expect(codes).toContain("KYC_PENDING_CLEARED_ALREADY_APPROVED");
    expect(codes).toContain("KYC_REJECTION_CLEARED_ALREADY_APPROVED");
    expect(window.localStorage.getItem(KYC_PENDING_KEY)).toBeNull();
    expect(window.localStorage.getItem(KYC_REJECT_KEY)).toBeNull();
  });

  it("is idempotent — second call after a repair produces no further repairs", () => {
    persist("STAGE_4", null);
    window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); // also corrupt
    const first = reconcileAppState();
    expect(first.changed).toBe(true);
    const second = reconcileAppState();
    expect(second.repairs).toEqual([]);
    expect(second.changed).toBe(false);
  });

  it("preserves userId when fixing referral but doesn't drop session info", () => {
    persist("STAGE_4", "u");
    seedSession("u");
    reconcileAppState();
    expect(readPersistedSnapshot().userId).toBe("u");
    expect(readSessionFromStorage().userId).toBe("u");
  });
});
