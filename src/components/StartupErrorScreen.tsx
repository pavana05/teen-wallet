// One-tap startup error screen, shown when the boot self-check
// detects an inconsistent local state (corrupt persist, expired
// session, perms-without-stage, etc). The single CTA clears the
// offending local state and reloads back into onboarding.

import type { SelfCheckResult } from "@/lib/bootSelfCheck";
import { resetLocalAppState } from "@/lib/bootSelfCheck";

interface Props {
  result: SelfCheckResult;
}

export function StartupErrorScreen({ result }: Props) {
  const primary = result.issues[0];
  const onReset = () => {
    resetLocalAppState();
    if (typeof window !== "undefined") window.location.replace("/onboarding");
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
        background: "var(--background, #0a0a0a)",
        color: "var(--foreground, #f5f5f5)",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          maxWidth: 420, width: "100%",
          background: "color-mix(in oklab, var(--card, #111) 92%, transparent)",
          border: "1px solid color-mix(in oklab, var(--foreground, #fff) 8%, transparent)",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.6)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 48, height: 48, borderRadius: 14,
            background: "color-mix(in oklab, var(--destructive, #ef4444) 18%, transparent)",
            color: "var(--destructive, #ef4444)",
            display: "grid", placeItems: "center", marginBottom: 16,
            fontSize: 24, fontWeight: 600,
          }}
        >
          !
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
          Something’s out of sync
        </h1>
        <p style={{ margin: "0 0 8px", opacity: 0.78, lineHeight: 1.45, fontSize: 14 }}>
          {primary?.message ?? "Your saved app data is inconsistent."}
        </p>
        <p style={{ margin: "0 0 20px", opacity: 0.55, fontSize: 12 }}>
          Tap below to reset local data and start fresh. Your account is safe.
        </p>

        <button
          type="button"
          onClick={onReset}
          data-testid="startup-error-reset"
          style={{
            width: "100%", padding: "14px 16px",
            borderRadius: 12,
            background: "var(--primary, #f5f5f5)",
            color: "var(--primary-foreground, #0a0a0a)",
            fontWeight: 600, fontSize: 15,
            border: "none", cursor: "pointer",
          }}
        >
          Reset & restart
        </button>

        {result.issues.length > 1 && (
          <details style={{ marginTop: 16, opacity: 0.6, fontSize: 12 }}>
            <summary style={{ cursor: "pointer" }}>Details</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {result.issues.map((i) => (
                <li key={i.code}>{i.code}: {i.message}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
