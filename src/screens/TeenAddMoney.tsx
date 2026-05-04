/**
 * TeenAddMoney — Add money to wallet with amount entry and method selection.
 * Premium dark theme with champagne/gold accents.
 */
import { useState, useCallback } from "react";
import { ArrowLeft, CreditCard, Smartphone, Check, Loader2, Wallet } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { offlineCache } from "@/lib/offlineCache";
import { toast } from "sonner";

interface Props { onBack: () => void }

type Method = "upi" | "card";
type Phase = "amount" | "method" | "processing" | "success";

const QUICK_AMOUNTS = [100, 250, 500, 1000, 2000, 5000];

export function TeenAddMoney({ onBack }: Props) {
  const { userId } = useApp();
  const [phase, setPhase] = useState<Phase>("amount");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("upi");
  const [processing, setProcessing] = useState(false);

  const numAmount = Number(amount) || 0;

  const handleQuickAmount = (n: number) => {
    haptics.tap();
    setAmount(String(n));
  };

  const handleNext = () => {
    if (numAmount < 10) {
      toast.error("Minimum amount is ₹10");
      return;
    }
    if (numAmount > 50000) {
      toast.error("Maximum amount is ₹50,000");
      return;
    }
    haptics.bloom();
    setPhase("method");
  };

  const handleAdd = useCallback(async () => {
    if (!userId || processing) return;
    haptics.press();
    setProcessing(true);
    setPhase("processing");

    try {
      // Insert add-money transaction
      const { error: txErr } = await supabase.from("transactions").insert({
        user_id: userId,
        amount: numAmount,
        merchant_name: method === "upi" ? "UPI Add Money" : "Card Add Money",
        upi_id: method === "upi" ? "self@upi" : "card@gateway",
        note: `Added ₹${numAmount} via ${method.toUpperCase()}`,
        status: "success" as any,
      });
      if (txErr) throw txErr;

      // Update balance
      const { data: profile } = await supabase.from("profiles").select("balance").single();
      if (profile) {
        const newBal = Number(profile.balance) + numAmount;
        await supabase.from("profiles").update({ balance: newBal }).eq("id", userId);
        offlineCache.set("teen_balance", newBal);
      }

      // Notification
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "transaction",
        title: `₹${numAmount} added to wallet`,
        body: `Via ${method.toUpperCase()}`,
      });

      haptics.success();
      setPhase("success");
    } catch (e) {
      console.error("[add-money]", e);
      toast.error("Failed to add money. Please try again.");
      setPhase("method");
    }
    setProcessing(false);
  }, [userId, numAmount, method, processing]);

  const formatAmt = (n: number) => "₹" + n.toLocaleString("en-IN");

  return (
    <div className="flex-1 flex flex-col tam-root overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tam-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tam-title">Add Money</h1>
      </div>

      {phase === "amount" && (
        <div className="px-5 mt-4 flex flex-col flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider tam-label">Enter Amount</p>
          <div className="tam-amount-display mt-4">
            <span className="tam-rupee">₹</span>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="tam-amount-input"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-6">
            {QUICK_AMOUNTS.map((n) => (
              <button key={n} onClick={() => handleQuickAmount(n)} className={`tam-quick ${numAmount === n ? "tam-quick-active" : ""}`}>
                {formatAmt(n)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={handleNext}
            disabled={numAmount < 10}
            className="tam-continue-btn mb-8"
          >
            Continue
          </button>
        </div>
      )}

      {phase === "method" && (
        <div className="px-5 mt-4 flex flex-col flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider tam-label">Adding {formatAmt(numAmount)}</p>
          <p className="text-[11px] tam-sub mt-1">Select payment method</p>

          <div className="flex flex-col gap-3 mt-6">
            <button onClick={() => { haptics.tap(); setMethod("upi"); }} className={`tam-method ${method === "upi" ? "tam-method-active" : ""}`}>
              <div className="tam-method-icon" style={{ background: "oklch(0.5 0.1 280 / 0.15)", color: "oklch(0.7 0.1 280)" }}>
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold tam-title">UPI</p>
                <p className="text-[11px] tam-sub">Instant transfer via UPI</p>
              </div>
              {method === "upi" && <Check className="w-5 h-5" style={{ color: "oklch(0.7 0.14 145)" }} />}
            </button>
            <button onClick={() => { haptics.tap(); setMethod("card"); }} className={`tam-method ${method === "card" ? "tam-method-active" : ""}`}>
              <div className="tam-method-icon" style={{ background: "oklch(0.5 0.08 85 / 0.15)", color: "oklch(0.82 0.06 85)" }}>
                <CreditCard className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold tam-title">Debit / Credit Card</p>
                <p className="text-[11px] tam-sub">Visa, Mastercard, RuPay</p>
              </div>
              {method === "card" && <Check className="w-5 h-5" style={{ color: "oklch(0.7 0.14 145)" }} />}
            </button>
          </div>
          <div className="flex-1" />
          <button onClick={handleAdd} className="tam-continue-btn mb-8">
            Add {formatAmt(numAmount)}
          </button>
        </div>
      )}

      {phase === "processing" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5">
          <div className="tam-processing-ring">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: "oklch(0.82 0.06 85)" }} />
          </div>
          <p className="text-[15px] font-semibold tam-title">Processing...</p>
          <p className="text-[12px] tam-sub">Adding {formatAmt(numAmount)} to your wallet</p>
        </div>
      )}

      {phase === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5">
          <div className="tam-success-circle">
            <Check className="w-10 h-10" style={{ color: "oklch(0.1 0 0)" }} />
          </div>
          <p className="text-xl font-bold tam-title">{formatAmt(numAmount)}</p>
          <p className="text-[13px] tam-sub">Added to your wallet successfully</p>
          <button onClick={() => { haptics.tap(); onBack(); }} className="tam-done-btn mt-6">
            Done
          </button>
        </div>
      )}

      <style>{tamStyles}</style>
    </div>
  );
}

