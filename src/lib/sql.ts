import { neon, neonConfig } from "@neondatabase/serverless";

// One way to open the database for app code and scripts alike. Production is
// a *.neon.tech host and goes to Neon's own HTTP endpoint, exactly as before.
// A localhost URL goes to the local neon-http-shim (scripts/db/lib), which
// speaks the same protocol to a local Postgres, so both run the same driver
// and the same type parsers. Edge-safe: no pg, no Node built-ins here.

const DEFAULT_LOCAL_SHIM_PORT = 7433;
// Host of the eval bridge's connection strings (scripts/rag/setup-eval-db).
const EVAL_SHIM_HOST = "neon-local-shim";

function urlParts(url: string): { host: string; database: string } | null {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, database: parsed.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

export function isLocalDatabaseUrl(url: string): boolean {
  return urlParts(url)?.host === "localhost";
}

export function localShimEndpoint(): string {
  const port = process.env.NEON_LOCAL_SHIM_PORT?.trim() || String(DEFAULT_LOCAL_SHIM_PORT);
  return `http://127.0.0.1:${port}/sql`;
}

export function routeFetchEndpoint(
  host: string,
  _port: number | string,
  options?: { jwtAuth?: boolean }
): string {
  if (host === "localhost") return localShimEndpoint();
  const evalShimUrl = process.env.NEON_HTTP_SHIM_URL?.trim();
  if (host === EVAL_SHIM_HOST && evalShimUrl) return evalShimUrl;
  // Neon's default: the first host label becomes api. (apiauth. for JWT auth).
  return `https://${host.replace(/^[^.]+\./, options?.jwtAuth ? "apiauth." : "api.")}/sql`;
}

export function createSql(url: string) {
  if (neonConfig.fetchEndpoint !== routeFetchEndpoint) {
    neonConfig.fetchEndpoint = routeFetchEndpoint;
  }
  return neon(url);
}

export function describeDatabaseTarget(url: string): string {
  const parts = urlParts(url);
  if (!parts) return "unknown database";
  if (parts.host === "localhost" || parts.host === EVAL_SHIM_HOST) {
    return `local database ${parts.database}`;
  }
  return `PRODUCTION database ${parts.host.split(".")[0].replace(/-pooler$/, "")}`;
}
