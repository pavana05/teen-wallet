import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Stage = "STAGE_0" | "STAGE_1" | "STAGE_2" | "STAGE_3" | "STAGE_4" | "STAGE_5";

interface AppState {
  stage: Stage;
  splashSeen: boolean;
  pendingPhone: string | null;
  userId: string | null;
  fullName: string | null;
  balance: number;
  setStage: (s: Stage) => void;
  setSplashSeen: (v: boolean) => void;
  setPendingPhone: (p: string | null) => void;
  hydrateFromProfile: (p: { id: string; full_name: string | null; balance: number; onboarding_stage: Stage }) => void;
  reset: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      stage: "STAGE_0",
      splashSeen: false,
      pendingPhone: null,
      userId: null,
      fullName: null,
      balance: 2450,
      setStage: (stage) => set({ stage }),
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
    { name: "teenwallet-app" }
  )
);
