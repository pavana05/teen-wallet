import { useEffect } from "react";
import { TWLogo } from "@/components/TWLogo";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 tw-slide-up">
      <TWLogo size={120} />
      <div className="text-center">
        <h1 className="text-white font-light text-sm" style={{ letterSpacing: "0.5em" }}>
          TEEN WALLET
        </h1>
        <p className="text-[11px] italic text-[#888] mt-3">by Pavan</p>
      </div>
      <div className="absolute bottom-10 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary tw-pulse-ring" style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </div>
    </div>
  );
}
