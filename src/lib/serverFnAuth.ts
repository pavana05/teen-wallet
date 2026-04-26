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

type ServerFnArg<TInput> = { data: TInput; headers?: Record<string, string> };
type ServerFn<TInput, TResult> = (arg: ServerFnArg<TInput>) => Promise<TResult>;

export async function callWithAuth<TInput, TResult>(
  fn: ServerFn<TInput, TResult>,
  data: TInput,
): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Not signed in");
  }
  return fn({
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
}
