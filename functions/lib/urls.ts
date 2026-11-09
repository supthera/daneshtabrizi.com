/** Join a connector base endpoint with a relative path without wiping the base path. */
export function joinEndpoint(base: string, path: string): string {
  const trimmed = (base || "").trim();
  if (!trimmed) throw new Error("Missing API endpoint");
  const root = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  const rel = String(path || "").replace(/^\/+/, "");
  return new URL(rel, root).toString();
}
