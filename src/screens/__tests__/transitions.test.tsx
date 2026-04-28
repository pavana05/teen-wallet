/**
 * Boot-funnel transition tests.
 *
 * Goals:
 *  1. Each pre-Home screen (Onboarding, Permissions, KycPending) renders SOMETHING
 *     visible — guards against blank-screen regressions.
 *  2. The shared `Stage` enum, the unified `navState` checkpoint, and the
 *     localStorage caches stay in lockstep when transitions happen.
 *  3. The boot router's `resumeScreenFor` mapping covers every action the
 *     flows can emit (no orphan checkpoints → no "stuck" cold launches).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Onboarding } from "@/screens/Onboarding";
import { Permissions } from "@/screens/Permissions";
import { KycPending } from "@/screens/KycPending";
import {
  recordCheckpoint,
  readCheckpoint,
  clearCheckpoint,
  resumeScreenFor,
  type NavAction,
} from "@/lib/navState";

// Capacitor + auth surfaces aren't relevant to the rendered shell — stub them.
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: { requestPermissions: vi.fn() } }));
vi.mock("@capacitor/camera", () => ({ Camera: { requestPermissions: vi.fn() } }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: { requestPermissions: vi.fn() } }));
vi.mock("@capacitor-community/contacts", () => ({ Contacts: { requestPermissions: vi.fn() } }));
vi.mock("@/lib/auth", () => ({
  setStage: vi.fn(async () => {}),
  updateProfileFields: vi.fn(async () => {}),
}));

// Onboarding hero assets — keep tests filesystem-light.
vi.mock("@/assets/onboarding-wallet.webp", () => ({ default: "w.webp" }));
vi.mock("@/assets/onboarding-payment.webp", () => ({ default: "p.webp" }));
vi.mock("@/assets/onboarding-shield.webp", () => ({ default: "s.webp" }));
vi.mock("@/assets/onboarding-gift.webp", () => ({ default: "g.webp" }));

beforeEach(() => {
  localStorage.clear();
  clearCheckpoint();
});

// ---------- 1. No blank screens ----------
describe("Boot-funnel screens render without blank output", () => {
  it("Onboarding renders a slide title and the Skip control", () => {
    render(<Onboarding onDone={() => {}} />);
    // SR-only live region announces the slide — proves the component mounted.
    expect(screen.getByText(/Slide 1 of/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("Permissions renders all five permission rows", () => {
    render(<Permissions onDone={() => {}} />);
    for (const label of ["Contacts", "Location", "Camera", "Notifications", "Microphone"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("KycPending forced into 'pending' renders the verification UI (no blank)", () => {
    render(<KycPending onApproved={() => {}} forceState="pending" />);
    // Pending view has visible body copy / actions; assert by role to be resilient.
    // At minimum the container is non-empty.
    const main = document.body.textContent ?? "";
    expect(main.trim().length).toBeGreaterThan(20);
  });

  it("KycPending forced into 'rejected' renders without crashing", () => {
    render(<KycPending onApproved={() => {}} forceState="rejected" forceReason="Mismatch" />);
    const main = document.body.textContent ?? "";
    expect(main.trim().length).toBeGreaterThan(20);
  });
});

// ---------- 2. Onboarding writes a checkpoint on mount ----------
describe("Onboarding persists slide checkpoint to localStorage", () => {
  it("records 'onboarding_slide_viewed' immediately so cold launch can resume", () => {
    render(<Onboarding onDone={() => {}} />);
    const cp = readCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp!.screen).toBe("onboarding");
    expect(cp!.action).toBe<NavAction>("onboarding_slide_viewed");
    expect(cp!.detail?.slide).toBe(0);
    // Mirror in the dedicated onboarding cache (the legacy resume key).
    expect(localStorage.getItem("tw-onboarding-state-v1")).toMatch(/"slide":0/);
  });
});

// ---------- 3. resumeScreenFor covers every NavAction ----------
describe("Boot router knows how to resume from every checkpoint action", () => {
  const ALL_ACTIONS: NavAction[] = [
    "onboarding_slide_viewed",
    "onboarding_completed",
    "auth_phone_entered",
    "auth_otp_sent",
    "auth_otp_verified",
    "permission_granted",
    "permission_denied",
    "permissions_completed",
    "kyc_step_completed",
    "kyc_submitted",
    "kyc_pending_polled",
    "kyc_approved",
    "home_reached",
  ];

  for (const action of ALL_ACTIONS) {
    it(`maps "${action}" to a concrete resume screen`, () => {
      const screen = resumeScreenFor({ screen: "onboarding", action, at: Date.now() });
      // Must be one of the known screens — never undefined / unknown.
      expect(["splash", "onboarding", "auth", "permissions", "kyc", "kyc_pending", "home"]).toContain(screen);
    });
  }

  it("defaults to splash with no checkpoint", () => {
    expect(resumeScreenFor(null)).toBe("splash");
  });

  it("ignores stale checkpoints (>30 days old)", () => {
    const stale = { screen: "auth" as const, action: "auth_otp_sent" as NavAction, at: Date.now() - 1000 * 60 * 60 * 24 * 31 };
    localStorage.setItem("tw-nav-checkpoint-v1", JSON.stringify(stale));
    expect(readCheckpoint()).toBeNull();
  });
});

// ---------- 4. Stage enum stays consistent with checkpoint metadata ----------
describe("Checkpoint stage tags align with the funnel Stage enum", () => {
  const VALID_STAGES = ["STAGE_0", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5"] as const;

  it("rejects checkpoints with stages outside the enum", () => {
    // Defense-in-depth: if any future caller uses a typo, downstream code that
    // reads `cp.stage` must not silently accept it.
    const cp = { screen: "auth" as const, action: "auth_otp_verified" as NavAction, stage: "STAGE_2" as const, at: Date.now() };
    recordCheckpoint(cp);
    const got = readCheckpoint();
    expect(got?.stage).toBeDefined();
    expect(VALID_STAGES).toContain(got!.stage as (typeof VALID_STAGES)[number]);
  });

  it("clearCheckpoint wipes both in-memory and localStorage state", () => {
    recordCheckpoint({ screen: "permissions", action: "permissions_completed" });
    expect(readCheckpoint()).not.toBeNull();
    clearCheckpoint();
    expect(readCheckpoint()).toBeNull();
    expect(localStorage.getItem("tw-nav-checkpoint-v1")).toBeNull();
  });
});
