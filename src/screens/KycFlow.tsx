import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { updateProfileFields, setStage as persistStage } from "@/lib/auth";
import { SelfieCapture, SELFIE_STORAGE_KEY } from "@/components/SelfieCapture";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = 1 | 2 | 3;
type SelfiePayload = { dataUrl: string; width: number; height: number; bytes: number };

const KYC_DRAFT_KEY = "tw_kyc_draft_v1";

export function KycFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"Male" | "Female" | "Non-binary" | "">("");
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarOtp, setAadhaarOtp] = useState("");
  const [aadhaarOtpSent, setAadhaarOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfie, setSelfie] = useState<SelfiePayload | null>(null);

  const formatAadhaar = (v: string) => v.replace(/\D/g, "").slice(0, 12).replace(/(\d{4})(?=\d)/g, "$1 ");

  function ageFromDob(s: string) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
    if (isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  }

  async function submitStep1() {
    setError("");
    if (name.trim().length < 2) return setError("Enter your full name");
    const age = ageFromDob(dob);
    if (age == null) return setError("Enter DOB as DD/MM/YYYY");
    if (age < 13 || age > 19) return setError("Teen Wallet is for ages 13–19");
    if (!gender) return setError("Select gender");
    setBusy(true);
    const [d, m, y] = dob.split("/");
    await updateProfileFields({ full_name: name.trim(), dob: `${y}-${m}-${d}`, gender });
    setBusy(false);
    setStep(2);
  }

  async function submitStep2() {
    setError("");
    const raw = aadhaar.replace(/\s/g, "");
    if (raw.length !== 12) return setError("Aadhaar must be 12 digits");
    if (!aadhaarOtpSent) {
      setAadhaarOtpSent(true);
      toast.success("OTP sent to Aadhaar-linked mobile (dev: 123456)");
      return;
    }
    if (aadhaarOtp !== "123456") return setError("Invalid Aadhaar OTP (dev: 123456)");
    setBusy(true);
    await updateProfileFields({ aadhaar_last4: raw.slice(-4), kyc_status: "pending" });
    setBusy(false);
    setStep(3);
  }

  async function submitStep3() {
    if (!selfie) {
      setError("Please capture a selfie first");
      return;
    }
    setError("");
    setBusy(true);
    await persistStage("STAGE_4");
    setBusy(false);
    onDone();
  }

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => step > 1 && setStep((s) => (s - 1) as Step)} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs text-muted-foreground">Step {step} of 3</span>
        <div className="w-10" />
      </div>

      <div className="h-1 rounded-full bg-white/5 mb-8 overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {step === 1 && (
        <>
          <h1 className="text-[28px] font-bold">Personal details</h1>
          <p className="text-[#888] text-sm mt-2">We need a few basics to set up your wallet.</p>

          <div className="mt-8 space-y-6">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Full Name</label>
              <input value={name}
                onChange={(e) => setName(e.target.value.replace(/\b\w/g, (c) => c.toUpperCase()))}
                placeholder="Pavan Kumar" className="tw-input text-lg mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Date of Birth</label>
              <input value={dob} onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                let f = d;
                if (d.length > 2) f = d.slice(0, 2) + "/" + d.slice(2);
                if (d.length > 4) f = d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
                setDob(f);
              }} placeholder="DD/MM/YYYY" inputMode="numeric" className="tw-input text-lg mt-1 num-mono" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Gender</label>
              <div className="flex gap-2 mt-3">
                {(["Male", "Female", "Non-binary"] as const).map((g) => (
                  <button key={g} onClick={() => setGender(g)}
                    className={`px-4 py-2 rounded-full text-sm transition-all ${gender === g ? "bg-primary text-primary-foreground" : "glass"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-destructive text-xs mt-4 tw-shake">{error}</p>}
          <div className="flex-1" />
          <button onClick={submitStep1} disabled={busy} className="btn-primary w-full">Continue <ArrowRight className="w-5 h-5" /></button>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="text-[28px] font-bold">Enter your<br/>Aadhaar number</h1>
          <p className="text-[#888] text-sm mt-3">Your data is encrypted end-to-end. We never store your Aadhaar number.</p>

          <div className="mt-10">
            <input value={aadhaar} onChange={(e) => setAadhaar(formatAadhaar(e.target.value))}
              placeholder="XXXX XXXX XXXX" inputMode="numeric"
              className="tw-input text-2xl num-mono tracking-widest" />
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <ShieldCheck className="w-4 h-4 text-primary" /> 256-bit encrypted via Digio
            </div>
          </div>

          {aadhaarOtpSent && (
            <div className="mt-8">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">UIDAI OTP</label>
              <input value={aadhaarOtp} onChange={(e) => setAadhaarOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••" inputMode="numeric" className="tw-input text-2xl num-mono mt-1 tracking-[0.5em]" />
            </div>
          )}

          {error && <p className="text-destructive text-xs mt-4 tw-shake">{error}</p>}
          <div className="flex-1" />
          <button onClick={submitStep2} disabled={busy} className="btn-primary w-full">
            {aadhaarOtpSent ? "Verify Aadhaar" : "Send OTP to Aadhaar mobile"}
            <ArrowRight className="w-5 h-5" />
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="text-[28px] font-bold">Quick selfie check</h1>
          <p className="text-[#888] text-sm mt-3">We use face matching to make sure it's really you.</p>

          <div className="mt-6">
            <SelfieCapture onCapture={(d) => { setSelfie(d); setError(""); }} />
          </div>

          <ul className="mt-4 text-xs text-muted-foreground space-y-1">
            <li>• Look straight into the camera</li>
            <li>• Make sure you have good lighting</li>
            <li>• Remove sunglasses or hats</li>
          </ul>

          {error && <p className="text-destructive text-xs mt-4 tw-shake">{error}</p>}
          <div className="flex-1" />
          <button onClick={submitStep3} disabled={busy || !selfie} className="btn-primary w-full disabled:opacity-50">
            Submit for verification
          </button>
        </>
      )}
    </div>
  );
}
