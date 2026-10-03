import type { Env } from "../config.ts";
import { SuiteError } from "../errors.ts";
export async function stateCall<T>(
  env: Env,
  account: string,
  operation: string,
  body: unknown = {},
): Promise<T> {
  const stub = env.AUTH_STATE.get(env.AUTH_STATE.idFromName(account));
  const response = await stub.fetch(
    new Request(`https://state${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, body }),
    }),
  );
  const v = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok)
    throw new SuiteError(
      v.code ?? "STATE_UNAVAILABLE",
      v.message ?? "Account state is unavailable.",
      response.status,
    );
  return v;
}
export const globalCall = <T>(
  env: Env,
  operation: string,
  body: unknown = {},
) => stateCall<T>(env, "identity", operation, body);
