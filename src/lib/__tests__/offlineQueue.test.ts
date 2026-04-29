import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the supabase client BEFORE importing the queue
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: () => ({
      update: (...a: unknown[]) => { mockUpdate(...a); return { eq: (...e: unknown[]) => { mockEq(...e); return { eq: (...e2: unknown[]) => { mockEq(...e2); return Promise.resolve({ error: null }); } }; } }; },
      insert: (...a: unknown[]) => { mockInsert(...a); return Promise.resolve({ error: null }); },
      delete: () => { mockDelete(); return { eq: (...e: unknown[]) => { mockEq(...e); return Promise.resolve({ error: null }); } }; },
    }),
  },
}));

import {
  enqueue, flush, getPendingCount, clearQueue, __resetOfflineQueueForTests,
} from "@/lib/offlineQueue";

describe("offlineQueue", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpdate.mockClear(); mockInsert.mockClear(); mockDelete.mockClear(); mockEq.mockClear();
    __resetOfflineQueueForTests();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
  afterEach(() => { clearQueue(); });

  it("executes immediately when online", async () => {
    const r = await enqueue("notif_mark_read", { id: "n1" });
    expect(r.executed).toBe(true);
    expect(getPendingCount()).toBe(0);
    expect(mockUpdate).toHaveBeenCalledWith({ read: true });
  });

  it("queues when offline and persists to localStorage", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const r = await enqueue("notif_mark_read", { id: "n2" });
    expect(r.queued).toBe(true);
    expect(getPendingCount()).toBe(1);
    expect(localStorage.getItem("tw-offline-queue-v1")).toContain("n2");
  });

  it("flush drains queue when back online", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await enqueue("notif_mark_read", { id: "n3" });
    expect(getPendingCount()).toBe(1);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const result = await flush();
    expect(result.ran).toBe(1);
    expect(getPendingCount()).toBe(0);
  });

  it("supports profile_update, contact_upsert, issue_report_submit, notif_delete kinds", async () => {
    await enqueue("profile_update", { fields: { full_name: "Jane" } });
    await enqueue("contact_upsert", { user_id: "u1", name: "A", upi_id: "a@upi" });
    await enqueue("issue_report_submit", { category: "bug", message: "x" });
    await enqueue("notif_delete", { id: "n9" });
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(2); // contact insert + issue report
    expect(mockDelete).toHaveBeenCalled();
  });
});
