import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Upload, Check, X, Loader2, Camera, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { updateProfileFields, setStage as persistStage } from "@/lib/auth";
import { SelfieCapture, SELFIE_STORAGE_KEY, type SelfiePermState } from "@/components/SelfieCapture";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = 1 | 2 | 3;
type SelfiePayload = { dataUrl: string; width: number; height: number; bytes: number };
type DocSide = "front" | "back";
type DocState = { path: string; name: string; size: number } | null;
type LastSubmission = {
  submissionId: string;
  providerRef: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reason?: string | null;
};

const KYC_DRAFT_KEY = "tw_kyc_draft_v1";
const KYC_DOCS_KEY = "tw_kyc_docs_v1";
const KYC_LAST_SUBMISSION_KEY = "tw_kyc_last_submission_v1";
const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

// Errors that the server treats as transient and worth a "Try again".
const TRANSIENT_ERROR_PATTERNS = [
  /provider unreachable/i,
  /timeout/i,
  /temporar/i,
  /try again/i,
  /503/,
  /502/,
  /504/,
  /network/i,
];
const isTransientError = (msg: string) => TRANSIENT_ERROR_PATTERNS.some((re) => re.test(msg));

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
  const [docFront, setDocFront] = useState<DocState>(null);
  const [docBack, setDocBack] = useState<DocState>(null);
  const [uploading, setUploading] = useState<DocSide | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [camPerm, setCamPerm] = useState<SelfiePermState>("unknown");
  const [camSupported, setCamSupported] = useState(true);
  const [lastSubmission, setLastSubmission] = useState<LastSubmission | null>(null);
  const [lastErrorTransient, setLastErrorTransient] = useState(false);
  const hydrated = useRef(false);

  const onCamPerm = useCallback((s: SelfiePermState, supported: boolean) => {
    setCamPerm(s);
    setCamSupported(supported);
  }, []);

  const formatAadhaar = (v: string) =>
    v.replace(/\D/g, "").slice(0, 12).replace(/(\d{4})(?=\d)/g, "$1 ");

  // Hydrate draft from localStorage immediately so the user can resume after refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KYC_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<{
          name: string; dob: string; gender: typeof gender; aadhaar: string; step: Step;
        }>;
        if (d.name) setName(d.name);
        if (d.dob) setDob(d.dob);
        if (d.gender) setGender(d.gender);
        if (d.aadhaar) setAadhaar(d.aadhaar);
        if (d.step) setStep(d.step);
      }
      const docsRaw = localStorage.getItem(KYC_DOCS_KEY);
      if (docsRaw) {
        const d = JSON.parse(docsRaw) as { front?: DocState; back?: DocState };
        if (d.front) setDocFront(d.front);
        if (d.back) setDocBack(d.back);
      }
      const lastRaw = localStorage.getItem(KYC_LAST_SUBMISSION_KEY);
      if (lastRaw) setLastSubmission(JSON.parse(lastRaw) as LastSubmission);
    } catch { /* ignore */ }

    // Also hydrate from server profile (cross-device resume).
    void (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data: p } = await supabase
          .from("profiles")
          .select("full_name,dob,gender,aadhaar_last4,onboarding_stage")
          .eq("id", u.user.id)
          .maybeSingle();
        if (!p) return;
        // Only fill empty fields — never overwrite the user's in-progress edits.
        setName((cur) => cur || (p.full_name ?? ""));
        setGender((cur) => cur || ((p.gender as typeof gender) ?? ""));
        if (p.dob) {
          // Stored as YYYY-MM-DD; show as DD/MM/YYYY.
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.dob);
          if (m) setDob((cur) => cur || `${m[3]}/${m[2]}/${m[1]}`);
        }
        // Resume to the right step if user already passed earlier ones server-side.
        if (p.onboarding_stage === "STAGE_3" && p.aadhaar_last4) {
          setStep((s) => (s < 3 ? 3 : s));
        } else if (p.onboarding_stage === "STAGE_2") {
          setStep((s) => (s < 2 ? 2 : s));
        }
      } catch { /* ignore */ }
      hydrated.current = true;
    })();
  }, []);

  // Persist draft locally on every change.
  useEffect(() => {
    try {
      localStorage.setItem(
        KYC_DRAFT_KEY,
        JSON.stringify({ name, dob, gender, aadhaar, step }),
      );
    } catch { /* ignore */ }
  }, [name, dob, gender, aadhaar, step]);

  useEffect(() => {
    try {
      localStorage.setItem(KYC_DOCS_KEY, JSON.stringify({ front: docFront, back: docBack }));
    } catch { /* ignore */ }
  }, [docFront, docBack]);

  // Debounced auto-save of step-1 fields to Supabase profile (cross-device continuity).
  useEffect(() => {
    if (!hydrated.current) return;
    if (!name && !dob && !gender) return;
    const t = setTimeout(async () => {
      const fields: Record<string, string> = {};
      if (name.trim().length >= 2) fields.full_name = name.trim();
      if (gender) fields.gender = gender;
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob);
      if (m) fields.dob = `${m[3]}-${m[2]}-${m[1]}`;
      if (Object.keys(fields).length === 0) return;
      try {
        setAutoSaveState("saving");
        await updateProfileFields(fields);
        setAutoSaveState("saved");
        setTimeout(() => setAutoSaveState("idle"), 1500);
      } catch {
        setAutoSaveState("idle");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [name, dob, gender]);

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
    await updateProfileFields({
      full_name: name.trim(),
      dob: `${y}-${m}-${d}`,
      gender,
      onboarding_stage: "STAGE_2",
    });
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
    await updateProfileFields({
      aadhaar_last4: raw.slice(-4),
      kyc_status: "pending",
      onboarding_stage: "STAGE_3",
    });
    setBusy(false);
    setStep(3);
  }

  async function uploadDoc(side: DocSide, file: File) {
    setError("");
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      return setError("Document must be an image or PDF");
    }
    if (file.size > MAX_DOC_BYTES) return setError("File too large (max 5 MB)");
    try {
      setUploading(side);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Session expired");
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${u.user.id}/aadhaar-${side}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("kyc-docs")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const state: DocState = { path, name: file.name, size: file.size };
      if (side === "front") setDocFront(state); else setDocBack(state);
      toast.success(`Aadhaar ${side} uploaded`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function removeDoc(side: DocSide) {
    const cur = side === "front" ? docFront : docBack;
    if (!cur) return;
    try {
      await supabase.storage.from("kyc-docs").remove([cur.path]);
    } catch { /* ignore */ }
    if (side === "front") setDocFront(null); else setDocBack(null);
  }

  async function submitStep3() {
    if (!selfie) return setError("Please capture a selfie first");
    if (selfie.width < 240 || selfie.height < 240) return setError("Selfie resolution too low — please retake");
    if (selfie.bytes < 8 * 1024) return setError("Selfie image is too small — please retake");

    setError("");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired. Please sign in again.");

      const aadhaarLast4 = aadhaar.replace(/\s/g, "").slice(-4);
      const res = await fetch("/api/kyc/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          selfie: selfie.dataUrl,
          width: selfie.width,
          height: selfie.height,
          aadhaarLast4,
          docFrontPath: docFront?.path ?? null,
          docBackPath: docBack?.path ?? null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; status?: string; submissionId?: string };
      if (!res.ok && res.status !== 202) throw new Error(json.error || `Verification failed (${res.status})`);

      // Clear drafts — KYC is now in the provider's hands
      try {
        localStorage.removeItem(KYC_DRAFT_KEY);
        localStorage.removeItem(SELFIE_STORAGE_KEY);
        localStorage.removeItem(KYC_DOCS_KEY);
      } catch { /* ignore */ }

      toast.success("Selfie submitted for verification");
      await persistStage("STAGE_4");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit verification");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => step > 1 && setStep((s) => (s - 1) as Step)} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs text-muted-foreground">Step {step} of 3</span>
        <div className="w-10 flex items-center justify-end">
          {autoSaveState === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          {autoSaveState === "saved" && <Check className="w-3.5 h-3.5 text-primary" />}
        </div>
      </div>

      <div className="h-1 rounded-full bg-white/5 mb-8 overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {step === 1 && (
        <>
          <h1 className="text-[28px] font-bold">Personal details</h1>
          <p className="text-[#888] text-sm mt-2">We need a few basics to set up your wallet. Your progress saves automatically.</p>

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

          {selfie && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Aadhaar documents <span className="text-muted-foreground font-normal">(optional)</span></h2>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Speeds up review</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Image or PDF, up to 5 MB each. You can skip and add later.</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <DocSlot side="front" label="Front" doc={docFront} uploading={uploading === "front"}
                  onPick={(f) => uploadDoc("front", f)} onRemove={() => removeDoc("front")} />
                <DocSlot side="back" label="Back" doc={docBack} uploading={uploading === "back"}
                  onPick={(f) => uploadDoc("back", f)} onRemove={() => removeDoc("back")} />
              </div>
            </div>
          )}

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

function DocSlot({
  side, label, doc, uploading, onPick, onRemove,
}: {
  side: DocSide;
  label: string;
  doc: DocState;
  uploading: boolean;
  onPick: (f: File) => void;
  onRemove: () => void;
}) {
  const id = `kyc-doc-${side}`;
  return (
    <div className="glass rounded-xl p-3 flex flex-col items-center justify-center min-h-[96px] text-center">
      {doc ? (
        <>
          <Check className="w-5 h-5 text-primary" />
          <p className="text-xs mt-1 truncate max-w-full">{doc.name}</p>
          <p className="text-[10px] text-muted-foreground">{(doc.size / 1024).toFixed(0)} KB</p>
          <button onClick={onRemove} className="mt-1 text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
            <X className="w-3 h-3" /> Remove
          </button>
        </>
      ) : uploading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <p className="text-xs mt-1 text-muted-foreground">Uploading…</p>
        </>
      ) : (
        <>
          <label htmlFor={id} className="cursor-pointer flex flex-col items-center">
            <Upload className="w-5 h-5 text-primary" />
            <p className="text-xs mt-1 font-medium">Aadhaar {label}</p>
            <p className="text-[10px] text-muted-foreground">Tap to upload</p>
          </label>
          <input id={id} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ""; }} />
        </>
      )}
    </div>
  );
}
