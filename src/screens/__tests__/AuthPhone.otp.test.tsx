import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for OTP backspace focus-jump and haptic gating logic.
 * These exercise the component's onKeyDown handler behaviour:
 *   1. Backspace on an empty slot jumps focus to previous slot.
 *   2. Backspace on an empty slot does NOT fire haptics when previous slot is also empty.
 *   3. Backspace on an empty slot DOES fire haptics when previous slot has a digit.
 */

// Mock haptics before importing component
const tapMock = vi.fn();
const selectMock = vi.fn();
vi.mock("@/lib/haptics", () => ({
  haptics: {
    tap: tapMock,
    select: selectMock,
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    bloom: vi.fn(),
    swipe: vi.fn(),
    press: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
  },
}));

// Mock auth / store / supabase so the component can render
vi.mock("@/lib/auth", () => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  setStage: vi.fn(),
  fetchProfile: vi.fn(),
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ setPendingPhone: vi.fn(), hydrateFromProfile: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ data: null }) }) }) }),
  },
}));
vi.mock("@/lib/otpState", () => ({
  loadOtpState: () => null,
  saveOtpState: vi.fn(),
  clearOtpState: vi.fn(),
  classifyOtpError: vi.fn(),
  logOtpErrorEvent: vi.fn(),
}));
vi.mock("@/lib/justVerified", () => ({ isJustVerified: () => false }));
vi.mock("@/lib/navState", () => ({ recordCheckpoint: vi.fn() }));
vi.mock("@/lib/notify", () => ({ maybeInsertWelcome: vi.fn() }));
vi.mock("@/lib/googleLink", () => ({
  getLoginRequirements: vi.fn(),
  registerCurrentDeviceTrusted: vi.fn(),
}));
vi.mock("@/lib/phoneHint", () => ({
  isPhoneHintAvailable: vi.fn().mockResolvedValue(false),
  requestPhoneHint: vi.fn(),
  liveNormalizePhoneInput: (v: string) => v.replace(/\D/g, "").slice(0, 10),
  classifyPhoneField: (p: string) => (p.length === 10 ? "valid" : "incomplete"),
}));
vi.mock("@/components/ResendCountdown", () => ({
  ResendCountdown: () => <div data-testid="resend" />,
}));
vi.mock("@/screens/PhoneVerified", () => ({
  PhoneVerified: () => <div>verified</div>,
}));
vi.mock("@/screens/VerifyGoogleOnNewDevice", () => ({
  VerifyGoogleOnNewDevice: () => <div>google-gate</div>,
}));
vi.mock("@/components/CopyableErrorId", () => ({
  CopyableErrorId: () => null,
}));

import { render, fireEvent, screen } from "@testing-library/react";
import { AuthPhone } from "../AuthPhone";

// Helper: render and navigate to OTP step
async function renderOtpStep(prefill: string[] = ["", "", "", "", "", ""]) {
  const { container } = render(<AuthPhone onDone={vi.fn()} />);
  // Type a valid phone to enable Send OTP
  const phoneInput = container.querySelector("input[type='tel']") as HTMLInputElement;
  fireEvent.change(phoneInput, { target: { value: "9876543210" } });

  // We need to directly get to OTP step — simulate by importing sendOtp mock
  const { sendOtp } = await import("@/lib/auth");
  (sendOtp as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, devOtp: "123456" });

  const btn = screen.getByText("Send OTP");
  fireEvent.click(btn);

  // Wait for OTP step
  await vi.waitFor(() => {
    expect(screen.getByText("Enter OTP")).toBeTruthy();
  });

  // Pre-fill OTP slots if requested
  const otpInputs = container.querySelectorAll('input[inputmode="numeric"][maxlength="1"]');
  prefill.forEach((digit, i) => {
    if (digit) {
      fireEvent.change(otpInputs[i], { target: { value: digit } });
    }
  });

  return { container, otpInputs };
}

describe("OTP backspace focus-jump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure performance.now returns increasing values past the haptic gap
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => (t += 100));
  });

  it("jumps focus to previous slot on backspace when current slot is empty", async () => {
    const { otpInputs } = await renderOtpStep(["1", "", "", "", "", ""]);
    // Slot 1 is empty; pressing backspace should jump to slot 0
    const slot1 = otpInputs[1] as HTMLInputElement;
    slot1.focus();
    fireEvent.keyDown(slot1, { key: "Backspace" });
    // slot 0 should now be focused
    expect(document.activeElement).toBe(otpInputs[0]);
  });

  it("fires haptics.select when previous slot has a digit", async () => {
    const { otpInputs } = await renderOtpStep(["5", "", "", "", "", ""]);
    selectMock.mockClear();
    const slot1 = otpInputs[1] as HTMLInputElement;
    slot1.focus();
    fireEvent.keyDown(slot1, { key: "Backspace" });
    expect(selectMock).toHaveBeenCalled();
  });

  it("does NOT fire haptics when previous slot is empty (noop backspace)", async () => {
    const { otpInputs } = await renderOtpStep(["", "", "", "", "", ""]);
    selectMock.mockClear();
    tapMock.mockClear();
    // Slot 1 is empty, slot 0 is also empty
    const slot1 = otpInputs[1] as HTMLInputElement;
    slot1.focus();
    fireEvent.keyDown(slot1, { key: "Backspace" });
    // Focus should still jump, but haptics should NOT fire
    expect(document.activeElement).toBe(otpInputs[0]);
    expect(selectMock).not.toHaveBeenCalled();
    expect(tapMock).not.toHaveBeenCalled();
  });
});
