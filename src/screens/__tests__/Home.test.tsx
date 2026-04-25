import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Home } from "@/screens/Home";
import { useApp } from "@/lib/store";

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

    // Section headings prove QuickAction/RechargeTile/TxnRow scaffolding loaded.
    expect(screen.getByText(/Everything UPI!/i)).toBeInTheDocument();
    expect(screen.getByText(/Recharges and bills/i)).toBeInTheDocument();
    expect(screen.getByText(/Payment history/i)).toBeInTheDocument();

    // NavItem labels — guards against the "NavItem is not defined" regression.
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument();
  });

  it("opens the Scan & Pay screen when the scan FAB is tapped", () => {
    render(<Home />);
    const scanBtn = screen.getByRole("button", { name: /scan/i });
    fireEvent.click(scanBtn);
    // ScanPay renders a back affordance; assert we left the home view.
    expect(screen.queryByText(/Everything UPI!/i)).not.toBeInTheDocument();
  });
});
