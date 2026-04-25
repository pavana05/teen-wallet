import type { ReactNode } from "react";

export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#050505] flex items-start sm:items-center justify-center">
      <div className="tw-app-shell tw-grain flex flex-col">{children}</div>
    </div>
  );
}
