// Helper for calling authenticated TanStack server functions.
//
// `createServerFn` does NOT automatically attach the Supabase session JWT to
// requests, so any server function gated by `requireSupabaseAuth` will 401
// unless we pass the token explicitly. We forward it via the `headers` option
// supported by the server-fn transport.
//
// On a 401, the middleware throws a raw `Response` which surfaces to the
// browser as an unhandled `[object Response]` runtime error (blank screen).
// Always call authenticated server fns through `withAuth(...)` to avoid this.

import { supabase } from "@/integrations/supabase/client";

type ServerFn<TResult> = (arg: {
  data: Record<string, unknown>;
  headers?: Record<string, string>;
}) => Promise<TResult>;

export async function callWithAuth<TResult>(
  fn: ServerFn<TResult>,
  data: Record<string, unknown>,
): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Not signed in");
  }
  return fn({
    data: { ...data, authToken: token },
    headers: { Authorization: `Bearer ${token}` },
  });
}
