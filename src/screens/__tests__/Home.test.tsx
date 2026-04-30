import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Home } from "@/screens/Home";
import { useApp } from "@/lib/store";

// Mock the ProfilePanel so the Home test stays focused on nav → panel wiring
// without requiring a full Supabase round-trip for the panel's own data.
vi.mock("@/components/ProfilePanel", () => ({
  ProfilePanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="profile-panel-mock" role="dialog" aria-label="Profile">
      <h2>Profile</h2>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

describe("Home screen smoke test", () => {
  beforeEach(() => {
    // Seed minimal app state so Home can render without booting flow.
    useApp.setState({
      fullName: "Alex Doe",
      userId: "test-user-id",
    } as Partial<ReturnType<typeof useApp.getState>> as never);
  });

  it("renders without ReferenceErrors and shows core sections", async () => {
    render(<Home />);

    // Greeting from `fullName`
    expect(await screen.findByText(/Hey, Alex/i)).toBeInTheDocument();

    // Section headings prove QuickAction/RechargeTile scaffolding loaded.
    expect(screen.getByText(/Everything UPI/i)).toBeInTheDocument();
    expect(screen.getByText(/Recharges & utilities/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Transaction history/i })).toBeInTheDocument();

    // NavItem labels — guards against the "NavItem is not defined" regression.
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
  });

  it("opens the Scan & Pay screen when the scan FAB is tapped", async () => {
    vi.useFakeTimers();
    try {
      render(<Home />);
      const scanBtn = screen.getByRole("button", { name: /scan to pay/i });
      fireEvent.click(scanBtn);
      // The FAB triggers a 420ms liquid-bloom transition before mounting ScanPay.
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(screen.queryByText(/Everything UPI/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the Profile panel when tapped from the expanded nav", async () => {
    render(<Home />);
    const profileBtn = screen.getByRole("button", { name: /^profile$/i });
    fireEvent.click(profileBtn);
    expect(await screen.findByTestId("profile-panel-mock")).toBeInTheDocument();
  });

  it("keeps the Profile tab reachable and openable when the nav is collapsed", async () => {
    render(<Home />);

    // Profile wrapper must never be hidden — even in the collapsed scroll state.
    const wrap = screen.getByTestId("hp-nav-profile-wrap");
    expect(wrap.getAttribute("data-hidden")).toBe("false");

    // Tap should still mount the panel.
    const profileBtn = screen.getByRole("button", { name: /^profile$/i });
    fireEvent.click(profileBtn);
    expect(await screen.findByTestId("profile-panel-mock")).toBeInTheDocument();
  });
});
