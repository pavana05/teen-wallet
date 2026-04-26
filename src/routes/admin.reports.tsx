import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import { toast } from "sonner";
import { Loader2, Check, RotateCcw, MessageSquarePlus, Image as ImageIcon, Camera } from "lucide-react";

export const Route = createFileRoute("/admin/reports")({
  component: ReportsPage,
});

interface Report {
  id: string;
  user_id: string | null;
  category: string;
  status: string;
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

function ReportsPage() {
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | "open" | "resolved">("open");
  const [category, setCategory] = useState<"all" | "bug" | "feature" | "feedback" | "general">("all");
  const [routeFilter, setRouteFilter] = useState("");
  const [selected, setSelected] = useState<DetailResp | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const session = readAdminSession();
  const sessionToken = session?.sessionToken ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: Report[] }>({
        action: "reports_list", sessionToken, status, category, route: routeFilter, limit: 100,
      });
      setRows(r.rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reports");
    } finally { setLoading(false); }
  }, [sessionToken, status, category, routeFilter]);

  useEffect(() => { void load(); }, [load]);

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

  const addNote = async () => {
    if (!selected || !noteText.trim()) return;
    setBusy(true);
    try {
      const r = await callAdminFn<{ note: Note }>({
        action: "reports_add_note", sessionToken, id: selected.report.id, body: noteText.trim(),
      });
      setSelected({ ...selected, notes: [...selected.notes, r.note] });
      setNoteText("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Issue Reports</h1>
      <p style={{ color: "var(--a-muted)", fontSize: 13, marginBottom: 16 }}>Inbound bugs, ideas and feedback from shake-to-report.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="a-input" style={{ width: 140 }}>
          <option value="all">All status</option><option value="open">Open</option><option value="resolved">Resolved</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="a-input" style={{ width: 160 }}>
          <option value="all">All categories</option>
          <option value="bug">Bug</option><option value="feature">Idea</option><option value="feedback">Feedback</option><option value="general">General</option>
        </select>
        <input value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} placeholder="Filter by route…" className="a-input" style={{ flex: 1, minWidth: 200 }} />
        <button className="a-btn a-btn-ghost" onClick={() => void load()}><RotateCcw size={14} /> Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 16 }}>
        <div style={{ border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden", background: "var(--a-surface)" }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}><Loader2 className="inline-block animate-spin" size={16} /> Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>No reports match these filters.</div>
          ) : rows.map((r) => (
            <button key={r.id} onClick={() => openDetail(r.id)}
              style={{
                width: "100%", textAlign: "left", padding: "12px 14px",
                borderBottom: "1px solid var(--a-border)", background: selected?.report.id === r.id ? "var(--a-elevated)" : "transparent",
                cursor: "pointer", display: "block",
              }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--a-surface-2)", textTransform: "uppercase", letterSpacing: ".05em" }}>{r.category}</span>
                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: r.status === "resolved" ? "var(--a-success)" : "var(--a-warn)", border: `1px solid ${r.status === "resolved" ? "var(--a-success)" : "var(--a-warn)"}` }}>{r.status}</span>
                <span style={{ fontSize: 11, color: "var(--a-muted)", marginLeft: "auto" }}>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--a-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message}</div>
              <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{r.route ?? "—"}</div>
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid var(--a-border)", borderRadius: 8, padding: 16, background: "var(--a-surface)", minHeight: 400 }}>
          {!selected ? (
            <div style={{ color: "var(--a-muted)", fontSize: 13, textAlign: "center", padding: 60 }}>Select a report to inspect</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--a-muted)" }}>{new Date(selected.report.created_at).toLocaleString()} · {selected.report.route ?? "—"}</div>
                  <div style={{ fontSize: 14, marginTop: 6, whiteSpace: "pre-wrap" }}>{selected.report.message}</div>
                </div>
                <button className="a-btn a-btn-primary" disabled={busy}
                  onClick={() => toggleResolved(selected.report.id, selected.report.status !== "resolved")}>
                  <Check size={14} /> {selected.report.status === "resolved" ? "Reopen" : "Mark resolved"}
                </button>
              </div>

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
                  <MessageSquarePlus size={12} /> Internal notes ({selected.notes.length})
                </div>
                {selected.notes.map((n) => (
                  <div key={n.id} style={{ fontSize: 12, padding: 8, background: "var(--a-surface-2)", borderRadius: 4, marginBottom: 6 }}>
                    <div style={{ color: "var(--a-muted)", fontSize: 10, marginBottom: 2 }}>{n.admin_email} · {new Date(n.created_at).toLocaleString()}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add internal note…" rows={2} className="a-input" style={{ flex: 1, resize: "vertical" }} />
                  <button className="a-btn a-btn-primary" onClick={addNote} disabled={busy || !noteText.trim()}>Add</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
