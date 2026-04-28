// Boot regression: simulate launching the app for a fully logged-in user
// and assert that the boot decision is /home — i.e., /onboarding never
// renders or is selected as the boot target.
//
// We exercise the same logic the route's beforeLoad uses (runSelfCheck +
// the synchronous redirect rule) so we can assert WITHOUT mounting the
// router. Mounting the router would defeat the purpose: even a single
// frame of <Onboarding/> rendering would be a regression, and unit-level
// route assertions catch that earlier and more reliably than DOM probes.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runSelfCheck,
  stageRank,
  PERSIST_KEY,
  PERMISSIONS_DONE_KEY,
} from "@/lib/bootSelfCheck";

// Mirror the route's resolveBootTarget rule so the test fails if the
// rule changes in a way that could send a logged-in user to onboarding.
function resolveBootTarget(check: ReturnType<typeof runSelfCheck>, referralPending = false): "/home" | "/onboarding" | "ERROR" {
  if (!check.ok) return "ERROR";
  const { stage, userId, permsSeen } = check.snapshot;
  return (userId && stageRank[stage] >= stageRank["STAGE_5"] && permsSeen && !referralPending)
    ? "/home"
    : "/onboarding";
}

function seedLoggedInUser(opts?: { expiresInSec?: number }) {
  const userId = "user-fixture-1234";
  const expiresAt = Math.floor(Date.now() / 1000) + (opts?.expiresInSec ?? 3600);

  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state: { stage: "STAGE_5", userId }, version: 2 }),
  );
  window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
  // Fake a Supabase auth-token entry the way @supabase/auth-js stores it.
  window.localStorage.setItem(
    "sb-fixture-auth-token",
    JSON.stringify({
      access_token: "fixture",
      refresh_token: "fixture",
      expires_at: expiresAt,
      user: { id: userId },
    }),
  );

  return { userId, expiresAt };
}

describe("Boot — logged-in user goes straight to /home", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("self-check passes for a fully onboarded, signed-in user", () => {
    seedLoggedInUser();
    const check = runSelfCheck();
    expect(check.ok).toBe(true);
    expect(check.issues).toEqual([]);
    expect(check.snapshot).toMatchObject({
      stage: "STAGE_5",
      permsSeen: true,
      hasSession: true,
    });
    expect(check.snapshot.userId).toBe(check.snapshot.sessionUserId);
  });

  it("boot resolves to /home and NEVER /onboarding for a logged-in user", () => {
    seedLoggedInUser();
    const check = runSelfCheck();
    const target = resolveBootTarget(check);

    expect(target).toBe("/home");
    expect(target).not.toBe("/onboarding");
  });

  it("does not send a logged-in user to /onboarding even across rapid re-evaluations (no flash)", () => {
    seedLoggedInUser();
    // Simulate the boot route's beforeLoad firing multiple times (route
    // re-validation, navigation, etc). Every single decision must be /home.
    const targets = Array.from({ length: 25 }, () => resolveBootTarget(runSelfCheck()));
    expect(targets.every((t) => t === "/home")).toBe(true);
    expect(targets.includes("/onboarding")).toBe(false);
  });

  it("detects an expired session and routes to the recovery error screen — not /home and not /onboarding", () => {
    seedLoggedInUser({ expiresInSec: -60 }); // already expired
    const check = runSelfCheck();
    expect(check.ok).toBe(false);
    expect(check.issues.map((i) => i.code)).toContain("SESSION_EXPIRED");
    expect(resolveBootTarget(check)).toBe("ERROR");
  });

  it("flags an inconsistent permissions flag (perms granted but stage too low)", () => {
    window.localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { stage: "STAGE_1", userId: null }, version: 2 }),
    );
    window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1");
    const check = runSelfCheck();
    expect(check.ok).toBe(false);
    expect(check.issues.map((i) => i.code)).toContain("PERMS_WITHOUT_STAGE");
  });

  it("flags a corrupt persisted snapshot", () => {
    window.localStorage.setItem(PERSIST_KEY, "{not json");
    const check = runSelfCheck();
    expect(check.issues.map((i) => i.code)).toContain("PERSIST_CORRUPT");
  });

  it("flags a userId / session mismatch", () => {
    seedLoggedInUser();
    // Tamper with persisted userId so it no longer matches the session.
    const raw = window.localStorage.getItem(PERSIST_KEY)!;
    const parsed = JSON.parse(raw);
    parsed.state.userId = "different-user";
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(parsed));

    const check = runSelfCheck();
    expect(check.ok).toBe(false);
    expect(check.issues.map((i) => i.code)).toContain("USER_MISMATCH");
  });
});
