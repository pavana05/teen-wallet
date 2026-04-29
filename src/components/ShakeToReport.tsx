import { useEffect, useRef, useState, useCallback } from "react";
import { AlertTriangle, X, Send, Bug, Lightbulb, MessageSquare, Loader2, Smartphone, Camera, Image as ImageIcon, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getActiveShakeProfile } from "@/lib/shakeSensitivity";
import { getRecentConsoleErrors, getLastStackTrace } from "@/lib/consoleCapture";
import { notifyIssueSubmitted } from "@/lib/notify";

/**
 * Shake-to-report
 * ----------------
 * Listens to DeviceMotionEvent.accelerationIncludingGravity. Threshold and
 * required jolt count come from `shakeSensitivity` (user-editable in
 * Profile → Help) and are re-read on every motion event so changes apply
 * without a reload.
 *
 * On submit we attach:
 *  - Optional DOM screenshot (html2canvas)
 *  - Optional camera photo (native input capture)
 *  - The last 20 console errors/warnings + most recent stack trace
 *
 * iOS 13+ requires explicit permission via DeviceMotionEvent.requestPermission().
 */

const COOLDOWN_MS = 4000;
const PERMISSION_KEY = "tw-motion-permission-v1";
const BUCKET = "issue-attachments";

type Category = "bug" | "feature" | "feedback";

interface DeviceMotionEventConstructorWithPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export function ShakeToReport() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  const [attachScreenshot, setAttachScreenshot] = useState(true);
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [cameraFile, setCameraFile] = useState<File | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const lastShakeAt = useRef(0);
  const shakeTimes = useRef<number[]>([]);
  const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastTriggerAt = useRef(0);

  // Capture a DOM screenshot BEFORE the dialog opens so the dialog isn't
  // visible in the snapshot. We snap once on trigger and keep the blob.
  const captureScreenshot = useCallback(async () => {
    setScreenshotBusy(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const target = document.body;
      const canvas = await html2canvas(target, {
        backgroundColor: null,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
        logging: false,
        ignoreElements: (el) =>
          el.classList?.contains("str-overlay") ||
          el.classList?.contains("str-perm-chip") ||
          el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK",
      });
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.78),
      );
      if (blob) setScreenshotBlob(blob);
    } catch {
      // Silent — feature is best-effort.
    } finally {
      setScreenshotBusy(false);
    }
  }, []);

  // Open the dialog and reset transient state.
  const trigger = useCallback(() => {
    const now = Date.now();
    if (now - lastTriggerAt.current < COOLDOWN_MS) return;
    lastTriggerAt.current = now;
    shakeTimes.current = [];
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    setMessage("");
    setCategory("bug");
    setAttachScreenshot(true);
    setScreenshotBlob(null);
    setCameraFile(null);
    void captureScreenshot();
    setOpen(true);
  }, [captureScreenshot]);

  // Core motion handler: low-pass filtered jolt detection.
  const onMotion = useCallback((event: DeviceMotionEvent) => {
    const profile = getActiveShakeProfile();
    if (!isFinite(profile.threshold)) return; // sensitivity = "off"
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const cur = { x: a.x, y: a.y, z: a.z };
    const prev = lastAccel.current;
    lastAccel.current = cur;
    if (!prev) return;

    const delta = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z);
    if (delta < profile.threshold) return;

    const now = Date.now();
    if (now - lastShakeAt.current < 80) return; // debounce same physical shake
    lastShakeAt.current = now;
    shakeTimes.current.push(now);
    shakeTimes.current = shakeTimes.current.filter((t) => now - t < profile.windowMs);
    if (shakeTimes.current.length >= profile.shakesRequired) {
      trigger();
    }
  }, [trigger]);

  const attachListener = useCallback(() => {
    window.addEventListener("devicemotion", onMotion);
  }, [onMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const Ctor = (window.DeviceMotionEvent as unknown) as DeviceMotionEventConstructorWithPermission | undefined;
    const requiresPerm = !!Ctor && typeof Ctor.requestPermission === "function";
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(PERMISSION_KEY) : null;

    if (!requiresPerm) {
      attachListener();
      return () => window.removeEventListener("devicemotion", onMotion);
    }
    if (stored === "granted") {
      attachListener();
      return () => window.removeEventListener("devicemotion", onMotion);
    }
    if (stored === "denied") return;
    setNeedsPermission(true);
    return undefined;
  }, [attachListener, onMotion]);

  // Keyboard shortcut: Ctrl/Cmd + Shift + R for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        trigger();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trigger]);

  const requestPermission = useCallback(async () => {
    const Ctor = (window.DeviceMotionEvent as unknown) as DeviceMotionEventConstructorWithPermission;
    try {
      const result = await Ctor.requestPermission!();
      try { localStorage.setItem(PERMISSION_KEY, result); } catch { /* ignore */ }
      if (result === "granted") {
        setNeedsPermission(false);
        attachListener();
        toast.success("Shake-to-report enabled");
      } else {
        setNeedsPermission(false);
        toast.message("Shake-to-report disabled", { description: "You can still report issues from Profile → Help." });
      }
    } catch {
      toast.error("Couldn't enable motion access");
    }
  }, [attachListener]);

  // Upload a blob/file to the issue-attachments bucket. Returns the storage
  // path on success, or null on failure (we still let the report submit).
  const uploadAttachment = useCallback(async (
    userId: string | null,
    blob: Blob | File,
    label: "screenshot" | "camera",
  ): Promise<string | null> => {
    const folder = userId ?? "anon";
    const ext = (blob instanceof File && blob.name.split(".").pop()) || "jpg";
    const path = `${folder}/${Date.now()}-${label}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (error) {
      console.warn("[shake-to-report] attachment upload failed", error.message);
      return null;
    }
    return path;
  }, []);

  const submit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please describe the issue");
      return;
    }
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id ?? null;
      const route = typeof window !== "undefined" ? window.location.pathname + window.location.search : null;
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

      const consoleErrors = getRecentConsoleErrors();
      const stackTrace = getLastStackTrace();

      let screenshotPath: string | null = null;
      let cameraPath: string | null = null;
      if (attachScreenshot && screenshotBlob) {
        screenshotPath = await uploadAttachment(userId, screenshotBlob, "screenshot");
      }
      if (cameraFile) {
        cameraPath = await uploadAttachment(userId, cameraFile, "camera");
      }

      const { error } = await supabase.from("issue_reports").insert([{
        user_id: userId,
        category,
        message: trimmed,
        route,
        user_agent: ua,
        app_version: "tw-web-1.0",
        console_errors: JSON.parse(JSON.stringify(consoleErrors)),
        stack_trace: stackTrace,
        screenshot_path: screenshotPath,
        camera_photo_path: cameraPath,
      }]);
      if (error) throw error;
      toast.success("Report sent — thank you!");
      setOpen(false);
      setMessage("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't send report";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [category, message, attachScreenshot, screenshotBlob, cameraFile, uploadAttachment]);

  return (
    <>
      {needsPermission && (
        <button
          onClick={requestPermission}
          className="str-perm-chip"
          aria-label="Enable shake to report"
        >
          <Smartphone className="w-4 h-4" />
          <span>Enable shake-to-report</span>
          <X
            className="w-3.5 h-3.5 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              try { localStorage.setItem(PERMISSION_KEY, "denied"); } catch { /* ignore */ }
              setNeedsPermission(false);
            }}
          />
        </button>
      )}

      {open && (
        <div className="str-overlay" onClick={() => !submitting && setOpen(false)}>
          <div className="str-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Report an issue">
            <div className="str-head">
              <div className="str-head-icon"><AlertTriangle className="w-5 h-5" /></div>
              <div style={{ flex: 1 }}>
                <div className="str-title">Report an issue</div>
                <div className="str-subtitle">Tell us what went wrong — we read every report.</div>
              </div>
              <button onClick={() => !submitting && setOpen(false)} aria-label="Close" className="str-close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="str-tabs">
              <CatTab active={category === "bug"} onClick={() => setCategory("bug")}
                icon={<Bug className="w-4 h-4" />} label="Bug" />
              <CatTab active={category === "feature"} onClick={() => setCategory("feature")}
                icon={<Lightbulb className="w-4 h-4" />} label="Idea" />
              <CatTab active={category === "feedback"} onClick={() => setCategory("feedback")}
                icon={<MessageSquare className="w-4 h-4" />} label="Feedback" />
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={4}
              autoFocus
              placeholder={
                category === "bug" ? "What broke? Steps to reproduce help us fix it faster."
                  : category === "feature" ? "What would you love to see in Teen Wallet?"
                  : "Share your thoughts about the app."
              }
              className="str-textarea"
              disabled={submitting}
            />
            <div className="str-meta">
              <span>{message.length}/500</span>
              <span className="str-route">{typeof window !== "undefined" ? window.location.pathname : ""}</span>
            </div>

            {/* Attachments */}
            <div className="str-attach">
              <label className="str-attach-row" title="Attach a snapshot of the screen at the moment of the issue">
                <input
                  type="checkbox"
                  checked={attachScreenshot}
                  onChange={(e) => setAttachScreenshot(e.target.checked)}
                  disabled={submitting}
                />
                <ImageIcon className="w-4 h-4" />
                <span style={{ flex: 1 }}>Attach screenshot</span>
                {screenshotBusy && <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70" />}
                {!screenshotBusy && screenshotBlob && attachScreenshot && (
                  <span className="str-chip-ok"><Check className="w-3 h-3" /> ready</span>
                )}
              </label>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={submitting}
                className="str-attach-row str-attach-btn"
              >
                <Camera className="w-4 h-4" />
                <span style={{ flex: 1, textAlign: "left" }}>
                  {cameraFile ? "Photo attached — tap to replace" : "Add photo from camera"}
                </span>
                {cameraFile && <span className="str-chip-ok"><Check className="w-3 h-3" /> {Math.round(cameraFile.size / 1024)}KB</span>}
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setCameraFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            <button
              onClick={submit}
              disabled={submitting || !message.trim()}
              className="str-submit"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="w-4 h-4" /> Send report</>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CatTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`str-tab ${active ? "str-tab-on" : ""}`}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
