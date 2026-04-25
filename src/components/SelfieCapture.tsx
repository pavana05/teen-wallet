import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type Status = "idle" | "requesting" | "streaming" | "denied" | "unsupported" | "error" | "captured";
type PermState = "unknown" | "granted" | "denied" | "prompt";

const STORAGE_KEY = "tw_selfie_capture_v1";
const MIN_DIM = 240;
const MIN_BYTES = 8 * 1024;

interface Props {
  onCapture: (payload: { dataUrl: string; width: number; height: number; bytes: number } | null) => void;
}

interface Stored {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: number;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed.dataUrl?.startsWith("data:image/")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function approxBytes(dataUrl: string) {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

export function SelfieCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [permState, setPermState] = useState<PermState>("unknown");

  // ----- Hard teardown -----
  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      // Clear srcObject so the camera light fully turns off in all browsers
      v.srcObject = null;
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        /* ignore */
      }
    }
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
      c.width = 0;
      c.height = 0;
    }
  }, []);

  // ----- Detect permission state on mount, hydrate from localStorage -----
  useEffect(() => {
    mountedRef.current = true;

    // Hydrate prior capture
    const stored = readStored();
    if (stored) {
      setSnapshot(stored.dataUrl);
      setStatus("captured");
      onCapture({ dataUrl: stored.dataUrl, width: stored.width, height: stored.height, bytes: stored.bytes });
    }

    // Probe Permissions API (not supported on Safari/Firefox iOS)
    const probe = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (mountedRef.current) setStatus("unsupported");
        return;
      }
      try {
        // @ts-expect-error - "camera" not in standard PermissionName lib but supported in Chromium
        const p = await navigator.permissions?.query?.({ name: "camera" });
        if (p && mountedRef.current) {
          setPermState(p.state as PermState);
          p.onchange = () => mountedRef.current && setPermState(p.state as PermState);
        }
      } catch {
        // permissions API unavailable — leave as "unknown"
      }
    };
    void probe();

    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [stopStream, onCapture]);

  // ----- Start camera -----
  const startCamera = async () => {
    setErrMsg("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrMsg("Camera not supported in this browser.");
      return;
    }
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPermState("granted");
      setStatus("streaming");
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        setPermState("denied");
        setStatus("denied");
        setErrMsg("Camera permission denied. Enable it in your browser settings and try again.");
      } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        setStatus("error");
        setErrMsg("No front-facing camera found on this device.");
      } else {
        setStatus("error");
        setErrMsg(err.message || "Could not start the camera.");
      }
    }
  };

  // ----- Capture with validation -----
  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    if (!size || size < MIN_DIM) {
      setErrMsg("Camera resolution too low. Please retry.");
      return;
    }
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    ctx.restore();

    // Validate: dimensions + non-blank pixel check + min byte size
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const bytes = approxBytes(dataUrl);
    if (bytes < MIN_BYTES) {
      setErrMsg("Captured image looks blank. Please retry in better light.");
      return;
    }

    // Pixel sample: ensure the frame isn't a flat color (covered lens / black screen)
    try {
      const sample = ctx.getImageData(0, 0, size, size);
      const data = sample.data;
      let r0 = data[0], g0 = data[1], b0 = data[2];
      let variance = 0;
      const step = Math.max(4, Math.floor(data.length / 4 / 1000)) * 4;
      for (let i = step; i < data.length; i += step) {
        variance += Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0);
        if (variance > 500) break;
      }
      if (variance < 200) {
        setErrMsg("Image looks blank or your lens is covered. Please retake.");
        return;
      }
    } catch {
      // CORS/taint shouldn't happen for getUserMedia, but ignore if it does
    }

    setSnapshot(dataUrl);
    setStatus("captured");
    setErrMsg("");
    stopStream();

    const payload: Stored = { dataUrl, width: size, height: size, bytes, capturedAt: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota — non-fatal */
    }
    onCapture(payload);
  };

  const retake = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSnapshot(null);
    onCapture(null);
    stopStream();
    void startCamera();
  };

  const submitDisabled = status !== "captured" || !snapshot;

  return (
    <div className="space-y-3">
      <div className="aspect-square rounded-3xl glass relative overflow-hidden">
        {status === "streaming" && (
          <video ref={videoRef} playsInline muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }} />
        )}

        {status === "captured" && snapshot && (
          <img src={snapshot} alt="Captured selfie" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {status === "streaming" && (
          <>
            <div className="absolute inset-8 border-2 border-primary lime-glow pointer-events-none"
              style={{ borderRadius: "50% / 60%" }} />
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-[10px] text-primary uppercase tracking-wider">
              Live · align face
            </div>
          </>
        )}

        {status === "captured" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[10px] uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Captured
          </div>
        )}

        {(status === "idle" || status === "requesting" || status === "denied" || status === "unsupported" || status === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="absolute inset-8 border-2 border-white/10 pointer-events-none"
              style={{ borderRadius: "50% / 60%" }} />
            {(status === "denied" || status === "unsupported" || status === "error") ? (
              <>
                <AlertTriangle className="w-8 h-8 text-destructive mb-2" />
                <p className="text-sm text-destructive font-medium">
                  {status === "denied" ? "Permission needed" : status === "unsupported" ? "Camera unavailable" : "Camera error"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[220px]">{errMsg}</p>
              </>
            ) : (
              <>
                <Camera className="w-8 h-8 text-primary mb-2" />
                <p className="text-sm font-medium">{status === "requesting" ? "Requesting camera…" : "Camera viewfinder"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {permState === "granted"
                    ? "Camera ready — tap below to start"
                    : permState === "denied"
                      ? "Camera blocked — enable it in browser settings"
                      : "Tap below to enable your camera"}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {errMsg && status === "streaming" && (
        <p className="text-destructive text-xs tw-shake">{errMsg}</p>
      )}

      {status === "idle" && (
        <button onClick={startCamera} className="btn-primary w-full">
          <Camera className="w-5 h-5" /> {permState === "granted" ? "Start camera" : "Enable camera"}
        </button>
      )}
      {status === "requesting" && (
        <button disabled className="btn-primary w-full opacity-70">Requesting permission…</button>
      )}
      {(status === "denied" || status === "error" || status === "unsupported") && (
        <button onClick={startCamera} className="btn-primary w-full">
          <RefreshCw className="w-5 h-5" /> Try again
        </button>
      )}
      {status === "streaming" && (
        <button onClick={capture} className="btn-primary w-full">
          <Camera className="w-5 h-5" /> Capture selfie
        </button>
      )}
      {status === "captured" && (
        <button onClick={retake} className="w-full py-3 rounded-2xl glass text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4" /> Retake
        </button>
      )}

      {/* Hidden marker for parent to read submit-readiness via prop callback */}
      <input type="hidden" data-ready={!submitDisabled} />
    </div>
  );
}

export const SELFIE_STORAGE_KEY = STORAGE_KEY;
