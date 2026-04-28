// UI regression snapshot for the Profile-state FloatingDock.
//
// On the Profile screen the dock must show ONLY the Profile tab —
// no Home tab, no Scan FAB, and no leftover empty gap from a hidden tab.
// Snapshot the rendered DOM so any reintroduction of those elements (via
// CSS, conditional rendering, or layout regressions) trips the test.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FloatingDock } from "@/components/FloatingDock";

describe("FloatingDock — profile state", () => {
  it("renders only the Profile tab (no Home, no Scan FAB)", () => {
    const { container } = render(<FloatingDock active="profile" />);

    // Profile is present and active.
    const profileBtn = screen.getByRole("button", { name: /^profile$/i });
    expect(profileBtn.getAttribute("aria-current")).toBe("page");

    // Home tab MUST NOT be in the DOM.
    expect(screen.queryByRole("button", { name: /^home$/i })).toBeNull();

    // Scan FAB MUST NOT be in the DOM.
    expect(screen.queryByRole("button", { name: /scan to pay/i })).toBeNull();

    // Defensive: only one button inside the dock pill (the profile tab).
    const pill = container.querySelector(".fd-pill");
    expect(pill).not.toBeNull();
    const tabButtons = pill!.querySelectorAll("button");
    expect(tabButtons.length).toBe(1);
  });

  it("matches the profile-state snapshot (catches hidden-icon / empty-gap regressions)", () => {
    const { container } = render(<FloatingDock active="profile" />);
    // Snapshot the dock root only — keeps the snapshot focused and stable.
    const dock = container.querySelector(".fd-shell");
    expect(dock).not.toBeNull();
    expect(dock).toMatchSnapshot();
  });
});
