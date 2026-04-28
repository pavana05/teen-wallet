import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callAdminFn, readAdminSession, useAdminSession, can } from "@/admin/lib/adminAuth";
import { toast } from "sonner";
import {
  Loader2, Check, RotateCcw, MessageSquarePlus, Image as ImageIcon, Camera,
  Flag, UserPlus, Send, Inbox,
} from "lucide-react";

export const Route = createFileRoute("/admin/reports")({
  component: ReportsPage,
});

type Priority = "low" | "normal" | "high" | "urgent";
type Status = "open" | "resolved";

interface Report {
  id: string;
  user_id: string | null;
  category: string;
  status: string;
  priority: Priority;
  assigned_to_email: string | null;
  last_activity_at: string;
  message: string;
  route: string | null;
  user_agent: string | null;
  app_version: string | null;
  screenshot_path: string | null;
  camera_photo_path: string | null;
  console_errors: unknown;
  stack_trace: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  created_at: string;
}
interface Note { id: string; admin_email: string; body: string; created_at: string; }
interface DetailResp { report: Report; notes: Note[]; screenshotUrl: string | null; cameraPhotoUrl: string | null; }

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "#ef4444", bg: "rgba(239,68,68,.12)" },
  high:   { label: "High",   color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  normal: { label: "Normal", color: "#64748b", bg: "rgba(100,116,139,.12)" },
  low:    { label: "Low",    color: "#94a3b8", bg: "rgba(148,163,184,.12)" },
};

