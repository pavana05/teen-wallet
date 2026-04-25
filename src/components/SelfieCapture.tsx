import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type Status = "idle" | "requesting" | "streaming" | "denied" | "unsupported" | "error" | "captured";

interface Props {
  onCapture: (dataUrl: string) => void;
}

export function SelfieCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

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
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("streaming");
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
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

  useEffect(() => {
    return () => stopStream();
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    if (!size) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // mirror to match preview
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setSnapshot(dataUrl);
    setStatus("captured");
    stopStream();
    onCapture(dataUrl);
  };

  const retake = () => {
    setSnapshot(null);
    startCamera();
  };

  return (
    <div className="space-y-3">
      <div className="aspect-square rounded-3xl glass relative overflow-hidden">
        {/* Live video */}
        {status === "streaming" && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
        )}

        {/* Captured photo */}
        {status === "captured" && snapshot && (
          <img src={snapshot} alt="Selfie" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* Face guide overlay (visible while streaming) */}
        {status === "streaming" && (
          <>
            <div
              className="absolute inset-8 border-2 border-primary lime-glow pointer-events-none"
              style={{ borderRadius: "50% / 60%" }}
            />
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-[10px] text-primary uppercase tracking-wider">
              Live · align face
            </div>
          </>
        )}

        {/* Captured badge */}
        {status === "captured" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[10px] uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Captured
          </div>
        )}

        {/* Idle / permission states */}
        {(status === "idle" || status === "requesting" || status === "denied" || status === "unsupported" || status === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div
              className="absolute inset-8 border-2 border-white/10 pointer-events-none"
              style={{ borderRadius: "50% / 60%" }}
            />
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
                <p className="text-[11px] text-muted-foreground mt-1">Tap below to enable your camera</p>
              </>
            )}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Action button */}
      {status === "idle" && (
        <button onClick={startCamera} className="btn-primary w-full">
          <Camera className="w-5 h-5" /> Enable camera
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
    </div>
  );
}
