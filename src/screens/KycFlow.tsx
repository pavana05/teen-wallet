import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Upload, Check, X, Loader2, Camera, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { updateProfileFields, setStage as persistStage } from "@/lib/auth";
import { SelfieCapture, SELFIE_STORAGE_KEY, type SelfiePermState } from "@/components/SelfieCapture";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { breadcrumb, captureError } from "@/lib/breadcrumbs";

type Step = 1 | 2 | 3;
type SelfiePayload = { dataUrl: string; width: number; height: number; bytes: number };
type DocSide = "front" | "back";
type DocState = { path: string; name: string; size: number } | null;
type SubStatus = "pending" | "approved" | "rejected" | "not_started";
type LastSubmission = {
  submissionId: string;
  providerRef: string | null;
  status: SubStatus;
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
  const [schoolName, setSchoolName] = useState("");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrPincode, setAddrPincode] = useState("");
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
          schoolName: string; addrLine1: string; addrCity: string; addrState: string; addrPincode: string;
        }>;
        if (d.name) setName(d.name);
        if (d.dob) setDob(d.dob);
        if (d.gender) setGender(d.gender);
        if (d.aadhaar) setAadhaar(d.aadhaar);
        if (d.step) setStep(d.step);
        if (d.schoolName) setSchoolName(d.schoolName);
        if (d.addrLine1) setAddrLine1(d.addrLine1);
        if (d.addrCity) setAddrCity(d.addrCity);
        if (d.addrState) setAddrState(d.addrState);
        if (d.addrPincode) setAddrPincode(d.addrPincode);
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
          .select("full_name,dob,gender,aadhaar_last4,onboarding_stage,school_name,address_line1,address_city,address_state,address_pincode")
          .eq("id", u.user.id)
          .maybeSingle();
        if (!p) return;
        // Only fill empty fields — never overwrite the user's in-progress edits.
        setName((cur) => cur || (p.full_name ?? ""));
        setGender((cur) => cur || ((p.gender as typeof gender) ?? ""));
        setSchoolName((cur) => cur || (p.school_name ?? ""));
        setAddrLine1((cur) => cur || (p.address_line1 ?? ""));
        setAddrCity((cur) => cur || (p.address_city ?? ""));
        setAddrState((cur) => cur || (p.address_state ?? ""));
        setAddrPincode((cur) => cur || (p.address_pincode ?? ""));
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
        JSON.stringify({ name, dob, gender, aadhaar, step, schoolName, addrLine1, addrCity, addrState, addrPincode }),
      );
    } catch { /* ignore */ }
  }, [name, dob, gender, aadhaar, step, schoolName, addrLine1, addrCity, addrState, addrPincode]);

  useEffect(() => {
    try {
      localStorage.setItem(KYC_DOCS_KEY, JSON.stringify({ front: docFront, back: docBack }));
    } catch { /* ignore */ }
  }, [docFront, docBack]);

  // Persist last submission to localStorage so refreshes don't lose context.
  useEffect(() => {
    try {
      if (lastSubmission) localStorage.setItem(KYC_LAST_SUBMISSION_KEY, JSON.stringify(lastSubmission));
    } catch { /* ignore */ }
  }, [lastSubmission]);

  // Fetch the latest server-side submission + subscribe to realtime updates.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || cancelled) return;
      const userId = u.user.id;

      const { data: rows } = await supabase
        .from("kyc_submissions")
        .select("id,provider_ref,status,created_at,reason")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && rows && rows[0]) {
        const r = rows[0];
        setLastSubmission({
          submissionId: r.id,
          providerRef: r.provider_ref,
          status: r.status,
          submittedAt: r.created_at,
          reason: r.reason,
        });
      }

      channel = supabase
        .channel(`kyc-sub-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "kyc_submissions", filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as {
              id: string; provider_ref: string | null; status: SubStatus;
              created_at: string; reason: string | null;
            } | undefined;
            if (!row) return;
            setLastSubmission((cur) =>
              !cur || cur.submissionId === row.id || new Date(row.created_at) >= new Date(cur.submittedAt)
                ? { submissionId: row.id, providerRef: row.provider_ref, status: row.status, submittedAt: row.created_at, reason: row.reason }
                : cur,
            );
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

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

  // Read the most recent capture from localStorage as a fallback so refresh→retry works
  // even before the SelfieCapture child has rehydrated state.
  const readStoredSelfie = (): SelfiePayload | null => {
    try {
      const raw = localStorage.getItem(SELFIE_STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { dataUrl?: string; width?: number; height?: number; bytes?: number };
      if (!p.dataUrl || !p.width || !p.height || !p.bytes) return null;
      return { dataUrl: p.dataUrl, width: p.width, height: p.height, bytes: p.bytes };
    } catch { return null; }
  };

  async function runVerification(): Promise<void> {
    const payload = selfie ?? readStoredSelfie();
    if (!payload) {
      setError("Please capture a selfie first");
      return;
    }
    if (payload.width < 240 || payload.height < 240) return setError("Selfie resolution too low — please retake");
    if (payload.bytes < 8 * 1024) return setError("Selfie image is too small — please retake");

    setError("");
    setLastErrorTransient(false);
    setBusy(true);
    const startedAt = Date.now();
    breadcrumb("kyc.submit_started", {
      step,
      selfieBytes: payload.bytes,
      selfieRes: `${payload.width}x${payload.height}`,
      hasDocFront: !!docFront,
      hasDocBack: !!docBack,
    });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired. Please sign in again.");

      const aadhaarLast4 = aadhaar.replace(/\s/g, "").slice(-4);
      let res: Response;
      try {
        res = await fetch("/api/kyc/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            selfie: payload.dataUrl,
            width: payload.width,
            height: payload.height,
            aadhaarLast4,
            docFrontPath: docFront?.path ?? null,
            docBackPath: docBack?.path ?? null,
          }),
        });
      } catch (netErr) {
        // Network failure — treat as transient.
        setLastErrorTransient(true);
        throw new Error(netErr instanceof Error ? `Network error: ${netErr.message}` : "Network error");
      }

      const json = (await res.json().catch(() => ({}))) as {
        error?: string; status?: SubStatus; submissionId?: string; providerRef?: string; reason?: string;
      };
      if (!res.ok && res.status !== 202) {
        const msg = json.error || `Verification failed (${res.status})`;
        // 5xx and known transient phrases ⇒ allow Try again without recapture.
        if (res.status >= 500 || isTransientError(msg)) setLastErrorTransient(true);
        throw new Error(msg);
      }

      // Record submission for the timeline + future polling
      if (json.submissionId) {
        const next: LastSubmission = {
          submissionId: json.submissionId,
          providerRef: json.providerRef ?? null,
          status: json.status ?? "pending",
          submittedAt: new Date().toISOString(),
          reason: json.reason ?? (res.status === 202 ? "Provider unreachable — auto-retrying" : null),
        };
        setLastSubmission(next);
      }

      breadcrumb("kyc.submit_response", {
        status: res.status,
        kycStatus: json.status,
        submissionId: json.submissionId,
        providerRef: json.providerRef,
        reason: json.reason,
        durationMs: Date.now() - startedAt,
      });

      // Keep the selfie in localStorage until we have a non-pending status — lets the
      // user re-check / resubmit on refresh during Step 3 without recapturing.
      // Only clear text drafts (KYC is now in the provider's hands).
      try {
        localStorage.removeItem(KYC_DRAFT_KEY);
        localStorage.removeItem(KYC_DOCS_KEY);
      } catch { /* ignore */ }

      if (res.status === 202) {
        // Provider unreachable — surface "Try again" but still progress to pending screen
        // so realtime polling can pick up later results.
        setLastErrorTransient(true);
        toast.message("Provider is busy — submitted to queue. You can try again.");
      } else {
        toast.success("Selfie submitted for verification");
      }
      await persistStage("STAGE_4");
      onDone();
    } catch (e) {
      captureError(e, {
        where: "kyc.runVerification",
        step,
        durationMs: Date.now() - startedAt,
      });
      setError(e instanceof Error ? e.message : "Could not submit verification");
    } finally {
      setBusy(false);
    }
  }

  const submitStep3 = runVerification;
  const retrySubmit = runVerification;

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

          <PermissionBanner perm={camPerm} supported={camSupported} />

          <div className="mt-4">
            <SelfieCapture
              onCapture={(d) => { setSelfie(d); setError(""); }}
              onPermissionChange={onCamPerm}
            />
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

          <SubmissionTimeline last={lastSubmission} />

          {error && (
            <div className="mt-4">
              <p className="text-destructive text-xs tw-shake">{error}</p>
              {lastErrorTransient && (
                <button onClick={retrySubmit} disabled={busy}
                  className="mt-2 text-xs text-primary inline-flex items-center gap-1 hover:underline disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Try again
                </button>
              )}
            </div>
          )}
          <div className="flex-1" />
          <button
            onClick={submitStep3}
            disabled={busy || !selfie || (camSupported && camPerm === "denied")}
            className="btn-primary w-full disabled:opacity-50"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : "Submit for verification"}
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

function PermissionBanner({ perm, supported }: { perm: SelfiePermState; supported: boolean }) {
  if (!supported) {
    return (
      <div className="mt-4 rounded-xl glass border border-destructive/40 p-3 flex items-start gap-2 text-xs">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-destructive">Camera not available</p>
          <p className="text-muted-foreground mt-0.5">
            This browser doesn't support camera access. Try Chrome or Safari on a device with a camera.
          </p>
        </div>
      </div>
    );
  }
  if (perm === "denied") {
    return (
      <div className="mt-4 rounded-xl glass border border-destructive/40 p-3 flex items-start gap-2 text-xs">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-destructive">Camera access blocked</p>
          <p className="text-muted-foreground mt-0.5">
            Open your browser's site settings and allow camera access for this page, then reload.
          </p>
        </div>
      </div>
    );
  }
  if (perm === "prompt" || perm === "unknown") {
    return (
      <div className="mt-4 rounded-xl glass border border-primary/30 p-3 flex items-start gap-2 text-xs">
        <Camera className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Camera permission needed</p>
          <p className="text-muted-foreground mt-0.5">
            Tap "Enable camera" below — we only use it for this one selfie. Submit unlocks once permission is granted.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl glass border border-primary/30 p-3 flex items-center gap-2 text-xs">
      <Check className="w-4 h-4 text-primary" />
      <p className="text-muted-foreground">Camera ready</p>
    </div>
  );
}

function SubmissionTimeline({ last }: { last: LastSubmission | null }) {
  if (!last) return null;
  const color =
    last.status === "approved" ? "text-primary"
    : last.status === "rejected" ? "text-destructive"
    : "text-muted-foreground";
  const dot =
    last.status === "approved" ? "bg-primary"
    : last.status === "rejected" ? "bg-destructive"
    : "bg-white/30";
  return (
    <div className="mt-6 rounded-2xl glass p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Verification timeline</h3>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <span className={`mt-1 w-2 h-2 rounded-full ${dot}`} />
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-2">
              <span className={`uppercase tracking-wider ${color}`}>{last.status}</span>
              <span className="text-muted-foreground">{new Date(last.submittedAt).toLocaleString()}</span>
            </p>
            <p className="text-muted-foreground truncate">
              Submission: <span className="num-mono">{last.submissionId.slice(0, 8)}…</span>
            </p>
            {last.providerRef && (
              <p className="text-muted-foreground truncate">
                Provider ref: <span className="num-mono">{last.providerRef}</span>
              </p>
            )}
            {last.reason && <p className="text-muted-foreground mt-0.5">{last.reason}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