function ReportsPage() {
  const { admin, loading: sessLoading } = useAdminSession();
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | Status>("open");
  const [category, setCategory] = useState<"all" | "bug" | "feature" | "feedback" | "general">("all");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [assigned, setAssigned] = useState<"all" | "mine" | "unassigned">("all");
  const [sort, setSort] = useState<"priority" | "newest" | "activity">("priority");
  const [routeFilter, setRouteFilter] = useState("");
  const [selected, setSelected] = useState<DetailResp | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const session = readAdminSession();
  const sessionToken = session?.sessionToken ?? "";

  const canManage = can(admin?.role, "manageReports");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: Report[] }>({
        action: "reports_list", sessionToken,
        status, category, priority, assigned, sort,
        route: routeFilter, limit: 100,
      });
      setRows(r.rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reports");
    } finally { setLoading(false); }
  }, [sessionToken, status, category, priority, assigned, sort, routeFilter]);

  useEffect(() => { if (sessionToken) void load(); }, [load, sessionToken]);

  const openDetail = async (id: string) => {
    try {
      const r = await callAdminFn<DetailResp>({ action: "reports_get", sessionToken, id });
      setSelected(r);
      setNoteText("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const toggleResolved = async (id: string, resolved: boolean) => {
    setBusy(true);
    try {
      await callAdminFn({ action: "reports_resolve", sessionToken, id, resolved });
      toast.success(resolved ? "Marked resolved" : "Reopened");
      await load();
      if (selected?.report.id === id) await openDetail(id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const setReportPriority = async (id: string, p: Priority) => {
    setBusy(true);
    try {
      await callAdminFn({ action: "reports_set_priority", sessionToken, id, priority: p });
      toast.success(`Priority → ${PRIORITY_META[p].label}`);
      await load();
      if (selected?.report.id === id) await openDetail(id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const assignToMe = async (id: string, take: boolean) => {
    if (!admin) return;
    setBusy(true);
    try {
      await callAdminFn({ action: "reports_assign", sessionToken, id, assignee: take ? admin.email : null });
      toast.success(take ? "Assigned to you" : "Unassigned");
      await load();
      if (selected?.report.id === id) await openDetail(id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const addNote = async () => {
    if (!selected || !noteText.trim()) return;
    setBusy(true);
    try {
      const r = await callAdminFn<{ note: Note }>({
        action: "reports_add_note", sessionToken, id: selected.report.id, body: noteText.trim(),
      });
      setSelected({ ...selected, notes: [...selected.notes, r.note] });
      setNoteText("");
      toast.success("Reply posted");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c = { urgent: 0, high: 0, mine: 0, unassigned: 0 };
    for (const r of rows) {
      if (r.priority === "urgent") c.urgent++;
      if (r.priority === "high") c.high++;
      if (admin && r.assigned_to_email === admin.email) c.mine++;
      if (!r.assigned_to_email) c.unassigned++;
    }
    return c;
  }, [rows, admin]);

  if (sessLoading) return null;
  if (!admin || !can(admin.role, "viewReports")) {
    return <Navigate to="/admin" />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Support Tickets</h1>
          <p style={{ color: "var(--a-muted)", fontSize: 13 }}>Inbound bugs, ideas and feedback. Triage, prioritize and reply.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Stat label="Urgent" value={counts.urgent} color="#ef4444" />
          <Stat label="High" value={counts.high} color="#f59e0b" />
          <Stat label="Mine" value={counts.mine} color="#3b82f6" />
          <Stat label="Unassigned" value={counts.unassigned} color="#64748b" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="a-input" style={{ width: 130 }}>
          <option value="all">All status</option><option value="open">Open</option><option value="resolved">Resolved</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="a-input" style={{ width: 130 }}>
          <option value="all">All priority</option>
          <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
        <select value={assigned} onChange={(e) => setAssigned(e.target.value as typeof assigned)} className="a-input" style={{ width: 140 }}>
          <option value="all">All assignees</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="a-input" style={{ width: 140 }}>
          <option value="all">All categories</option>
          <option value="bug">Bug</option><option value="feature">Idea</option><option value="feedback">Feedback</option><option value="general">General</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="a-input" style={{ width: 150 }}>
          <option value="priority">Sort: Priority</option>
          <option value="activity">Sort: Last activity</option>
          <option value="newest">Sort: Newest</option>
        </select>
        <input value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} placeholder="Filter by route…" className="a-input" style={{ flex: 1, minWidth: 180 }} />
        <button className="a-btn a-btn-ghost" onClick={() => void load()}><RotateCcw size={14} /> Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 16 }}>
        <div style={{ border: "1px solid var(--a-border)", borderRadius: 10, overflow: "hidden", background: "var(--a-surface)" }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>
              <Loader2 className="inline-block animate-spin" size={16} /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>
              <Inbox size={20} style={{ display: "inline-block", marginBottom: 4, opacity: .5 }} />
              <div>No tickets match these filters.</div>
            </div>
          ) : rows.map((r) => {
            const pm = PRIORITY_META[r.priority];
            const isMine = admin && r.assigned_to_email === admin.email;
            return (
              <button key={r.id} onClick={() => openDetail(r.id)}
                style={{
                  width: "100%", textAlign: "left", padding: "12px 14px",
                  borderBottom: "1px solid var(--a-border)",
                  background: selected?.report.id === r.id ? "var(--a-elevated)" : "transparent",
                  cursor: "pointer", display: "block",
                  borderLeft: `3px solid ${pm.color}`,
                }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: pm.bg, color: pm.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{pm.label}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--a-surface-2)", textTransform: "uppercase", letterSpacing: ".05em" }}>{r.category}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: r.status === "resolved" ? "var(--a-success)" : "var(--a-warn)", border: `1px solid ${r.status === "resolved" ? "var(--a-success)" : "var(--a-warn)"}` }}>{r.status}</span>
                  {isMine && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(59,130,246,.15)", color: "#3b82f6" }}>● mine</span>}
                  <span style={{ fontSize: 11, color: "var(--a-muted)", marginLeft: "auto" }}>{relTime(r.last_activity_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--a-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message}</div>
                <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2, display: "flex", gap: 8 }}>
                  <span>{r.route ?? "—"}</span>
                  {r.assigned_to_email && !isMine && <span>· {r.assigned_to_email}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ border: "1px solid var(--a-border)", borderRadius: 10, padding: 16, background: "var(--a-surface)", minHeight: 400 }}>
          {!selected ? (
            <div style={{ color: "var(--a-muted)", fontSize: 13, textAlign: "center", padding: 60 }}>
              <Inbox size={28} style={{ display: "inline-block", marginBottom: 8, opacity: .5 }} />
              <div>Select a ticket to inspect</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--a-muted)" }}>
                    {new Date(selected.report.created_at).toLocaleString()} · {selected.report.route ?? "—"}
                  </div>
                  <div style={{ fontSize: 14, marginTop: 6, whiteSpace: "pre-wrap" }}>{selected.report.message}</div>
                </div>
                {canManage && (
                  <button className="a-btn a-btn-primary" disabled={busy}
                    onClick={() => toggleResolved(selected.report.id, selected.report.status !== "resolved")}>
                    <Check size={14} /> {selected.report.status === "resolved" ? "Reopen" : "Resolve"}
                  </button>
                )}
              </div>

              {canManage && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, padding: 10, background: "var(--a-surface-2)", borderRadius: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--a-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Flag size={11} /> Priority:
                  </span>
                  {(["urgent","high","normal","low"] as Priority[]).map(p => {
                    const active = selected.report.priority === p;
                    const m = PRIORITY_META[p];
                    return (
                      <button key={p} disabled={busy} onClick={() => setReportPriority(selected.report.id, p)}
                        style={{
                          fontSize: 11, padding: "3px 10px", borderRadius: 12,
                          border: `1px solid ${active ? m.color : "var(--a-border)"}`,
                          background: active ? m.bg : "transparent",
                          color: active ? m.color : "var(--a-muted)",
                          cursor: "pointer", fontWeight: active ? 600 : 400,
                        }}>
                        {m.label}
                      </button>
                    );
                  })}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--a-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                    <UserPlus size={11} />
                    {selected.report.assigned_to_email ?? "Unassigned"}
                  </span>
                  {admin && (
                    selected.report.assigned_to_email === admin.email ? (
                      <button className="a-btn a-btn-ghost" disabled={busy} onClick={() => assignToMe(selected.report.id, false)}>Release</button>
                    ) : (
                      <button className="a-btn a-btn-ghost" disabled={busy} onClick={() => assignToMe(selected.report.id, true)}>Assign to me</button>
                    )
                  )}
                </div>
              )}

              {(selected.screenshotUrl || selected.cameraPhotoUrl) && (
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  {selected.screenshotUrl && (
                    <a href={selected.screenshotUrl} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--a-muted)", marginBottom: 4 }}><ImageIcon size={11} className="inline-block" /> Screenshot</div>
                      <img src={selected.screenshotUrl} alt="Screenshot" style={{ width: "100%", borderRadius: 6, border: "1px solid var(--a-border)" }} />
                    </a>
                  )}
                  {selected.cameraPhotoUrl && (
                    <a href={selected.cameraPhotoUrl} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--a-muted)", marginBottom: 4 }}><Camera size={11} className="inline-block" /> Camera</div>
                      <img src={selected.cameraPhotoUrl} alt="Camera" style={{ width: "100%", borderRadius: 6, border: "1px solid var(--a-border)" }} />
                    </a>
                  )}
                </div>
              )}

              {selected.report.stack_trace && (
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ fontSize: 12, color: "var(--a-muted)", cursor: "pointer" }}>Stack trace</summary>
                  <pre style={{ fontSize: 10, padding: 8, background: "var(--a-bg)", borderRadius: 4, overflow: "auto", maxHeight: 200 }}>{selected.report.stack_trace}</pre>
                </details>
              )}
              {Array.isArray(selected.report.console_errors) && selected.report.console_errors.length > 0 && (
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ fontSize: 12, color: "var(--a-muted)", cursor: "pointer" }}>Console errors ({(selected.report.console_errors as unknown[]).length})</summary>
                  <pre style={{ fontSize: 10, padding: 8, background: "var(--a-bg)", borderRadius: 4, overflow: "auto", maxHeight: 200 }}>{JSON.stringify(selected.report.console_errors, null, 2)}</pre>
                </details>
              )}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--a-border)" }}>
                <div style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquarePlus size={12} /> Conversation ({selected.notes.length})
                </div>
                <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 8 }}>
                  {selected.notes.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--a-muted)", textAlign: "center", padding: 16 }}>No replies yet</div>
                  )}
                  {selected.notes.map((n) => {
                    const own = admin && n.admin_email === admin.email;
                    return (
                      <div key={n.id} style={{
                        fontSize: 12, padding: 10, borderRadius: 8, marginBottom: 6,
                        background: own ? "rgba(59,130,246,.08)" : "var(--a-surface-2)",
                        borderLeft: own ? "2px solid #3b82f6" : "2px solid var(--a-border)",
                      }}>
                        <div style={{ color: "var(--a-muted)", fontSize: 10, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                          <span>{n.admin_email}</span>
                          <span>{new Date(n.created_at).toLocaleString()}</span>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                      </div>
                    );
                  })}
                </div>
                {canManage && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote(); }
                      }}
                      placeholder="Reply to ticket… (⌘/Ctrl+Enter to send)"
                      rows={3}
                      className="a-input"
                      style={{ flex: 1, resize: "vertical" }}
                    />
                    <button className="a-btn a-btn-primary" onClick={addNote} disabled={busy || !noteText.trim()} style={{ alignSelf: "flex-end" }}>
                      <Send size={12} /> Send
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: "6px 12px", borderRadius: 8, background: "var(--a-surface)",
      border: "1px solid var(--a-border)", minWidth: 70, textAlign: "center",
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--a-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `${dd}d ago`;
  return new Date(iso).toLocaleDateString();
}
