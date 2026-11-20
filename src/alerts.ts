import { z } from "zod";
import type { Severity } from "./types";

/** Cluster ids become Durable Object names and URL parts, so keep them boring. */
export const CLUSTER_ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const MAX_BODY_BYTES = 200_000;
export const MAX_ALERTS_PER_REQUEST = 20;
/** Only this many new incidents are opened per webhook call. */
export const MAX_NEW_INCIDENTS = 5;

const strings = z.record(z.string(), z.string());

/** The parts of an Alertmanager v4 webhook payload we read. Extra fields are ignored. */
export const alertmanagerSchema = z.object({
  alerts: z
    .array(
      z.object({
        status: z.enum(["firing", "resolved"]),
        labels: strings,
        annotations: strings.optional(),
        fingerprint: z.string().max(100).optional(),
        startsAt: z.string().optional()
      })
    )
    .max(MAX_ALERTS_PER_REQUEST)
});
export type Alert = z.infer<typeof alertmanagerSchema>["alerts"][number];

/** Stable id for deduplication: Alertmanager's fingerprint, else the sorted labels. */
export function alertKey(alert: Alert): string {
  return (
    alert.fingerprint ||
    Object.entries(alert.labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",")
  );
}

export function alertSeverity(alert: Alert): Severity {
  switch (alert.labels.severity) {
    case "critical":
      return "critical";
    case "high":
    case "error":
      return "high";
    case "info":
    case "none":
      return "low";
    default:
      return "medium";
  }
}

export function alertTitle(alert: Alert): string {
  const name = alert.labels.alertname ?? "Alert";
  const where = [alert.labels.namespace, alert.labels.pod ?? alert.labels.node]
    .filter(Boolean)
    .join("/");
  return `${name}${where ? `: ${where}` : ""}`.slice(0, 100);
}

/**
 * The alert as plain text. This is what the diagnosis reads, so it states
 * only what the alert itself carries.
 */
export function alertToEvidence(alert: Alert): string {
  const labels = Object.entries(alert.labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const lines = [`Alertmanager alert (${alert.status}): ${labels}`];
  for (const key of ["summary", "description", "message"]) {
    const value = alert.annotations?.[key];
    if (value) lines.push(`${key}: ${value}`);
  }
  return lines.join("\n").slice(0, 2000);
}

// ---- per-cluster tokens ----

const enc = new TextEncoder();

/** HMAC-SHA256(secret, clusterId) as hex. One secret, one derived token per cluster. */
export async function clusterToken(
  secret: string,
  clusterId: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(clusterId))
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking where the first difference is. */
export async function verifyToken(
  secret: string,
  clusterId: string,
  presented: string | null
): Promise<boolean> {
  if (!presented) return false;
  const expected = enc.encode(await clusterToken(secret, clusterId));
  const given = enc.encode(presented);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= (expected[i] ?? 0) ^ (given[i] ?? 0);
  return diff === 0;
}

export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

// ---- routes ----

export type ApiAction = "alerts" | "diagnose" | "diagnosis";

const ROUTES: Record<ApiAction, string> = {
  alerts: "POST",
  diagnose: "POST",
  diagnosis: "GET"
};

/** Matches /api/clusters/:id/:action. Returns undefined for anything else. */
export function parseApiPath(
  pathname: string
): { clusterId: string; action: ApiAction } | undefined {
  const m = /^\/api\/clusters\/([^/]+)\/(alerts|diagnose|diagnosis)\/?$/.exec(
    pathname
  );
  if (!m) return undefined;
  const clusterId = decodeURIComponent(m[1] ?? "");
  const action = m[2] as ApiAction;
  return CLUSTER_ID.test(clusterId) ? { clusterId, action } : undefined;
}

export const methodFor = (action: ApiAction): string => ROUTES[action];