const tamStyles = `
  .tam-root { background: oklch(0.08 0.005 250); color: white; }
  .tam-back {
    width: 40px; height: 40px; border-radius: 14px;
    background: oklch(0.14 0.005 250); border: 1px solid oklch(0.2 0.01 250);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.8 0.02 85); transition: transform 120ms ease;
  }
  .tam-back:active { transform: scale(0.93); }
  .tam-title { color: oklch(0.92 0.01 85); }
  .tam-label { color: oklch(0.82 0.06 85); }
  .tam-sub { color: oklch(0.5 0.01 250); }

  .tam-amount-display {
    display: flex; align-items: baseline; gap: 4px;
    padding: 24px; border-radius: 22px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.2 0.01 250);
  }
  .tam-rupee {
    font-size: 32px; font-weight: 700;
    color: oklch(0.82 0.06 85);
  }
  .tam-amount-input {
    flex: 1; font-size: 40px; font-weight: 800;
    background: transparent; border: none; outline: none;
    color: oklch(0.95 0.01 85);
    -moz-appearance: textfield;
  }
  .tam-amount-input::-webkit-outer-spin-button,
  .tam-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .tam-amount-input::placeholder { color: oklch(0.3 0.01 250); }

  .tam-quick {
    padding: 8px 16px; border-radius: 12px;
    background: oklch(0.14 0.005 250); border: 1px solid oklch(0.2 0.01 250);
    color: oklch(0.7 0.02 85); font-size: 13px; font-weight: 600;
    cursor: pointer; transition: all 150ms ease;
  }
  .tam-quick:active { transform: scale(0.95); }
  .tam-quick-active {
    background: oklch(0.82 0.06 85 / 0.15);
    border-color: oklch(0.82 0.06 85 / 0.4);
    color: oklch(0.82 0.06 85);
  }

  .tam-method {
    display: flex; align-items: center; gap: 14px;
    padding: 18px; border-radius: 18px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.18 0.005 250);
    text-align: left; cursor: pointer;
    transition: all 150ms ease;
  }
  .tam-method:active { transform: scale(0.98); }
  .tam-method-active {
    border-color: oklch(0.82 0.06 85 / 0.35);
    background: oklch(0.14 0.01 85 / 0.5);
  }
  .tam-method-icon {
    width: 44px; height: 44px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }

  .tam-continue-btn {
    width: 100%; padding: 16px; border-radius: 16px;
    background: linear-gradient(135deg, oklch(0.82 0.06 85), oklch(0.72 0.05 60));
    color: oklch(0.1 0 0); font-size: 15px; font-weight: 700;
    border: none; cursor: pointer; transition: transform 120ms ease;
  }
  .tam-continue-btn:active { transform: scale(0.97); }
  .tam-continue-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .tam-processing-ring {
    width: 72px; height: 72px; border-radius: 50%;
    background: oklch(0.12 0.005 250);
    border: 2px solid oklch(0.82 0.06 85 / 0.2);
    display: flex; align-items: center; justify-content: center;
  }

  .tam-success-circle {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, oklch(0.82 0.06 85), oklch(0.7 0.08 60));
    display: flex; align-items: center; justify-content: center;
    animation: tam-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes tam-pop {
    0% { transform: scale(0); }
    100% { transform: scale(1); }
  }

  .tam-done-btn {
    padding: 14px 48px; border-radius: 14px;
    background: oklch(0.16 0.01 250);
    border: 1px solid oklch(0.82 0.06 85 / 0.2);
    color: oklch(0.82 0.06 85); font-size: 14px; font-weight: 700;
    cursor: pointer; transition: transform 120ms ease;
  }
  .tam-done-btn:active { transform: scale(0.96); }

  @media (prefers-reduced-motion: reduce) {
    .tam-success-circle { animation: none; }
  }
`;
