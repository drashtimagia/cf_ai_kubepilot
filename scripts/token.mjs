#!/usr/bin/env node
// Prints the API token for a cluster id: HMAC-SHA256(WEBHOOK_SECRET, clusterId).
//   npm run token -- prod-eu
// WEBHOOK_SECRET comes from the environment or from .dev.vars.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const tokenFor = (secret, clusterId) =>
  createHmac("sha256", secret).update(clusterId).digest("hex");

function secretFromDevVars() {
  if (!existsSync(".dev.vars")) return undefined;
  const line = readFileSync(".dev.vars", "utf8")
    .split("\n")
    .find((l) => l.startsWith("WEBHOOK_SECRET="));
  return line
    ?.slice("WEBHOOK_SECRET=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const clusterId = process.argv[2];
  const secret = process.env.WEBHOOK_SECRET || secretFromDevVars();
  if (!clusterId || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(clusterId)) {
    console.error(
      "Usage: npm run token -- <cluster-id>   (3-40 chars: a-z, 0-9, -)"
    );
    process.exit(2);
  }
  if (!secret) {
    console.error("WEBHOOK_SECRET is not set (environment or .dev.vars).");
    process.exit(2);
  }
  console.log(tokenFor(secret, clusterId));
}
