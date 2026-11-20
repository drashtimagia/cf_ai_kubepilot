import { getAgentByName } from "agents";
import { z } from "zod";
import {
  MAX_BODY_BYTES,
  alertmanagerSchema,
  bearerToken,
  methodFor,
  verifyToken,
  type ApiAction
} from "./alerts";

const diagnoseSchema = z.object({
  input: z.string().min(1).max(MAX_BODY_BYTES),
  requireApproval: z.boolean().optional()
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * HTTP API for machines: the Alertmanager webhook and the CLI. Every call is
 * for one cluster and needs that cluster's token. Nothing here touches a
 * Kubernetes cluster; it only feeds text to the agent.
 */
export async function handleApi(
  request: Request,
  env: Env,
  { clusterId, action }: { clusterId: string; action: ApiAction }
): Promise<Response> {
  if (request.method !== methodFor(action)) {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!env.WEBHOOK_SECRET) {
    return json(
      { error: "API is not configured: WEBHOOK_SECRET is not set" },
      503
    );
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!(await verifyToken(env.WEBHOOK_SECRET, clusterId, token))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const agent = await getAgentByName(env.KubePilotAgent, clusterId);

  if (action === "diagnosis") {
    return json({ diagnosis: await agent.currentDiagnosis() });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return json({ error: "Body too large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  if (action === "alerts") {
    const parsed = alertmanagerSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "Not an Alertmanager payload",
          issues: parsed.error.issues.slice(0, 3)
        },
        400
      );
    }
    return json(await agent.ingestAlerts(parsed.data.alerts));
  }

  const parsed = diagnoseSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: 'Expected {"input": string, "requireApproval"?: boolean}' },
      400
    );
  }
  const result = await agent.startDiagnosisWith(
    parsed.data.input,
    parsed.data.requireApproval
  );
  return "error" in result ? json(result, 409) : json(result, 202);
}
