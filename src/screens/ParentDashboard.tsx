import { useState, useEffect, useCallback } from "react";
import {
  Bell, Shield, Users, BarChart3, Clock, Lock, AlertTriangle,
  ChevronRight, Sparkles, LogOut, QrCode, Copy, Check, Link2, Eye
} from "lucide-react";
import React from "react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { logout } from "@/lib/auth";
import { toast } from "sonner";

interface LinkedChild {
  id: string;
  teen_user_id: string;
  teen_name: string | null;
  teen_balance: number;
  status: string;
}

export function ParentDashboard() {
  const { fullName, userId } = useApp();
  const [children, setChildren] = useState<LinkedChild[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notifications, setNotifications] = useState(0);

  const firstName = fullName?.split(" ")[0] || "there";

  const loadData = useCallback(async () => {
    // Use RPC to safely read linked children (bypasses profile RLS)
    const { data: links } = await supabase.rpc("get_linked_children");

    if (links && Array.isArray(links) && links.length > 0) {
      const mapped: LinkedChild[] = links.map((l: Record<string, unknown>) => ({
        id: l.link_id as string,
        teen_user_id: l.teen_user_id as string,
        teen_name: (l.teen_name as string) ?? null,
        teen_balance: Number(l.teen_balance ?? 0),
        status: l.link_status as string,
      }));
      setChildren(mapped);
    }

    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("read", false);
    if (count) setNotifications(count);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const generateInvite = async () => {
    haptics.tap();
    setGenBusy(true);
    try {
      const { data, error } = await supabase.rpc("generate_family_invite_code");
      if (error) throw error;
      setInviteCode(data as string);
      setShowInvite(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate code");
    }
    setGenBusy(false);
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    haptics.tap();
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Code copied!");
    } catch {
      toast.error("Couldn't copy code");
    }
  };

  const handleLogout = async () => {
    haptics.tap();
    await logout();
    useApp.getState().reset();
  };

  const formatAmt = (n: number) =>
    "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <div className="flex-1 flex flex-col pd-root overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <div>
          <p className="text-[11px] font-medium tracking-widest uppercase pd-label">
            <Shield className="w-3.5 h-3.5 inline mr-1" />Parent Dashboard
          </p>
          <h1 className="text-xl font-bold pd-heading mt-0.5">Hello, {firstName}! 🛡️</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => haptics.tap()} className="pd-icon-btn relative">
            <Bell className="w-5 h-5" />
            {notifications > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold">{notifications > 9 ? "9+" : notifications}</span>
            )}
          </button>
          <button onClick={handleLogout} className="pd-icon-btn"><LogOut className="w-4.5 h-4.5" /></button>
        </div>
      </div>

      {/* Family Overview Card */}
      <div className="mx-5 mt-2 pd-family-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-wider uppercase pd-family-label">Family Members</p>
            <p className="text-2xl font-bold mt-1 pd-family-count">{children.length} <span className="text-sm font-medium pd-family-sub">linked {children.length === 1 ? "child" : "children"}</span></p>
          </div>
          <div className="pd-family-icon">
            <Users className="w-7 h-7" />
          </div>
        </div>
        <button onClick={generateInvite} disabled={genBusy} className="pd-invite-btn mt-4">
          <Link2 className="w-4 h-4" />
          {genBusy ? "Generating…" : "Invite Child"}
        </button>
      </div>

      {/* Linked Children */}
      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase pd-label mb-3">Your Children</p>
        {children.length === 0 ? (
          <div className="pd-empty-state">
            <Users className="w-10 h-10 pd-sub" />
            <p className="text-sm pd-heading mt-3 font-semibold">No children linked yet</p>
            <p className="text-[12px] pd-sub mt-1">Generate an invite code and share it with your child</p>
            <button onClick={generateInvite} disabled={genBusy} className="pd-cta-btn mt-4">
              <QrCode className="w-4 h-4" /> Generate Invite Code
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {children.map((child) => (
              <div key={child.id} className="pd-child-card">
                <div className="pd-child-avatar">
                  {child.teen_name?.[0]?.toUpperCase() || "T"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold pd-heading truncate">{child.teen_name || "Teen User"}</p>
                  <p className="text-[11px] pd-sub">Balance: {formatAmt(child.teen_balance)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="pd-active-badge">Active</span>
                  <ChevronRight className="w-4 h-4 pd-chevron" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Parent Controls */}
      <div className="mx-5 mt-5 mb-6">
        <p className="text-[11px] font-medium tracking-widest uppercase pd-label mb-3">Controls</p>
        <div className="flex flex-col gap-2">
          {[
            { icon: Clock, label: "Screen Time", desc: "Set daily limits", color: "#f59e0b" },
            { icon: Lock, label: "Spending Limits", desc: "Control spending", color: "#6366f1" },
            { icon: BarChart3, label: "Activity Reports", desc: "Weekly summaries", color: "#10b981" },
            { icon: AlertTriangle, label: "Safety Alerts", desc: "Emergency notifications", color: "#ef4444" },
            { icon: Eye, label: "Transaction Monitor", desc: "Real-time activity", color: "#8b5cf6" },
          ].map(({ icon: Icon, label, desc, color }) => (
            <button key={label} onClick={() => haptics.tap()} className="pd-control-row">
              <div className="pd-control-icon" style={{ background: `${color}15`, color }}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium pd-heading">{label}</p>
                <p className="text-[11px] pd-sub">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 pd-chevron" />
            </button>
          ))}
        </div>
      </div>

      {/* Invite Code Modal */}
      {showInvite && inviteCode && (
        <div className="pd-overlay" onClick={() => setShowInvite(false)}>
          <div className="pd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="pd-qr-placeholder">
                <QrCode className="w-12 h-12 pd-accent" />
              </div>
              <h3 className="text-lg font-bold pd-heading mt-4">Share This Code</h3>
              <p className="text-sm pd-sub mt-1">Ask your child to enter this code in their Teen Wallet app</p>
              <div className="pd-code-display mt-4">
                <span className="pd-code-text">{inviteCode}</span>
              </div>
              <button onClick={copyCode} className="pd-copy-btn mt-3">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy Code"}
              </button>
              <p className="text-[11px] pd-sub mt-3">Code expires in 24 hours</p>
            </div>
            <button onClick={() => setShowInvite(false)} className="pd-btn-secondary mt-4 w-full">Done</button>
          </div>
        </div>
      )}

      <style>{`
        .pd-root { background: var(--background); }
        .pd-label { color: oklch(0.82 0.06 85); }
        .pd-heading { color: var(--foreground); }
        .pd-sub { color: oklch(0.55 0.01 250); }
        .pd-accent { color: oklch(0.82 0.06 85); }
        .pd-chevron { color: oklch(0.35 0.01 250); }

        .pd-icon-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250);
          border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center;
          color: oklch(0.7 0.01 250);
        }

        .pd-family-card {
          padding: 20px;
          border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
          box-shadow: 0 8px 32px -8px oklch(0.82 0.06 85 / 0.08);
        }
        .pd-family-label { color: oklch(0.65 0.03 85); }
        .pd-family-count { color: oklch(0.92 0.04 85); }
        .pd-family-sub { color: oklch(0.65 0.03 85); }
        .pd-family-icon {
          width: 52px; height: 52px; border-radius: 16px;
          background: oklch(0.82 0.06 85 / 0.12);
          color: oklch(0.82 0.06 85);
          display: flex; align-items: center; justify-content: center;
        }
        .pd-invite-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 11px; border-radius: 14px;
          background: oklch(0.82 0.06 85 / 0.12);
          color: oklch(0.82 0.06 85);
          font-size: 13px; font-weight: 600;
          border: 1px solid oklch(0.82 0.06 85 / 0.25);
          cursor: pointer;
        }
        .pd-invite-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .pd-empty-state {
          display: flex; flex-direction: column; align-items: center;
          padding: 32px 24px; border-radius: 18px;
          background: oklch(0.12 0.005 250);
          border: 1.5px dashed oklch(0.25 0.005 250);
        }
        .pd-cta-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 20px; border-radius: 12px;
          background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
          color: oklch(0.12 0.005 250);
          font-size: 13px; font-weight: 600;
          border: none; cursor: pointer;
        }
        .pd-cta-btn:disabled { opacity: 0.5; }

        .pd-child-card {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.22 0.005 250);
        }
        .pd-child-avatar {
          width: 42px; height: 42px; border-radius: 14px;
          background: linear-gradient(135deg, oklch(0.45 0.1 250), oklch(0.35 0.08 280));
          color: oklch(0.9 0.04 250);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 16px;
        }
        .pd-active-badge {
          font-size: 10px; font-weight: 700; padding: 3px 10px;
          border-radius: 999px; background: oklch(0.5 0.1 145 / 0.15);
          color: oklch(0.7 0.1 145); text-transform: uppercase; letter-spacing: 0.05em;
        }

        .pd-control-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.2 0.005 250);
          cursor: pointer; width: 100%;
        }
        .pd-control-icon {
          width: 42px; height: 42px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .pd-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: oklch(0.05 0 0 / 0.85);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .pd-modal {
          width: 100%; max-width: 360px;
          padding: 28px; border-radius: 22px;
          background: oklch(0.14 0.005 250);
          border: 1px solid oklch(0.25 0.005 250);
        }
        .pd-qr-placeholder {
          width: 100px; height: 100px; border-radius: 20px;
          background: oklch(0.1 0.005 250);
          border: 2px dashed oklch(0.82 0.06 85 / 0.3);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto;
        }
        .pd-code-display {
          padding: 16px; border-radius: 16px;
          background: oklch(0.1 0.005 250);
          border: 2px solid oklch(0.82 0.06 85 / 0.3);
        }
        .pd-code-text {
          font-size: 28px; font-weight: 800; letter-spacing: 0.2em;
          color: oklch(0.92 0.04 85);
          font-family: monospace;
        }
        .pd-copy-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 10px;
          background: oklch(0.82 0.06 85 / 0.12);
          color: oklch(0.82 0.06 85);
          font-size: 13px; font-weight: 600;
          border: none; cursor: pointer;
        }
        .pd-btn-secondary {
          padding: 12px; border-radius: 14px; font-weight: 600; font-size: 14px;
          background: oklch(0.2 0.005 250);
          color: oklch(0.7 0.01 250); border: none; cursor: pointer;
        }

        @media (prefers-reduced-motion: reduce) {
          .pd-family-card, .pd-child-card, .pd-control-row { transition: none; }
        }
      `}</style>
    </div>
  );
}
