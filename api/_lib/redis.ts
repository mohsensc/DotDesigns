// Upstash Redis over its REST API, with plain fetch.
//
// No SDK: the REST interface is just a POST with the command as a JSON array,
// so a client is a dozen lines and the repo keeps its zero runtime dependencies.
//
// Vercel injects the credentials when you connect a Redis store to the project.
// Which pair of names you get depends on how it was provisioned, so both are
// accepted — that's a naming alias, not a fallback value. With neither set,
// isConfigured() is false and every caller fails closed.

const URL_VARS = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"] as const;
const TOKEN_VARS = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"] as const;

function firstSet(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export function isConfigured(): boolean {
  return !!firstSet(URL_VARS) && !!firstSet(TOKEN_VARS);
}

/**
 * Runs one Redis command. `["GET", "inv:qty:ash-bowl"]` and so on.
 *
 * Throws a plain Error with no credential in the message — this bubbles up to
 * endpoints that turn it into a generic 5xx, and an error string is the easiest
 * accidental route for a token to reach a client or a log aggregator.
 */
export async function command<T = unknown>(args: (string | number)[]): Promise<T> {
  const url = firstSet(URL_VARS);
  const token = firstSet(TOKEN_VARS);
  if (!url || !token) throw new Error("Redis is not configured.");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    // Inventory is the thing we must not read stale, so never let a cache
    // sit between the server and the number it's about to charge against.
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Redis request failed (${res.status}).`);

  const body = (await res.json()) as { result?: T; error?: string };
  if (body.error) throw new Error("Redis rejected the command.");
  return body.result as T;
}

/**
 * Runs a Lua script server-side. This is the only way to make read-then-write
 * genuinely atomic — the sold-out check and the decrement have to happen
 * without another request slipping between them, or two people can buy the
 * same last piece.
 */
export async function eval_<T = unknown>(
  script: string,
  keys: string[],
  argv: (string | number)[],
): Promise<T> {
  return command<T>(["EVAL", script, keys.length, ...keys, ...argv]);
}
