import { useEffect, useRef, useState, useCallback } from "react";
import { AlertTriangle, X, Send, Bug, Lightbulb, MessageSquare, Loader2, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Shake-to-report
 * ----------------
 * Listens to DeviceMotionEvent.accelerationIncludingGravity. When the user
 * shakes the device past a velocity threshold a fixed number of times in a
 * short window, we open a report dialog. Logged-in users get their user_id
 * attached; anonymous reports are also accepted (RLS allows user_id IS NULL).
 *
 * iOS 13+ requires explicit permission via DeviceMotionEvent.requestPermission().
 * We only ask once on first user gesture and remember the answer locally.
 */

const SHAKE_THRESHOLD = 18;            // accel delta needed to count as a "jolt"
const SHAKES_REQUIRED = 3;             // number of jolts in the window to trigger
const SHAKE_WINDOW_MS = 1200;          // window to collect those jolts
const COOLDOWN_MS = 4000;              // ignore re-triggers right after one fires
const PERMISSION_KEY = "tw-motion-permission-v1";

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

  const lastShakeAt = useRef(0);
  const shakeTimes = useRef<number[]>([]);
  const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastTriggerAt = useRef(0);

  // Open the dialog and reset transient state.
  const trigger = useCallback(() => {
    const now = Date.now();
    if (now - lastTriggerAt.current < COOLDOWN_MS) return;
    lastTriggerAt.current = now;
    shakeTimes.current = [];
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    setMessage("");
    setCategory("bug");
    setOpen(true);
  }, []);

  // Core motion handler: low-pass filtered jolt detection.
  const onMotion = useCallback((event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const cur = { x: a.x, y: a.y, z: a.z };
    const prev = lastAccel.current;
    lastAccel.current = cur;
    if (!prev) return;

    const delta = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z);
    if (delta < SHAKE_THRESHOLD) return;

    const now = Date.now();
    // Debounce: ignore jolts < 80 ms apart (same physical shake).
    if (now - lastShakeAt.current < 80) return;
    lastShakeAt.current = now;
    shakeTimes.current.push(now);
    // Drop jolts outside the window.
    shakeTimes.current = shakeTimes.current.filter((t) => now - t < SHAKE_WINDOW_MS);
    if (shakeTimes.current.length >= SHAKES_REQUIRED) {
      trigger();
    }
  }, [trigger]);

  // Attach motion listener (after permission, if iOS).
  const attachListener = useCallback(() => {
    window.addEventListener("devicemotion", onMotion);
  }, [onMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const Ctor = (window.DeviceMotionEvent as unknown) as DeviceMotionEventConstructorWithPermission | undefined;
    const requiresPerm = !!Ctor && typeof Ctor.requestPermission === "function";
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(PERMISSION_KEY) : null;

    if (!requiresPerm) {
      // Android / desktop with motion sensor — just attach.
      attachListener();
      return () => window.removeEventListener("devicemotion", onMotion);
    }

    // iOS path
    if (stored === "granted") {
      attachListener();
      return () => window.removeEventListener("devicemotion", onMotion);
    }
    if (stored === "denied") {
      // Respect user's previous choice — silent.
      return;
    }
    // Show the permission CTA the first time.
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

  // iOS permission request — must be a user gesture.
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

  const submit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please describe the issue");
      return;
    }
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const route = typeof window !== "undefined" ? window.location.pathname + window.location.search : null;
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
      const { error } = await supabase.from("issue_reports").insert({
        user_id: u.user?.id ?? null,
        category,
        message: trimmed,
        route,
        user_agent: ua,
        app_version: "tw-web-1.0",
      });
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
  }, [category, message]);

  // Render: floating permission chip (one-time, iOS only) + dialog
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
