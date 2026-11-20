import { CLUSTER_ID } from "./alerts";

/**
 * Which agent instance this browser talks to. `?cluster=prod-eu` joins a named
 * cluster (and is remembered); otherwise each browser gets its own private
 * workspace id, so visitors no longer share one chat and memory.
 */
export function resolveClusterId(input: {
  search: string;
  stored: string | null;
  random: () => string;
}): string {
  const fromUrl = new URLSearchParams(input.search).get("cluster");
  if (fromUrl && CLUSTER_ID.test(fromUrl)) return fromUrl;
  if (input.stored && CLUSTER_ID.test(input.stored)) return input.stored;
  return input.random();
}

const KEY = "kubepilot-cluster";

/** Browser wrapper. Storage can be blocked, so every access is guarded. */
export function getClusterId(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Private mode or blocked storage: fall back to a per-load workspace.
  }
  const id = resolveClusterId({
    search: window.location.search,
    stored,
    random: () => `ws-${crypto.randomUUID().slice(0, 8)}`
  });
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Ignore: the id still works for this page load.
  }
  return id;
}
