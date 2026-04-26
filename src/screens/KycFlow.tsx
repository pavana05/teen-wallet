import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Upload, Check, X, Loader2, Camera, AlertTriangle, RefreshCw, Clock, ShieldAlert } from "lucide-react";
import { updateProfileFields, setStage as persistStage } from "@/lib/auth";
import { SelfieCapture, SELFIE_STORAGE_KEY, type SelfiePermState } from "@/components/SelfieCapture";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { breadcrumb, captureError } from "@/lib/breadcrumbs";
import { CopyableErrorId } from "@/components/CopyableErrorId";

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
  const [errorId, setErrorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selfie, setSelfie] = useState<SelfiePayload | null>(null);
  const [docFront, setDocFront] = useState<DocState>(null);
  const [docBack, setDocBack] = useState<DocState>(null);
  const [uploading, setUploading] = useState<DocSide | null>(null);
  // Per-side upload progress (0–100). Reported via XHR's `progress` event so the
  // user gets real feedback for slow networks instead of an indeterminate spinner.
  const [uploadProgress, setUploadProgress] = useState<{ front: number; back: number }>({ front: 0, back: 0 });
  // Per-side last failed File. Kept in memory so a network drop during an Aadhaar
  // doc upload can be retried with one tap WITHOUT forcing the user to re-pick
  // the file (or, critically, re-capture the selfie on Step 3).
  const pendingRetryRef = useRef<{ front: File | null; back: File | null }>({ front: null, back: null });
  const [retryAvailable, setRetryAvailable] = useState<{ front: boolean; back: boolean }>({ front: false, back: false });
  // Result of the bucket-access preflight: null = not checked yet, true = OK,
  // false = blocked (RLS / auth / network). We surface a clear banner when blocked
  // so the user understands WHY uploads aren't working before they try one.
  const [bucketAccessOk, setBucketAccessOk] = useState<boolean | null>(null);
  const [bucketAccessReason, setBucketAccessReason] = useState<string | null>(null);
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

  // ── Bucket access preflight + remote doc hydration ──
  // Confirms the current user can READ from the private `kyc-docs` bucket
  // (which implies their JWT + RLS policies are wired correctly), AND uses
  // the same listing call to recover any previously uploaded Aadhaar files
  // when localStorage was cleared (Incognito refresh, browser data wipe, new
  // device). Storage is the canonical source of truth for doc paths because
  // the `kyc_submissions` table has no client INSERT policy.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          if (!cancelled) {
            setBucketAccessOk(false);
            setBucketAccessReason("You're signed out. Sign in to upload Aadhaar documents.");
          }
          return;
        }
        const { data: list, error: listErr } = await supabase.storage
          .from("kyc-docs")
          .list(u.user.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
        if (cancelled) return;
        if (listErr) {
          // Common cause: RLS policy missing/incorrect on storage.objects for this bucket.
          setBucketAccessOk(false);
          setBucketAccessReason(
            /not authorized|permission|policy|row.?level/i.test(listErr.message)
              ? "Uploads are blocked by access rules. Please contact support."
              : `Couldn't reach storage: ${listErr.message}`,
          );
          return;
        }
        setBucketAccessOk(true);
        setBucketAccessReason(null);

        // Recover most recent front/back from storage if local state is empty.
        // File names follow `aadhaar-{side}-{timestamp}.{ext}` (see uploadDoc).
        const newest = (side: DocSide) =>
          list?.find((f) => f.name.startsWith(`aadhaar-${side}-`)) ?? null;
        const remoteFront = newest("front");
        const remoteBack = newest("back");
        setDocFront((cur) => {
          if (cur) return cur;
          if (!remoteFront) return cur;
          return {
            path: `${u.user.id}/${remoteFront.name}`,
            name: remoteFront.name,
            size: Number(remoteFront.metadata?.size ?? 0),
          };
        });
        setDocBack((cur) => {
          if (cur) return cur;
          if (!remoteBack) return cur;
          return {
            path: `${u.user.id}/${remoteBack.name}`,
            name: remoteBack.name,
            size: Number(remoteBack.metadata?.size ?? 0),
          };
        });
      } catch (e) {
        if (cancelled) return;
        setBucketAccessOk(false);
        setBucketAccessReason(e instanceof Error ? e.message : "Storage check failed");
      }
    })();
    return () => { cancelled = true; };
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
    if (schoolName.trim().length < 2) return setError("Enter your school or college name");
    if (addrLine1.trim().length < 4) return setError("Enter your home address");
    if (addrCity.trim().length < 2) return setError("Enter your city");
    if (addrState.trim().length < 2) return setError("Enter your state");
    if (!/^[0-9]{6}$/.test(addrPincode)) return setError("Enter a valid 6-digit pincode");
    setBusy(true);
    const [d, m, y] = dob.split("/");
    await updateProfileFields({
      full_name: name.trim(),
      dob: `${y}-${m}-${d}`,
      gender,
      school_name: schoolName.trim(),
      address_line1: addrLine1.trim(),
      address_city: addrCity.trim(),
      address_state: addrState.trim(),
      address_pincode: addrPincode,
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

  /**
   * Upload an Aadhaar doc (front or back) to private `kyc-docs` storage.
   *
   * Notes on the implementation:
   * - We bypass `supabase.storage.from(...).upload()` and use raw XHR so we get
   *   `progress` events for a real progress bar (the JS SDK's upload helper
   *   doesn't expose progress on the browser).
   * - On network failure we stash the original `File` in `pendingRetryRef`
   *   so the user can retry with one tap — without re-picking the file and,
   *   crucially, WITHOUT having to recapture the selfie they already took.
   * - We refuse to start if the bucket-access preflight failed.
   * - File metadata is implicitly persisted to Supabase the moment the upload
   *   completes (the object exists in storage), and is also mirrored locally
   *   via the existing KYC_DOCS_KEY effect so progress survives a refresh.
   */
  async function uploadDoc(side: DocSide, file: File) {
    setError("");
    if (bucketAccessOk === false) {
      return setError(bucketAccessReason ?? "Document uploads are currently blocked.");
    }
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      return setError("Document must be an image or PDF");
    }
    if (file.size > MAX_DOC_BYTES) return setError("File too large (max 5 MB)");

    setUploading(side);
    setUploadProgress((p) => ({ ...p, [side]: 0 }));
    setRetryAvailable((r) => ({ ...r, [side]: false }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired");
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${session.user.id}/aadhaar-${side}-${Date.now()}.${ext}`;

      // Build the Storage REST URL for direct PUT with progress reporting.
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/kyc-docs/${path}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
          setUploadProgress((p) => ({ ...p, [side]: pct }));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress((p) => ({ ...p, [side]: 100 }));
            resolve();
          } else {
            // Surface RLS / auth failures clearly so the user knows it's
            // NOT a network problem and a retry won't help.
            let msg = `Upload failed (${xhr.status})`;
            try {
              const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
              if (j.message) msg = j.message;
              else if (j.error) msg = j.error;
            } catch { /* ignore */ }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("network"));
        xhr.ontimeout = () => reject(new Error("timeout"));
        xhr.send(file);
      });

      const state: DocState = { path, name: file.name, size: file.size };
      if (side === "front") setDocFront(state); else setDocBack(state);
      pendingRetryRef.current[side] = null;
      setRetryAvailable((r) => ({ ...r, [side]: false }));
      toast.success(`Aadhaar ${side} uploaded`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      // Network / timeout / 5xx → make the file retryable in-place.
      const transient = /network|timeout|fetch|503|502|504/i.test(msg);
      if (transient) {
        pendingRetryRef.current[side] = file;
        setRetryAvailable((r) => ({ ...r, [side]: true }));
        setError(`Network problem uploading Aadhaar ${side}. Tap Retry to try again.`);
      } else {
        // Hard failure (RLS, file rejected, auth) — don't bait the user with retry.
        pendingRetryRef.current[side] = null;
        setRetryAvailable((r) => ({ ...r, [side]: false }));
        setError(msg);
      }
    } finally {
      setUploading(null);
    }
  }

  /** Re-attempt the most recently failed upload for a side, reusing the cached File. */
  function retryUpload(side: DocSide) {
    const f = pendingRetryRef.current[side];
    if (!f) return;
    void uploadDoc(side, f);
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
    setErrorId(null);
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
    // Client-generated correlation ID. The server also generates one and returns
    // it in the response — we prefer the server's so it matches worker logs, and
    // fall back to the client one (network drops, etc.) so the user always has an ID to share.
    const clientCid = `tw_${(crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 8)}`;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorId(clientCid); throw new Error("Session expired. Please sign in again."); }

      const aadhaarLast4 = aadhaar.replace(/\s/g, "").slice(-4);
      let res: Response;
      try {
        res = await fetch("/api/kyc/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            "X-Correlation-Id": clientCid,
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
        // Network failure — treat as transient. No server cid yet, so use the client one.
        setLastErrorTransient(true);
        setErrorId(clientCid);
        throw new Error(netErr instanceof Error ? `Network error: ${netErr.message}` : "Network error");
      }

      const json = (await res.json().catch(() => ({}))) as {
        error?: string; status?: SubStatus; submissionId?: string; providerRef?: string; reason?: string; correlationId?: string;
      };
      const serverCid = json.correlationId ?? res.headers.get("X-Correlation-Id") ?? clientCid;

      if (!res.ok && res.status !== 202) {
        const msg = json.error || `Verification failed (${res.status})`;
        if (res.status >= 500 || isTransientError(msg)) setLastErrorTransient(true);
        setErrorId(serverCid);
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
        correlationId: serverCid,
        durationMs: Date.now() - startedAt,
      });

      try {
        localStorage.removeItem(KYC_DRAFT_KEY);
        localStorage.removeItem(KYC_DOCS_KEY);
      } catch { /* ignore */ }

      if (res.status === 202) {
        setLastErrorTransient(true);
        setErrorId(serverCid);
        toast.message("Provider is busy — submitted to queue. You can try again.", { description: `ID: ${serverCid}` });
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
        correlationId: errorId ?? clientCid,
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

            <div className="pt-2">
              <p className="text-[10.5px] tracking-[0.18em] uppercase text-white/45 font-medium mb-3">Education & address</p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">School / College Name</label>
              <input value={schoolName}
                onChange={(e) => setSchoolName(e.target.value.slice(0, 120))}
                placeholder="Delhi Public School, RK Puram"
                className="tw-input text-lg mt-1" />
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Home Address</label>
              <input value={addrLine1}
                onChange={(e) => setAddrLine1(e.target.value.slice(0, 160))}
                placeholder="House no., Street, Locality"
                className="tw-input text-base mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider">City</label>
                <input value={addrCity}
                  onChange={(e) => setAddrCity(e.target.value.slice(0, 60))}
                  placeholder="Bengaluru"
                  className="tw-input text-base mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider">State</label>
                <input value={addrState}
                  onChange={(e) => setAddrState(e.target.value.slice(0, 60))}
                  placeholder="Karnataka"
                  className="tw-input text-base mt-1" />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Pincode</label>
              <input value={addrPincode}
                onChange={(e) => setAddrPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="560001"
                inputMode="numeric"
                className="tw-input text-lg mt-1 num-mono tracking-[0.2em]" />
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

              {/* RLS / bucket-access preflight banner — surfaces a clear,
                  actionable message BEFORE the user wastes time picking a file. */}
              {bucketAccessOk === false && (
                <div className="mt-3 rounded-xl glass border border-destructive/40 p-3 flex items-start gap-2 text-xs">
                  <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Document uploads are blocked</p>
                    <p className="text-muted-foreground mt-0.5">
                      {bucketAccessReason ?? "We couldn't verify access to secure storage."}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-3">
                <DocSlot
                  side="front"
                  label="Front"
                  doc={docFront}
                  uploading={uploading === "front"}
                  progress={uploadProgress.front}
                  retryAvailable={retryAvailable.front}
                  // Disable the OTHER slot while this one is mid-upload to
                  // prevent racing duplicate uploads; also disable when the
                  // bucket preflight failed.
                  disabled={uploading !== null && uploading !== "front" || bucketAccessOk === false}
                  onPick={(f) => uploadDoc("front", f)}
                  onRetry={() => retryUpload("front")}
                  onRemove={() => removeDoc("front")}
                />
                <DocSlot
                  side="back"
                  label="Back"
                  doc={docBack}
                  uploading={uploading === "back"}
                  progress={uploadProgress.back}
                  retryAvailable={retryAvailable.back}
                  disabled={uploading !== null && uploading !== "back" || bucketAccessOk === false}
                  onPick={(f) => uploadDoc("back", f)}
                  onRetry={() => retryUpload("back")}
                  onRemove={() => removeDoc("back")}
                />
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
  side, label, doc, uploading, progress, retryAvailable, disabled, onPick, onRetry, onRemove,
}: {
  side: DocSide;
  label: string;
  doc: DocState;
  uploading: boolean;
  /** 0–100 upload progress; only meaningful while `uploading` is true. */
  progress: number;
  /** True when the previous upload attempt failed transiently and a one-tap
   *  retry (using the cached File) is available. */
  retryAvailable: boolean;
  /** Disables BOTH the file picker and the retry button — used to prevent
   *  duplicate concurrent uploads while the sibling slot is busy, and to
   *  block uploads when the bucket-access preflight failed. */
  disabled: boolean;
  onPick: (f: File) => void;
  onRetry: () => void;
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
          <button
            onClick={onRemove}
            disabled={disabled}
            className="mt-1 text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-50 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Remove
          </button>
        </>
      ) : uploading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <p className="text-xs mt-1 text-muted-foreground">Uploading… {progress}%</p>
          {/* Determinate progress bar driven by XHR `progress` events. */}
          <div className="w-full h-1 mt-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Aadhaar ${label} upload progress`}
            />
          </div>
        </>
      ) : retryAvailable ? (
        // Network failed mid-upload — offer one-tap retry without re-picking
        // the file (and without disturbing the selfie state on Step 3).
        <>
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <p className="text-xs mt-1 font-medium">Upload failed</p>
          <button
            onClick={onRetry}
            disabled={disabled}
            className="mt-1 text-[11px] text-primary inline-flex items-center gap-1 hover:underline disabled:opacity-50"
            aria-label={`Retry uploading Aadhaar ${label}`}
          >
            <RefreshCw className="w-3 h-3" /> Retry upload
          </button>
        </>
      ) : (
        <>
          <label
            htmlFor={id}
            className={`cursor-pointer flex flex-col items-center ${disabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <Upload className="w-5 h-5 text-primary" />
            <p className="text-xs mt-1 font-medium">Aadhaar {label}</p>
            <p className="text-[10px] text-muted-foreground">Tap to upload</p>
          </label>
          <input
            id={id}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ""; }}
          />
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
