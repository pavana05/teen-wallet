import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScanPay } from "@/screens/ScanPay";
import { useApp } from "@/lib/store";

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: vi.fn(),
}));

vi.mock("@/lib/fraud", () => ({
  scanTransaction: vi.fn(async () => ({ flags: [], blocked: false })),
  logFraudFlags: vi.fn(),
}));

describe("ScanPay wallet balance pill", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    useApp.setState({
      userId: null,
      balance: 2396,
    } as Partial<ReturnType<typeof useApp.getState>> as never);

    window.sessionStorage.setItem(
      "tw-scanpay-flow-v1",
      JSON.stringify({
        phase: "confirm",
        payload: {
          upiId: "merchant@upi",
          payeeName: "Premium Merchant",
          amount: null,
          amountRaw: null,
          amountSource: "none",
          note: null,
          currency: "INR",
        },
        amount: 500,
        note: "",
      }),
    );
  });

  it("opens balance details inside the review container without returning to amount entry", async () => {
    render(<ScanPay onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /wallet balance/i })).toBeInTheDocument();
    expect(screen.getByText(/Slide to Pay ₹500/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /wallet balance/i }));

    expect(screen.getByRole("region", { name: /wallet balance details/i })).toBeInTheDocument();
    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByText("After this payment")).toBeInTheDocument();
    expect(screen.getByText("₹2,396.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,896.00")).toBeInTheDocument();
    expect(screen.getByText(/Slide to Pay ₹500/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /digit 1/i })).not.toBeInTheDocument();
  });
});
