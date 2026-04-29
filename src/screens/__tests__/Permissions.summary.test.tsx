// Permissions summary + sandbox-denial coverage.
//
// In a browser test environment (jsdom), the real geolocation/camera/
// notifications APIs aren't backed by an actual OS prompt. The Permissions
// screen handles that by:
//   • auto-granting phone+sms on web (no API exists)
//   • routing the rest through requestPermission(), which we exercise here
//     by faking permission outcomes via the real DOM APIs jsdom exposes.
//
// These tests focus on the new SUMMARY UI: it must reflect each per-row
// decision exactly and surface a clear "ready to continue" state once
// every permission resolves to granted.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Permissions } from "@/screens/Permissions";

// jsdom doesn't ship a Notification global by default — install a fake.
function installNotification(outcome: "granted" | "denied") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Notification = class {
    static permission = "default";
    static requestPermission = vi.fn().mockResolvedValue(outcome);
  };
}

// Stub geolocation (jsdom omits it). Resolves success → granted, error → denied.
function installGeolocation(outcome: "granted" | "denied") {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, err: PositionErrorCallback) => {
        if (outcome === "granted") ok({ coords: {} } as GeolocationPosition);
        else err({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    },
  });
}

// Stub mediaDevices.getUserMedia for camera.
function installCamera(outcome: "granted" | "denied") {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: outcome === "granted"
        ? vi.fn().mockResolvedValue({ getTracks: () => [{ stop: () => {} }] })
        : vi.fn().mockRejectedValue(new Error("denied")),
    },
  });
}

describe("Permissions — granted/denied summary view", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not render the summary until at least one permission resolves", async () => {
    render(<Permissions onDone={() => {}} />);
    // Phone + SMS auto-grant on web in a useEffect → summary appears as soon
    // as that effect runs. Wait for it explicitly.
    await waitFor(() =>
      expect(screen.getByTestId("perm-summary")).toBeInTheDocument(),
    );
    // Two rows resolved (phone, sms) → "2 granted · 0 denied".
    expect(screen.getByTestId("perm-summary-counts")).toHaveTextContent(
      /2 granted · 0 denied/,
    );
    expect(screen.getByTestId("perm-summary-phone")).toHaveAttribute(
      "data-status", "granted",
    );
    expect(screen.getByTestId("perm-summary-sms")).toHaveAttribute(
      "data-status", "granted",
    );
    // The remaining four are still idle.
    for (const k of ["location", "camera", "contacts", "notifications"]) {
      expect(screen.getByTestId(`perm-summary-${k}`)).toHaveAttribute(
        "data-status", "idle",
      );
    }
  });

  it("reflects sandbox-style denials: camera + notifications + location all denied", async () => {
    installNotification("denied");
    installGeolocation("denied");
    installCamera("denied");
    const user = userEvent.setup();

    render(<Permissions onDone={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("perm-summary-phone")).toHaveAttribute("data-status", "granted"),
    );

    // Tap each browser-blocked row; the summary must mark them denied.
    await act(async () => {
      await user.click(screen.getByLabelText(/All-time location/i));
    });
    await act(async () => {
      await user.click(screen.getByLabelText(/^Camera/i));
    });
    await act(async () => {
      await user.click(screen.getByLabelText(/Notifications/i));
    });

    await waitFor(() => {
      expect(screen.getByTestId("perm-summary-location")).toHaveAttribute("data-status", "denied");
      expect(screen.getByTestId("perm-summary-camera")).toHaveAttribute("data-status", "denied");
      expect(screen.getByTestId("perm-summary-notifications")).toHaveAttribute("data-status", "denied");
    });

    // Counts must add up: 2 granted (phone, sms web auto), 3 denied.
    expect(screen.getByTestId("perm-summary-counts")).toHaveTextContent(
      /2 granted · 3 denied/,
    );
    // No "ready to continue" hint while anything is denied.
    expect(screen.queryByTestId("perm-summary-ready")).not.toBeInTheDocument();
  });

  it("shows the 'ready to continue' summary line and enables Continue once all granted", async () => {
    installNotification("granted");
    installGeolocation("granted");
    installCamera("granted");
    const user = userEvent.setup();

    render(<Permissions onDone={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("perm-summary-phone")).toHaveAttribute("data-status", "granted"),
    );

    // Use the bulk "Allow all permissions" button instead of clicking each row.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /allow all permissions/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("perm-summary-counts")).toHaveTextContent(
        /6 granted · 0 denied/,
      );
    });
    expect(screen.getByTestId("perm-summary-ready")).toBeInTheDocument();

    // The Continue CTA must now be enabled.
    const cta = screen.getByRole("button", { name: /Continue to Teen Wallet/i });
    expect(cta).not.toBeDisabled();
  });

  it("user can recover from sandbox denials by retrying — summary updates live", async () => {
    installNotification("denied");
    installGeolocation("denied");
    installCamera("denied");
    const user = userEvent.setup();
    render(<Permissions onDone={() => {}} />);

    await act(async () => {
      await user.click(screen.getByLabelText(/All-time location/i));
    });
    await waitFor(() =>
      expect(screen.getByTestId("perm-summary-location")).toHaveAttribute("data-status", "denied"),
    );

    // Now flip the underlying API to "granted" and retry the row.
    installGeolocation("granted");
    await act(async () => {
      await user.click(screen.getByLabelText(/All-time location/i));
    });
    await waitFor(() =>
      expect(screen.getByTestId("perm-summary-location")).toHaveAttribute("data-status", "granted"),
    );
  });
});
