#!/usr/bin/env node
// kubepilot: pipe kubectl output in, get a diagnosis out.
//
//   kubectl describe pod payments-api-7d9f8b6c5-x2k4p -n payments | kubepilot
//
// Read-only: it sends text to your KubePilot deployment and prints the answer.
// It never runs kubectl or any suggested command.
//
// Environment:
//   KUBEPILOT_URL      e.g. https://cf-ai-kubepilot.<you>.workers.dev
//   KUBEPILOT_CLUSTER  cluster id (3-40 chars: a-z, 0-9, -)
//   KUBEPILOT_TOKEN    that cluster's token (`npm run token -- <cluster>`)

import { pathToFileURL } from "node:url";

const MAX_INPUT = 200_000;

/** Renders a finished diagnosis as plain text. */
export function formatDiagnosis(d) {
  if (d.status === "error")
    return `Diagnosis failed: ${d.error ?? "unknown error"}`;
  const r = d.result;
  if (!r) return "No result.";
  const out = [
    `KubePilot diagnosis: ${r.category} (${r.severity})`,
    r.summary,
    ""
  ];
  if (r.hypotheses.length === 0) out.push("No hypotheses.");
  else out.push("Ranked hypotheses (AI guesses, not facts):");
  r.hypotheses.forEach((h, i) => {
    out.push(`${i + 1}. ${h.title} [${h.confidence}]`, `   ${h.why}`);
    out.push(
      `   $ ${h.command}   ${h.readOnly ? "[read-only]" : "[CHANGES THE CLUSTER]"}`
    );
  });
  if (r.withheld > 0)
    out.push("", `${r.withheld} cluster-changing suggestion(s) withheld.`);
  out.push("", "KubePilot only suggests commands. Nothing was run.");
  return out.join("\n");
}

/**
 * Runs one diagnosis. Dependencies are passed in so tests can fake the network.
 * Returns the process exit code.
 */
export async function run({
  input,
  env,
  fetchFn,
  log,
  sleep,
  timeoutMs = 120_000
}) {
  const {
    KUBEPILOT_URL: url,
    KUBEPILOT_CLUSTER: cluster,
    KUBEPILOT_TOKEN: token
  } = env;
  if (!url || !cluster || !token) {
    log("Set KUBEPILOT_URL, KUBEPILOT_CLUSTER and KUBEPILOT_TOKEN.");
    return 2;
  }
  if (!input.trim()) {
    log(
      "Pipe some kubectl output in, e.g.: kubectl describe pod <pod> | kubepilot"
    );
    return 2;
  }
  if (input.length > MAX_INPUT) {
    log(
      `Input is ${input.length} characters; the limit is ${MAX_INPUT}. Pipe less.`
    );
    return 2;
  }

  const base = `${url.replace(/\/$/, "")}/api/clusters/${encodeURIComponent(cluster)}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
  const call = async (path, init) => {
    const res = await fetchFn(`${base}/${path}`, { ...init, headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const before = (await call("diagnosis", { method: "GET" })).body.diagnosis
    ?.id;
  const start = await call("diagnose", {
    method: "POST",
    body: JSON.stringify({ input })
  });
  if (start.status === 401) {
    log("Unauthorized: check KUBEPILOT_TOKEN and KUBEPILOT_CLUSTER.");
    return 1;
  }
  if (start.status !== 202) {
    log(start.body.error ?? `Request failed (${start.status}).`);
    return 1;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const { body } = await call("diagnosis", { method: "GET" });
    const d = body.diagnosis;
    if (d && d.id !== before && d.status !== "running") {
      log(formatDiagnosis(d));
      return d.status === "complete" ? 0 : 1;
    }
  }
  log("Timed out waiting for the diagnosis.");
  return 1;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const input = process.stdin.isTTY ? "" : await readStdin();
  const code = await run({
    input,
    env: process.env,
    fetchFn: fetch,
    log: (line) => console.log(line),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  });
  process.exit(code);
}
