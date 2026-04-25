import { useEffect } from "react";
import { Check } from "lucide-react";
import { updateProfileFields, setStage as persistStage } from "@/lib/auth";

export function KycPending({ onApproved }: { onApproved: () => void }) {
  useEffect(() => {
    // Simulated Digio polling — auto approve in 6s
    const t = setTimeout(async () => {
      await updateProfileFields({ kyc_status: "approved" });
      await persistStage("STAGE_5");
      onApproved();
    }, 6000);
    return () => clearTimeout(t);
  }, [onApproved]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center tw-slide-up">
      <div className="relative mb-8">
        <div className="absolute inset-0 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(circle, oklch(0.92 0.21 122 / 0.6), transparent 70%)" }} />
        <div className="relative w-24 h-24 rounded-full bg-primary flex items-center justify-center lime-glow">
          <Check className="w-12 h-12 text-primary-foreground" strokeWidth={3} />
        </div>
      </div>

      <h1 className="text-[28px] font-bold">You're almost there!</h1>
      <p className="text-[#888] text-sm mt-3 max-w-[280px]">We're verifying your details with UIDAI. This usually takes under 2 minutes.</p>

      <div className="mt-10 w-full max-w-[280px] h-1 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full" style={{ animation: "tw-shimmer 1.4s linear infinite" }} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">We'll notify you the moment your account is ready.</p>
    </div>
  );
}
