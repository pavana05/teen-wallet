import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom doesn't implement these — stub for components that touch them.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Mock the Supabase client so Home's data fetch is deterministic.
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

// Stub the asset import used by Home.
vi.mock("@/assets/home-hero-scan.jpg", () => ({ default: "hero.jpg" }));
