import type { Diagnosis } from "../src/types";

export function formatDiagnosis(d: Diagnosis): string;

export function run(opts: {
  input: string;
  env: Record<string, string | undefined>;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<number>;
