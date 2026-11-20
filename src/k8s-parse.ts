/**
 * Pure parser for pasted kubectl output. No LLM, no I/O: it only extracts
 * what is literally in the text, so anything it returns is a fact, not a guess.
 */

export interface ContainerFacts {
  name: string;
  image?: string;
  /** Current state: Waiting, Running or Terminated. */
  state?: string;
  /** Why it is in that state, e.g. CrashLoopBackOff. */
  reason?: string;
  /** Reason the previous run ended, e.g. OOMKilled. */
  lastReason?: string;
  exitCode?: number;
  restarts?: number;
  memoryLimit?: string;
}

export interface PodFacts {
  name: string;
  namespace?: string;
  node?: string;
  status?: string;
  ready?: string;
  restarts?: number;
  containers: ContainerFacts[];
}

export interface EventFacts {
  type: "Normal" | "Warning";
  reason: string;
  age: string;
  message: string;
}

export interface K8sFacts {
  kind: "describe" | "get-pods" | "logs" | "unknown";
  pods: PodFacts[];
  events: EventFacts[];
  /** Known failure signals found in the text, highest priority first. */
  signals: string[];
  exitCodes: number[];
  /** Error-looking log lines (logs only). */
  logErrors: string[];
}

/** Failure signals detectable from text, in priority order. Names match runbook ids. */
const SIGNALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OOMKilled", pattern: /OOMKilled|Exit Code:\s*137/i },
  {
    name: "CrashLoopBackOff",
    pattern: /CrashLoopBackOff|Back-off restarting/i
  },
  { name: "ImagePullBackOff", pattern: /ImagePullBackOff|ErrImagePull/i },
  {
    name: "FailedScheduling",
    pattern: /FailedScheduling|Insufficient (cpu|memory)/i
  },
  { name: "Evicted", pattern: /\bEvicted\b/ },
  {
    name: "ConfigError",
    pattern: /CreateContainerConfigError|CreateContainerError/i
  },
  {
    name: "ProbeFailed",
    pattern: /(Readiness|Liveness|Startup) probe failed/i
  },
  { name: "FailedMount", pattern: /FailedMount|FailedAttachVolume/i },
  { name: "NodeNotReady", pattern: /NodeNotReady|\bNotReady\b/ }
];

const EVENT_ROW = /^\s*(Normal|Warning)\s+(\S+)\s+(.+?)\s{2,}\S+\s+(.*\S)\s*$/;

function parseDescribe(text: string): { pod: PodFacts; events: EventFacts[] } {
  const lines = text.split("\n");
  const field = (key: string) =>
    lines
      .find((l) => l.startsWith(`${key}:`))
      ?.slice(key.length + 1)
      .trim();

  const pod: PodFacts = {
    name: field("Name") ?? "unknown",
    namespace: field("Namespace"),
    node: field("Node")?.split("/")[0],
    status: field("Status"),
    containers: []
  };
  if (pod.node === "<none>") pod.node = undefined;

  const events: EventFacts[] = [];
  let section = "";
  let container: ContainerFacts | undefined;
  let ctx = "";

  for (const line of lines) {
    if (/^\S/.test(line)) {
      section = line.split(":")[0] ?? "";
      container = undefined;
      continue;
    }
    if (section === "Events") {
      const m = EVENT_ROW.exec(line);
      if (m) {
        events.push({
          type: m[1] as EventFacts["type"],
          reason: m[2] ?? "",
          age: (m[3] ?? "").trim(),
          message: m[4] ?? ""
        });
      }
      continue;
    }
    if (section !== "Containers") continue;

    const header = /^ {2}(\S+):\s*$/.exec(line);
    if (header) {
      container = { name: header[1] ?? "" };
      pod.containers.push(container);
      ctx = "";
      continue;
    }
    if (!container) continue;
    const t = line.trim();
    const value = (key: string) =>
      t.startsWith(`${key}:`) ? t.slice(key.length + 1).trim() : undefined;

    if (value("Image")) container.image = value("Image");
    else if (t.startsWith("Last State:")) {
      ctx = "last";
    } else if (t.startsWith("State:")) {
      ctx = "state";
      container.state = value("State")?.split(/\s+/)[0];
    } else if (t === "Limits:") ctx = "limits";
    else if (t === "Requests:" || t === "Environment:") ctx = "other";
    else if (t.startsWith("Reason:")) {
      if (ctx === "last") container.lastReason = value("Reason");
      else if (ctx === "state") container.reason = value("Reason");
    } else if (t.startsWith("Exit Code:") && ctx === "last") {
      container.exitCode = Number(value("Exit Code"));
    } else if (t.startsWith("Restart Count:")) {
      container.restarts = Number(value("Restart Count"));
    } else if (t.startsWith("memory:") && ctx === "limits") {
      container.memoryLimit = value("memory");
    }
  }
  return { pod, events };
}

/** `kubectl get pods [-A]`: columns are separated by 2+ spaces. */
function parseGetPods(text: string): PodFacts[] {
  const [headerLine, ...rows] = text.split("\n").filter((l) => l.trim());
  const cols = (headerLine ?? "")
    .trim()
    .split(/\s{2,}/)
    .map((c) => c.toLowerCase());
  return rows.flatMap((row) => {
    const cells = row.trim().split(/\s{2,}/);
    const get = (name: string) => cells[cols.indexOf(name)];
    const name = get("name");
    if (!name) return [];
    const restarts = parseInt(get("restarts") ?? "", 10);
    return [
      {
        name,
        namespace: get("namespace"),
        status: get("status"),
        ready: get("ready"),
        restarts: Number.isNaN(restarts) ? undefined : restarts,
        containers: []
      }
    ];
  });
}

function parseLogErrors(text: string): string[] {
  const pattern =
    /\b(error|fatal|panic|exception|refused|timed? ?out|denied|no such host)\b/i;
  return text
    .split("\n")
    .filter((l) => pattern.test(l))
    .map((l) => l.trim().slice(0, 200))
    .slice(0, 5);
}

export function parseK8sOutput(text: string): K8sFacts {
  const facts: K8sFacts = {
    kind: "unknown",
    pods: [],
    events: [],
    signals: SIGNALS.filter((s) => s.pattern.test(text)).map((s) => s.name),
    exitCodes: [
      ...new Set(
        [...text.matchAll(/Exit Code:\s*(\d+)/g)].map((m) => Number(m[1]))
      )
    ],
    logErrors: []
  };

  if (/^Name:\s/m.test(text) && /^(Containers|Namespace):/m.test(text)) {
    const { pod, events } = parseDescribe(text);
    facts.kind = "describe";
    facts.pods = [pod];
    facts.events = events;
    pod.restarts = pod.containers.reduce((n, c) => n + (c.restarts ?? 0), 0);
  } else if (/^(NAMESPACE\s+)?NAME\s+READY\s+STATUS/m.test(text)) {
    facts.kind = "get-pods";
    facts.pods = parseGetPods(text);
  } else if (
    /\d{4}-\d{2}-\d{2}T|\b(ERROR|FATAL|WARN|INFO)\b|panic:/.test(text)
  ) {
    facts.kind = "logs";
    facts.logErrors = parseLogErrors(text);
  }
  return facts;
}
