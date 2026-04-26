import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { callAdminFn, can, readAdminSession, useAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, XCircle, Loader2, PlayCircle, Download, ShieldAlert, History } from "lucide-react";
import jsPDF from "jspdf";

export const Route = createFileRoute("/admin/diagnostics")({
  component: DiagnosticsPage,
});

type CheckStatus = "idle" | "running" | "pass" | "fail" | "skip";
interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  ms?: number;
}

interface PersistedRun {
  ranAt: string;            // ISO
  smokeMode: boolean;
  adminEmail: string | null;
  checks: Check[];
  summary: string;
}

const STORAGE_KEY = "tw-admin-diagnostics-last-run";

const INITIAL: Check[] = [
  { key: "session", label: "Admin session valid", status: "idle" },
  { key: "session_persist", label: "Session persists in storage", status: "idle" },
  { key: "kyc_list", label: "KYC list fetch (pending)", status: "idle" },
  { key: "kyc_roundtrip", label: "KYC approve/reject round-trip", status: "idle" },
  { key: "txn_list", label: "Transactions list fetch", status: "idle" },
  { key: "supabase_auth", label: "Supabase auth reachable", status: "idle" },
  { key: "realtime", label: "Realtime broadcast round-trip", status: "idle" },
];

function StatusIcon({ s }: { s: CheckStatus }) {
  if (s === "running") return <Loader2 size={16} className="animate-spin" style={{ color: "var(--a-accent)" }} />;
  if (s === "pass") return <CheckCircle2 size={16} style={{ color: "#10b981" }} />;
  if (s === "fail") return <XCircle size={16} style={{ color: "#ef4444" }} />;
  if (s === "skip") return <Activity size={16} style={{ color: "var(--a-muted)" }} />;
  return <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--a-border)" }} />;
}

function loadPersisted(): PersistedRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedRun;
    if (!p.ranAt || !Array.isArray(p.checks)) return null;
    return p;
  } catch {
    return null;
  }
}

function savePersisted(run: PersistedRun) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(run)); } catch { /* quota */ }
}

