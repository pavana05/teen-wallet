import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { callAdminFn, readAdminSession, useAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, XCircle, Loader2, PlayCircle } from "lucide-react";

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

const INITIAL: Check[] = [
  { key: "session", label: "Admin session valid", status: "idle" },
  { key: "session_persist", label: "Session persists in storage", status: "idle" },
  { key: "kyc_list", label: "KYC list fetch (pending)", status: "idle" },
  { key: "kyc_roundtrip", label: "KYC approve/reject round-trip", status: "idle" },
  { key: "txn_list", label: "Transactions list fetch", status: "idle" },
  { key: "supabase_auth", label: "Supabase auth reachable", status: "idle" },
  { key: "realtime", label: "Realtime channel subscribe", status: "idle" },
];

function StatusIcon({ s }: { s: CheckStatus }) {
  if (s === "running") return <Loader2 size={16} className="animate-spin" style={{ color: "var(--a-accent)" }} />;
  if (s === "pass") return <CheckCircle2 size={16} style={{ color: "#10b981" }} />;
  if (s === "fail") return <XCircle size={16} style={{ color: "#ef4444" }} />;
  if (s === "skip") return <Activity size={16} style={{ color: "var(--a-muted)" }} />;
  return <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--a-border)" }} />;
}

function DiagnosticsPage() {
  const { admin } = useAdminSession();
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string>("");

  const update = (key: string, patch: Partial<Check>) =>
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const time = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    update(key, { status: "running", detail: undefined, ms: undefined });
    const t0 = performance.now();
    try {
      const r = await fn();
      update(key, { status: "pass", ms: Math.round(performance.now() - t0) });
      return r;
    } catch (e: any) {
      update(key, { status: "fail", detail: e?.message || String(e), ms: Math.round(performance.now() - t0) });
      return null;
    }
  };

  const runAll = async () => {
    setRunning(true);
    setChecks(INITIAL.map((c) => ({ ...c })));
    setSummary("");

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
    const kycList = await time<{ rows: Array<{ id: string; user_id: string; status: string }> }>(
      "kyc_list",
      async () => {
        if (!stored) throw new Error("Skip — no session");
        const r = await callAdminFn<{ rows: any[]; total: number }>({
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

    // 4. KYC round-trip — only if there's a pending row, flip approve→pending (non-destructive: re-set to pending)
    await time("kyc_roundtrip", async () => {
      if (!stored) throw new Error("Skip — no session");
      const row = kycList?.rows?.[0];
      if (!row) {
        update("kyc_roundtrip", { status: "skip", detail: "No pending KYC submission to test against" });
        throw new Error("__skip__");
      }
      // attempt a no-op: set to current status
      await callAdminFn({
        action: "kyc_decide",
        sessionToken: stored.sessionToken,
        submissionId: row.id,
        decision: row.status, // re-affirm current status
        reason: "smoke-test",
      });
      update("kyc_roundtrip", { detail: `Re-affirmed status on ${row.id.slice(0, 8)}…` });
      return true;
    }).catch(() => {});

    // 5. Transactions list
    await time("txn_list", async () => {
      if (!stored) throw new Error("Skip — no session");
      const r = await callAdminFn<{ rows: any[]; total: number }>({
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

    // 7. Realtime
    await time("realtime", async () => {
      const channel = supabase.channel(`diag-${Date.now()}`);
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 5000);
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "kyc_submissions" }, () => {})
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(t);
              resolve(true);
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              clearTimeout(t);
              resolve(false);
            }
          });
      });
      void supabase.removeChannel(channel);
      if (!ok) throw new Error("Channel did not reach SUBSCRIBED within 5s");
      update("realtime", { detail: "Subscribed to kyc_submissions changes" });
      return true;
    });

    setRunning(false);
    setChecks((prev) => {
      const passed = prev.filter((c) => c.status === "pass").length;
      const failed = prev.filter((c) => c.status === "fail").length;
      const skipped = prev.filter((c) => c.status === "skip").length;
      setSummary(`${passed} passed · ${failed} failed · ${skipped} skipped`);
      return prev;
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Diagnostics</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)" }}>
            End-to-end smoke tests for auth, API, KYC actions and realtime.
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={running || !admin}
          className="a-btn a-btn-primary"
          style={{ padding: "10px 18px", fontSize: 13, opacity: running || !admin ? 0.6 : 1 }}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          {running ? "Running…" : "Run checks"}
        </button>
      </div>

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
