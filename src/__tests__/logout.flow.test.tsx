/**
 * End-to-end behavioral test for the logout flow.
 *
 * Goal: simulate clicking the ConfirmSheet's "Log out" button and verify
 * that — for both fast and slow signOut responses — the app store is
 * reset to STAGE_0 (i.e. the user is bounced back to onboarding).
 *
 * We intentionally exercise the same primitives the real ProfilePanel uses
 * (`logout()` from `@/lib/auth`, `useApp.reset()`, the 2.5s race) inside a
 * minimal React harness so the test stays focused on the logout contract
 * without booting the entire screen graph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";

// Hoist-safe spy that each test reassigns to control the signOut latency.
const signOutImpl = vi.fn(async () => ({ error: null }));

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        signOut: (...args: unknown[]) => signOutImpl(...(args as [])),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: async () => ({ data: { user: null } }),
      },
    },
  };
});

import { logout } from "@/lib/auth";
import { useApp } from "@/lib/store";

/**
 * Minimal harness that mirrors ProfilePanel's onLogout race + ConfirmSheet
 * shape. We don't render the entire ProfilePanel because it pulls in dozens
 * of unrelated subsystems (KYC, AppLock, push) that aren't relevant to the
 * logout contract under test.
 */
function LogoutHarness() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const onConfirm = async () => {
    if (busy) return;
    setBusy(true);
    const remote = logout().catch(() => {});
    await Promise.race([
      remote,
      new Promise((res) => setTimeout(res, 2500)),
    ]);
    useApp.getState().reset();
    setBusy(false);
    setDone(true);
  };
  return (
    <div>
      {!done && (
        <div
          data-testid="confirm-sheet"
          role="alertdialog"
          aria-busy={busy ? "true" : undefined}
          className="z-[100]"
        >
          <button
            data-testid="confirm-sheet-confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Signing out…" : "Log out"}
          </button>
        </div>
      )}
      {done && <div data-testid="onboarding-screen">Onboarding</div>}
    </div>
  );
}

describe("Logout end-to-end", () => {
  beforeEach(() => {
    // Seed an authenticated-looking store so reset() has something to clear.
    useApp.setState({
      stage: "STAGE_5",
      userId: "user-1",
      fullName: "Test User",
      balance: 1234,
      splashSeen: true,
      pendingPhone: null,
    });
    signOutImpl.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands on onboarding after a fast signOut (resolves immediately)", async () => {
    signOutImpl.mockImplementation(async () => ({ error: null }));

    render(<LogoutHarness />);
    expect(useApp.getState().stage).toBe("STAGE_5");

    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    // Button should disable + announce busy synchronously.
    await waitFor(() => {
      expect(screen.getByTestId("confirm-sheet-confirm")).toBeDisabled();
      expect(screen.getByTestId("confirm-sheet")).toHaveAttribute("aria-busy", "true");
    });

    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-screen")).toBeInTheDocument();
    });

    expect(signOutImpl).toHaveBeenCalledTimes(1);
    expect(useApp.getState().stage).toBe("STAGE_0");
    expect(useApp.getState().userId).toBeNull();
  });

  it(
    "still lands on onboarding when signOut is slow (timeout wins)",
    async () => {
      // Don't use fake timers here — @testing-library's `waitFor` polls on
      // real timers, and mixing the two deadlocks. Instead, configure the
      // mock to take longer than the race window and assert the harness
      // still bounces to onboarding via the 2.5s timeout branch.
      let resolveSignOut: (v: { error: null }) => void = () => {};
      signOutImpl.mockImplementation(
        () =>
          new Promise<{ error: null }>((resolve) => {
            resolveSignOut = resolve;
          })
      );

      render(<LogoutHarness />);
      expect(useApp.getState().stage).toBe("STAGE_5");

      fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

      // Mid-flight: the confirm button is disabled and the store hasn't
      // been reset yet — the timeout hasn't fired.
      await waitFor(() => {
        expect(screen.getByTestId("confirm-sheet-confirm")).toBeDisabled();
      });
      expect(useApp.getState().stage).toBe("STAGE_5");

      // After the 2.5s timeout, reset() must run regardless of signOut.
      await waitFor(
        () => {
          expect(screen.queryByTestId("onboarding-screen")).toBeInTheDocument();
        },
        { timeout: 4000 }
      );
      expect(useApp.getState().stage).toBe("STAGE_0");
      expect(useApp.getState().userId).toBeNull();

      // Late signOut resolution must be a safe no-op.
      resolveSignOut({ error: null });
      await new Promise((r) => setTimeout(r, 0));
      expect(useApp.getState().stage).toBe("STAGE_0");
    },
    10000
  );

  it("guards against double-clicks (only one signOut call in flight)", async () => {
    signOutImpl.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 50))
    );

    render(<LogoutHarness />);
    const btn = screen.getByTestId("confirm-sheet-confirm");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-screen")).toBeInTheDocument();
    });
    expect(signOutImpl).toHaveBeenCalledTimes(1);
  });
});