function DiagnosticsPage() {
  const { admin } = useAdminSession();
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string>("");
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [smokeMode, setSmokeMode] = useState(true);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  // Permission gate: only roles with decideKyc may run the destructive round-trip.
  // Smoke-test mode skips the destructive call, so anyone with viewKyc can run it.
  const canDecideKyc = can(admin?.role, "decideKyc");
  const canViewKyc = can(admin?.role, "viewKyc");
  const allowedToRun = smokeMode ? canViewKyc : canDecideKyc;

  // Restore last run from localStorage on mount.
  useEffect(() => {
    const p = loadPersisted();
    if (p) {
      setChecks(p.checks);
      setSummary(p.summary);
      setRanAt(p.ranAt);
      setSmokeMode(p.smokeMode);
      setRestoredFromStorage(true);
    }
  }, []);

  const update = (key: string, patch: Partial<Check>) =>
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const time = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    update(key, { status: "running", detail: undefined, ms: undefined });
    const t0 = performance.now();
    try {
      const r = await fn();
      update(key, { status: "pass", ms: Math.round(performance.now() - t0) });
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      update(key, { status: "fail", detail: msg, ms: Math.round(performance.now() - t0) });
      return null;
    }
  };

  const runAll = async () => {
    if (!allowedToRun) return;
    setRunning(true);
    setRestoredFromStorage(false);
    setChecks(INITIAL.map((c) => ({ ...c })));
    setSummary("");
    const startedIso = new Date().toISOString();
    setRanAt(startedIso);

    const stored = readAdminSession();

    // 1. Session check
    await time("session", async () => {
      if (!stored) throw new Error("No admin session in storage");
      const r = await callAdminFn<{ admin: { email: string } }>({
        action: "session",
        sessionToken: stored.sessionToken,
      });
      update("session", { detail: `Logged in as ${r.admin.email}` });
      return r;
    });

    // 2. Persistence
    await time("session_persist", async () => {
      const re = readAdminSession();
      if (!re) throw new Error("Session not persisted");
      const remaining = Math.max(0, Math.round((new Date(re.expiresAt).getTime() - Date.now()) / 60000));
      update("session_persist", { detail: `Expires in ${remaining} min` });
      return re;
    });

    // 3. KYC list
    const kycList = await time<{ rows: Array<{ id: string; user_id: string; status: string }>; total: number }>(
      "kyc_list",
      async () => {
        if (!stored) throw new Error("Skip — no session");
        const r = await callAdminFn<{ rows: Array<{ id: string; user_id: string; status: string }>; total: number }>({
          action: "kyc_list",
          sessionToken: stored.sessionToken,
          status: "pending",
          page: 1,
          pageSize: 5,
        });
        update("kyc_list", { detail: `Fetched ${r.rows.length} pending row(s) (total ${r.total})` });
        return r;
      }
    );

    // 4. KYC round-trip / preflight.
    //    Smoke-test mode never actually approves or rejects. Instead it confirms:
    //      - the kyc_list endpoint returned a usable shape, AND
    //      - the current admin role is permitted to call kyc_decide.
    //    Live mode (smokeMode=false) re-affirms the current status on a pending row.
    await time("kyc_roundtrip", async () => {
      if (!stored) throw new Error("Skip — no session");
      const row = kycList?.rows?.[0];
      if (smokeMode) {
        // Read-only preflight: never call kyc_decide.
        if (!canDecideKyc) {
          update("kyc_roundtrip", { status: "skip", detail: "Read-only preflight: your role can view KYC but not decide it (skipped destructive call)" });
          throw new Error("__skip__");
        }
        if (!row) {
          update("kyc_roundtrip", { status: "skip", detail: "Read-only preflight passed — endpoint shape OK, no pending row to test against" });
          throw new Error("__skip__");
        }
        update("kyc_roundtrip", { detail: `Read-only preflight passed — would target ${row.id.slice(0, 8)}…` });
        return true;
      }
      // Live mode — only reachable when canDecideKyc is true (allowedToRun gate).
      if (!row) {
        update("kyc_roundtrip", { status: "skip", detail: "No pending KYC submission to test against" });
        throw new Error("__skip__");
      }
      await callAdminFn({
        action: "kyc_decide",
        sessionToken: stored.sessionToken,
        submissionId: row.id,
        decision: row.status,
        reason: "smoke-test",
      });
      update("kyc_roundtrip", { detail: `Re-affirmed status on ${row.id.slice(0, 8)}…` });
      return true;
    }).catch(() => { /* skip handled inline */ });

    // 5. Transactions list
    await time("txn_list", async () => {
      if (!stored) throw new Error("Skip — no session");
      const r = await callAdminFn<{ rows: unknown[]; total: number }>({
        action: "transactions_list",
        sessionToken: stored.sessionToken,
        search: "",
        status: "",
        flagged: false,
        minAmount: 0,
        maxAmount: 0,
        page: 1,
        pageSize: 5,
      });
      update("txn_list", { detail: `Fetched ${r.rows.length} txn(s) (total ${r.total})` });
      return r;
    });

    // 6. Supabase auth reachable
    await time("supabase_auth", async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      update("supabase_auth", { detail: data.session ? "User session present" : "Anonymous (OK)" });
      return data;
    });

    // 7. Realtime broadcast round-trip.
    //    Subscribes to a unique channel, then sends a `broadcast` event with a
    //    marker payload back to itself. We assert the marker arrives intact —
    //    this proves the realtime transport is fully end-to-end, not just that
    //    the subscription hand-shook.
    await time("realtime", async () => {
      const channelName = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const marker = `marker-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const channel = supabase.channel(channelName, { config: { broadcast: { self: true } } });

      const result = await new Promise<{ ok: boolean; reason: string; payload?: unknown }>((resolve) => {
        const timeoutId = window.setTimeout(
          () => resolve({ ok: false, reason: "Did not receive broadcast within 5s" }),
          5000,
        );
        channel
          .on("broadcast", { event: "diag-ping" }, (payload) => {
            if ((payload?.payload as { marker?: string } | undefined)?.marker === marker) {
              window.clearTimeout(timeoutId);
              resolve({ ok: true, reason: "Broadcast round-trip succeeded", payload: payload.payload });
            }
          })
          .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
              await channel.send({ type: "broadcast", event: "diag-ping", payload: { marker, ts: Date.now() } });
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              window.clearTimeout(timeoutId);
              resolve({ ok: false, reason: `Channel status: ${status}` });
            }
          });
      });

      void supabase.removeChannel(channel);
      if (!result.ok) throw new Error(result.reason);
      const payloadHint = result.payload ? ` payload=${JSON.stringify(result.payload).slice(0, 90)}` : "";
      update("realtime", { detail: `${result.reason}${payloadHint}` });
      return true;
    });

    setRunning(false);
    setChecks((prev) => {
      const passed = prev.filter((c) => c.status === "pass").length;
      const failed = prev.filter((c) => c.status === "fail").length;
      const skipped = prev.filter((c) => c.status === "skip").length;
      const finalSummary = `${passed} passed · ${failed} failed · ${skipped} skipped`;
      setSummary(finalSummary);
      // Persist the run so it survives reloads.
      savePersisted({
        ranAt: startedIso,
        smokeMode,
        adminEmail: admin?.email ?? null,
        checks: prev,
        summary: finalSummary,
      });
      return prev;
    });
  };

  function exportPdf() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = margin;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("TeenWallet Admin — Diagnostics Report", margin, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`Run at: ${ranAt ?? "—"}`, margin, y); y += 14;
    doc.text(`Admin: ${admin?.email ?? "—"} (${admin?.role ?? "—"})`, margin, y); y += 14;
    doc.text(`Mode: ${smokeMode ? "Smoke-test (read-only)" : "Live (writes allowed)"}`, margin, y); y += 14;
    doc.text(`Summary: ${summary || "—"}`, margin, y); y += 22;
    doc.setTextColor(0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Checks", margin, y); y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const c of checks) {
      if (y > pageH - margin - 40) { doc.addPage(); y = margin; }
      const status = c.status.toUpperCase();
      const ms = c.ms != null ? ` (${c.ms}ms)` : "";
      doc.setFont("helvetica", "bold");
      doc.text(`${status}  —  ${c.label}${ms}`, margin, y);
      y += 14;
      if (c.detail) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(90);
        const lines = doc.splitTextToSize(c.detail, pageW - margin * 2 - 16);
        for (const ln of lines) {
          if (y > pageH - margin - 20) { doc.addPage(); y = margin; }
          doc.text(ln, margin + 16, y); y += 12;
        }
        doc.setTextColor(0);
      }
      y += 6;
    }

    const stamp = (ranAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
    doc.save(`diagnostics-${stamp}.pdf`);
  }

  const ranAtPretty = useMemo(() => {
    if (!ranAt) return null;
    try { return new Date(ranAt).toLocaleString(); } catch { return ranAt; }
  }, [ranAt]);

  const blockReason = !admin
    ? "You aren't signed in to the admin console."
    : !allowedToRun
      ? smokeMode
        ? `Your role (${admin.role}) does not have viewKyc permission, which diagnostics needs even in smoke-test mode.`
        : `Your role (${admin.role}) does not have decideKyc permission. Switch on Smoke-test mode to run a read-only check, or sign in as an operations_manager / super_admin.`
      : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Diagnostics</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)" }}>
            End-to-end smoke tests for auth, API, KYC actions and realtime.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--a-muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={smokeMode}
              onChange={(e) => setSmokeMode(e.target.checked)}
              disabled={running}
            />
            Smoke-test mode (no writes)
          </label>
          <button
            onClick={exportPdf}
            disabled={running || !ranAt}
            className="a-btn"
            style={{ padding: "10px 14px", fontSize: 13, opacity: running || !ranAt ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
            title={ranAt ? "Export latest run as PDF" : "Run checks first to enable export"}
          >
            <Download size={14} /> Export PDF
          </button>
          <button
            onClick={runAll}
            disabled={running || !allowedToRun}
            className="a-btn a-btn-primary"
            style={{ padding: "10px 18px", fontSize: 13, opacity: running || !allowedToRun ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
            {running ? "Running…" : "Run checks"}
          </button>
        </div>
      </div>

      {blockReason && (
        <div
          style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "12px 14px", marginBottom: 16,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8, color: "#fca5a5", fontSize: 13,
          }}
          role="alert"
        >
          <ShieldAlert size={16} style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Diagnostics unavailable</div>
            <div style={{ color: "rgba(252,165,165,0.85)" }}>{blockReason}</div>
          </div>
        </div>
      )}

      {ranAtPretty && (
        <div className="a-mono" style={{ marginBottom: 12, fontSize: 11, color: "var(--a-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <History size={12} />
          {restoredFromStorage ? "Last run (restored): " : "Last run: "}{ranAtPretty} · {smokeMode ? "smoke-test" : "live"}
        </div>
      )}

      <div style={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden" }}>
        {checks.map((c, i) => (
          <div
            key={c.key}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr auto auto",
              gap: 12,
              alignItems: "center",
              padding: "14px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--a-border)",
            }}
          >
            <StatusIcon s={c.status} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
              {c.detail && (
                <div className="a-mono" style={{ fontSize: 11, color: c.status === "fail" ? "#ef4444" : "var(--a-muted)", marginTop: 2 }}>
                  {c.detail}
                </div>
              )}
            </div>
            <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>
              {c.ms != null ? `${c.ms}ms` : ""}
            </div>
            <div className="a-mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--a-muted)" }}>
              {c.status}
            </div>
          </div>
        ))}
      </div>

      {summary && (
        <div className="a-mono" style={{ marginTop: 16, fontSize: 12, color: "var(--a-muted)" }}>
          {summary}
        </div>
      )}
    </div>
  );
}
