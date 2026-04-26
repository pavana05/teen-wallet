import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setStage as persistStageRemote } from "./auth";
import { breadcrumb, captureError, setBreadcrumbUser } from "./breadcrumbs";

export type Stage = "STAGE_0" | "STAGE_1" | "STAGE_2" | "STAGE_3" | "STAGE_4" | "STAGE_5";

interface AppState {
  stage: Stage;
  splashSeen: boolean;
  pendingPhone: string | null;
  userId: string | null;
  fullName: string | null;
  balance: number;
  /** Set stage locally AND fire-and-forget persist to backend so cross-device resume works. */
  setStage: (s: Stage) => void;
  /** Set stage locally only (no remote write). Use during boot/hydration. */
  setStageLocal: (s: Stage) => void;
  setSplashSeen: (v: boolean) => void;
  setPendingPhone: (p: string | null) => void;
  hydrateFromProfile: (p: { id: string; full_name: string | null; balance: number; onboarding_stage: Stage }) => void;
  reset: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      stage: "STAGE_0",
      splashSeen: false,
      pendingPhone: null,
      userId: null,
      fullName: null,
      balance: 2450,
      setStage: (stage) => {
        set({ stage });
        // Only persist remote if we have an authenticated user. Errors are non-fatal —
        // the local persisted state still allows resume on this device, and the next
        // boot will reconcile via fetchProfile().
        if (get().userId) {
          persistStageRemote(stage).catch((err) => {
            console.warn("[stage] remote persist failed", err);
          });
        }
      },
      setStageLocal: (stage) => set({ stage }),
      setSplashSeen: (splashSeen) => set({ splashSeen }),
      setPendingPhone: (pendingPhone) => set({ pendingPhone }),
      hydrateFromProfile: (p) => set({
        userId: p.id,
        fullName: p.full_name,
        balance: Number(p.balance ?? 2450),
        stage: p.onboarding_stage,
      }),
      reset: () => set({ stage: "STAGE_0", splashSeen: false, pendingPhone: null, userId: null, fullName: null, balance: 2450 }),
    }),
    {
      name: "teenwallet-app",
      // Persist only what's needed to resume across restarts. Never persist `balance`
      // (server is source of truth) or `pendingPhone` (transient OTP state).
      partialize: (s) => ({
        stage: s.stage,
        splashSeen: s.splashSeen,
        userId: s.userId,
        fullName: s.fullName,
      }),
      version: 2,
    }
  )
);
