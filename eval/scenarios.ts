/**
 * 28 labelled incidents. Each input is what an operator would paste, and the
 * root cause is determinable from that input alone (a describe plus the log
 * line or event that shows why). `cause` lists lowercase phrases; a hypothesis
 * counts as correct when its title or reasoning contains any of them.
 */
export interface Scenario {
  id: string;
  title: string;
  input: string;
  expected: {
    /** Acceptable categories from the classify step. */
    category: string[];
    cause: string[];
  };
}

type Row = [
  type: "Normal" | "Warning",
  reason: string,
  age: string,
  from: string,
  message: string
];

const events = (rows: Row[]) =>
  [
    "Events:",
    "  Type     Reason     Age                  From               Message",
    "  ----     ------     ----                 ----               -------",
    ...rows.map(
      ([t, r, a, f, m]) =>
        `  ${t.padEnd(8)} ${r.padEnd(10)} ${a.padEnd(20)} ${f.padEnd(18)} ${m}`
    )
  ].join("\n");

interface PodSpec {
  name: string;
  ns: string;
  node?: string;
  status: string;
  state: string;
  reason?: string;
  last?: { reason: string; exit: number };
  restarts?: number;
  image?: string;
  memLimit?: string;
  memRequest?: string;
  cpuRequest?: string;
  ready?: boolean;
  rows: Row[];
  logs?: string;
}

/** `kubectl describe pod` in the real column layout, optionally followed by logs. */
function pod(p: PodSpec): string {
  const lines = [
    `Name:             ${p.name}`,
    `Namespace:        ${p.ns}`,
    `Node:             ${p.node ?? "<none>"}`,
    `Status:           ${p.status}`,
    "Containers:",
    "  app:",
    `    Image:          ${p.image ?? "registry.example.com/app:1.0.0"}`,
    `    State:          ${p.state}`
  ];
  if (p.reason) lines.push(`      Reason:       ${p.reason}`);
  if (p.last) {
    lines.push(
      "    Last State:     Terminated",
      `      Reason:       ${p.last.reason}`,
      `      Exit Code:    ${p.last.exit}`
    );
  }
  lines.push(
    `    Ready:          ${p.ready ? "True" : "False"}`,
    `    Restart Count:  ${p.restarts ?? 0}`
  );
  if (p.memLimit) lines.push("    Limits:", `      memory:  ${p.memLimit}`);
  if (p.memRequest || p.cpuRequest) {
    lines.push("    Requests:");
    if (p.cpuRequest) lines.push(`      cpu:     ${p.cpuRequest}`);
    if (p.memRequest) lines.push(`      memory:  ${p.memRequest}`);
  }
  lines.push(events(p.rows));
  const out = lines.join("\n");
  return p.logs
    ? `${out}\n\n$ kubectl logs ${p.name} -n ${p.ns} --previous\n${p.logs}\n`
    : `${out}\n`;
}

const backoff = (name: string, ns: string): Row => [
  "Warning",
  "BackOff",
  "4m (x31 over 12m)",
  "kubelet",
  `Back-off restarting failed container app in pod ${name}_${ns}`
];

const crash = (
  id: string,
  title: string,
  name: string,
  ns: string,
  exit: number,
  logs: string,
  cause: string[],
  category = ["CrashLoopBackOff"],
  extraRows: Row[] = []
): Scenario => ({
  id,
  title,
  input: pod({
    name,
    ns,
    node: "worker-3",
    status: "Running",
    state: "Waiting",
    reason: "CrashLoopBackOff",
    last: { reason: "Error", exit },
    restarts: 9,
    cpuRequest: "100m",
    memRequest: "128Mi",
    rows: [...extraRows, backoff(name, ns)],
    logs
  }),
  expected: { category, cause }
});

const node = (
  name: string,
  ready: string,
  reasonLine: string,
  pressure?: string
) =>
  [
    `Name:               ${name}`,
    "Roles:              <none>",
    "Conditions:",
    "  Type             Status    Reason                       Message",
    "  ----             ------    ------                       -------",
    `  MemoryPressure   False     KubeletHasSufficientMemory   kubelet has sufficient memory available`,
    `  DiskPressure     ${pressure ? "True " : "False"}     ${pressure ? "KubeletHasDiskPressure     " : "KubeletHasNoDiskPressure  "}   ${pressure ?? "kubelet has no disk pressure"}`,
    `  Ready            ${ready}     ${reasonLine}`,
    events([
      [
        "Normal",
        "NodeNotReady",
        "6m",
        "node-controller",
        `Node ${name} status is now: NodeNotReady`
      ]
    ])
  ].join("\n") + "\n";

export const SCENARIOS: Scenario[] = [
  // ---- CrashLoopBackOff (8) ----
  crash(
    "crash-db-refused",
    "App cannot reach its database",
    "orders-api-6d5f7c8b9-k4m2p",
    "orders",
    1,
    "2026-11-19T09:20:11Z INFO  starting orders-api\n2026-11-19T09:20:11Z ERROR failed to connect to database: dial tcp 10.96.14.7:5432: connect: connection refused\n2026-11-19T09:20:11Z FATAL cannot start without database",
    ["database", "postgres", "connection refused", "5432"]
  ),
  crash(
    "crash-missing-env",
    "Required env var missing",
    "billing-5b9c7d6f4-q8w2n",
    "billing",
    1,
    "Error: required environment variable STRIPE_API_KEY is not set\n    at loadConfig (/app/config.js:14:11)\n    at main (/app/index.js:3:1)",
    ["environment variable", "env var", "stripe_api_key", "not set"]
  ),
  crash(
    "crash-bad-entrypoint",
    "Entrypoint binary not found",
    "worker-7c8d9f5b6-z3x9v",
    "jobs",
    127,
    'exec: "/app/serve": stat /app/serve: no such file or directory',
    ["entrypoint", "/app/serve", "executable", "no such file", "binary"]
  ),
  crash(
    "crash-exec-format",
    "Wrong CPU architecture image",
    "edge-proxy-5f6b8c7d9-r2t5y",
    "edge",
    255,
    "exec /usr/local/bin/proxy: exec format error",
    ["architecture", "exec format", "arm64", "amd64", "wrong platform"]
  ),
  crash(
    "crash-nil-panic",
    "Go nil pointer panic",
    "search-4c5d6e7f8-h6j7k",
    "search",
    2,
    "panic: runtime error: invalid memory address or nil pointer dereference\n[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x4a1b2c]\n\ngoroutine 1 [running]:\nmain.(*Indexer).Load(0x0)\n\t/app/indexer.go:88 +0x2c",
    ["panic", "nil pointer", "dereference", "segmentation"]
  ),
  crash(
    "crash-liveness",
    "Liveness probe kills a slow starter",
    "reports-8d7c6b5a4-n9m8l",
    "analytics",
    137,
    "INFO warming caches (this takes ~90s)\nINFO listening on :8080",
    ["liveness", "probe"],
    ["ProbeFailed", "CrashLoopBackOff"],
    [
      [
        "Warning",
        "Unhealthy",
        "3m (x14 over 9m)",
        "kubelet",
        'Liveness probe failed: Get "http://10.0.4.17:8080/healthz": context deadline exceeded'
      ],
      [
        "Normal",
        "Killing",
        "3m (x4 over 9m)",
        "kubelet",
        "Container app failed liveness probe, will be restarted"
      ]
    ]
  ),
  crash(
    "crash-permission-denied",
    "Cannot write to its data directory",
    "cache-3b4c5d6e7-v1b2n",
    "platform",
    1,
    "ERROR open /data/cache.db: permission denied\nERROR cannot initialise cache, exiting",
    ["permission", "fsgroup", "security context", "runasuser", "ownership"]
  ),
  crash(
    "crash-bad-config",
    "Config file fails to parse",
    "gateway-9e8d7c6b5-p4o3i",
    "gateway",
    1,
    "ERROR failed to load /etc/gateway/config.yaml: yaml: line 12: did not find expected key",
    ["yaml", "config.yaml", "parse", "syntax", "malformed"]
  ),

  // ---- OOMKilled (3) ----
  {
    id: "oom-limit-low",
    title: "Memory limit far below working set",
    input: pod({
      name: "checkout-5c8d6f7b9d-m7q2w",
      ns: "shop",
      node: "worker-2",
      status: "Running",
      state: "Running",
      last: { reason: "OOMKilled", exit: 137 },
      restarts: 6,
      memLimit: "256Mi",
      memRequest: "128Mi",
      ready: true,
      rows: [backoff("checkout-5c8d6f7b9d-m7q2w", "shop")],
      logs: "INFO heap in use: 241MiB\nINFO heap in use: 252MiB"
    }),
    expected: {
      category: ["OOMKilled"],
      cause: ["memory limit", "too low", "working set", "limit is"]
    }
  },
  {
    id: "oom-java-heap",
    title: "JVM heap larger than the container limit",
    input: pod({
      name: "inventory-7b6a5c4d3-w9e8r",
      ns: "supply",
      node: "worker-1",
      status: "Running",
      state: "Waiting",
      reason: "CrashLoopBackOff",
      last: { reason: "OOMKilled", exit: 137 },
      restarts: 11,
      memLimit: "512Mi",
      rows: [backoff("inventory-7b6a5c4d3-w9e8r", "supply")],
      logs: 'Picked up JAVA_TOOL_OPTIONS: -Xmx1g\nException in thread "main" java.lang.OutOfMemoryError: Java heap space'
    }),
    expected: { category: ["OOMKilled"], cause: ["heap", "xmx", "jvm", "java"] }
  },
  {
    id: "oom-batch-job",
    title: "Batch job loads a huge file into memory",
    input: pod({
      name: "nightly-export-29384-x7k2p",
      ns: "data",
      node: "worker-4",
      status: "Failed",
      state: "Terminated",
      reason: "OOMKilled",
      last: { reason: "OOMKilled", exit: 137 },
      memLimit: "1Gi",
      ready: false,
      rows: [["Normal", "Started", "12m", "kubelet", "Started container app"]],
      logs: "INFO reading /exports/2026-11-18.csv (3.8 GiB)\nINFO loading all rows into memory"
    }),
    expected: {
      category: ["OOMKilled"],
      cause: ["large file", "entire file", "all rows", "stream", "memory limit"]
    }
  },

  // ---- ImagePullBackOff (3) ----
  ...[
    [
      "pull-not-found",
      "Image tag does not exist",
      "reports-6b7f9c4d58-h9z4t",
      "analytics",
      "registry.example.com/reports:v3.0.0-rc1",
      'rpc error: code = NotFound desc = failed to pull and unpack image "registry.example.com/reports:v3.0.0-rc1": not found',
      ["tag", "not found", "does not exist", "manifest", "typo", "unpushed"]
    ],
    [
      "pull-unauthorized",
      "Private registry without credentials",
      "ledger-5a4b3c2d1-t6y7u",
      "finance",
      "registry.example.com/private/ledger:2.1.0",
      "failed to authorize: failed to fetch anonymous token: unexpected status: 401 Unauthorized; pull access denied, repository does not exist or may require authorization",
      [
        "imagepullsecret",
        "credential",
        "authenticat",
        "unauthorized",
        "private registry",
        "pull secret"
      ]
    ],
    [
      "pull-rate-limit",
      "Docker Hub pull rate limit",
      "cron-runner-4d3c2b1a0-o9i8u",
      "ops",
      "docker.io/library/python:3.12",
      "toomanyrequests: You have reached your pull rate limit. You may increase the limit by authenticating and upgrading",
      ["rate limit", "toomanyrequests", "docker hub", "pull limit"]
    ]
  ].map(([id, title, name, ns, image, msg, cause]) => ({
    id: id as string,
    title: title as string,
    input: pod({
      name: name as string,
      ns: ns as string,
      node: "worker-1",
      status: "Pending",
      state: "Waiting",
      reason: "ImagePullBackOff",
      image: image as string,
      rows: [
        [
          "Warning",
          "Failed",
          "4m (x4 over 6m)",
          "kubelet",
          `Failed to pull image "${image}": ${msg}`
        ],
        [
          "Warning",
          "Failed",
          "4m (x4 over 6m)",
          "kubelet",
          "Error: ErrImagePull"
        ],
        [
          "Normal",
          "BackOff",
          "78s (x12 over 6m)",
          "kubelet",
          `Back-off pulling image "${image}"`
        ]
      ]
    }),
    expected: { category: ["ImagePullBackOff"], cause: cause as string[] }
  })),

  // ---- Pending / FailedScheduling (4) ----
  ...[
    [
      "sched-insufficient-cpu",
      "No node has enough CPU",
      "batch-worker-84f6d9c7b6-t5r8k",
      "jobs",
      "16",
      "8Gi",
      "0/5 nodes are available: 5 Insufficient cpu. preemption: 0/5 nodes are available: 5 No preemption victims found for incoming pod.",
      ["insufficient cpu", "cpu request", "not enough cpu", "cpu capacity"]
    ],
    [
      "sched-taint",
      "Nodes are tainted and the pod does not tolerate it",
      "trainer-7f6e5d4c3-b2a1z",
      "ml",
      "2",
      "4Gi",
      "0/3 nodes are available: 3 node(s) had untolerated taint {dedicated: gpu}. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.",
      ["taint", "toleration", "tolerat"]
    ],
    [
      "sched-pvc-unbound",
      "PVC is not bound",
      "db-0",
      "data",
      "500m",
      "2Gi",
      "0/4 nodes are available: pod has unbound immediate PersistentVolumeClaims. preemption: 0/4 nodes are available: 4 Preemption is not helpful for scheduling.",
      ["pvc", "persistentvolumeclaim", "unbound", "storageclass"]
    ],
    [
      "sched-node-selector",
      "Node selector matches no node",
      "ingest-6e5d4c3b2-c1d2e",
      "pipeline",
      "250m",
      "512Mi",
      "0/4 nodes are available: 4 node(s) didn't match Pod's node affinity/selector. preemption: 0/4 nodes are available: 4 Preemption is not helpful for scheduling.",
      ["nodeselector", "node selector", "affinity", "didn't match"]
    ]
  ].map(([id, title, name, ns, cpu, mem, msg, cause]) => ({
    id: id as string,
    title: title as string,
    input: pod({
      name: name as string,
      ns: ns as string,
      status: "Pending",
      state: "Waiting",
      reason: "ContainerCreating",
      cpuRequest: cpu as string,
      memRequest: mem as string,
      rows: [
        [
          "Warning",
          "FailedScheduling",
          "2m (x9 over 11m)",
          "default-scheduler",
          msg as string
        ]
      ]
    }),
    expected: { category: ["FailedScheduling"], cause: cause as string[] }
  })),

  // ---- Evicted, mount, probe, node (5) ----
  {
    id: "evicted-disk",
    title: "Pod evicted for ephemeral storage",
    input:
      [
        "Name:             uploader-5d4c3b2a1-f7g8h",
        "Namespace:        media",
        "Node:             worker-5",
        "Status:           Failed",
        "Reason:           Evicted",
        "Message:          The node was low on resource: ephemeral-storage. Container app was using 9318Mi, which exceeds its request of 0.",
        events([
          [
            "Warning",
            "Evicted",
            "5m",
            "kubelet",
            "The node was low on resource: ephemeral-storage. Container app was using 9318Mi, which exceeds its request of 0."
          ]
        ])
      ].join("\n") + "\n",
    expected: {
      category: ["Evicted"],
      cause: ["ephemeral", "storage", "disk"]
    }
  },
  {
    id: "mount-multi-attach",
    title: "Volume still attached to another node",
    input: pod({
      name: "wordpress-6c5b4a3d2-j3k4l",
      ns: "web",
      node: "worker-2",
      status: "Pending",
      state: "Waiting",
      reason: "ContainerCreating",
      rows: [
        [
          "Warning",
          "FailedAttachVolume",
          "3m",
          "attachdetach-controller",
          'Multi-Attach error for volume "pvc-8f2a1b3c" Volume is already exclusively attached to one node and can\'t be attached to another'
        ]
      ]
    }),
    expected: {
      category: ["FailedMount"],
      cause: [
        "multi-attach",
        "exclusively attached",
        "another node",
        "rwo",
        "readwriteonce"
      ]
    }
  },
  {
    id: "probe-readiness",
    title: "Readiness probe cannot connect",
    input: pod({
      name: "frontend-7a6b5c4d3-l5m6n",
      ns: "web",
      node: "worker-3",
      status: "Running",
      state: "Running",
      ready: false,
      rows: [
        [
          "Warning",
          "Unhealthy",
          "40s (x22 over 4m)",
          "kubelet",
          'Readiness probe failed: Get "http://10.0.2.5:3000/healthz": dial tcp 10.0.2.5:3000: connect: connection refused'
        ]
      ],
      logs: "INFO server listening on :8080"
    }),
    expected: {
      category: ["ProbeFailed"],
      cause: ["port", "3000", "8080"]
    }
  },
  {
    id: "node-notready",
    title: "Node stopped posting status",
    input: node(
      "worker-7",
      "Unknown",
      "NodeStatusUnknown           Kubelet stopped posting node status."
    ),
    expected: {
      category: ["NodeNotReady"],
      cause: [
        "kubelet",
        "stopped posting",
        "unreachable",
        "not ready",
        "status unknown"
      ]
    }
  },
  {
    id: "node-disk-pressure",
    title: "Node under disk pressure",
    input: node(
      "worker-8",
      "False  ",
      "KubeletNotReady            PLEG is not healthy",
      "kubelet has disk pressure"
    ),
    expected: {
      category: ["NodeNotReady"],
      cause: ["disk", "pleg"]
    }
  },

  // ---- Config errors (2) ----
  ...[
    [
      "config-missing-secret",
      "Referenced secret does not exist",
      "payments-api-7d9f8b6c5-x2k4p",
      "payments",
      'secret "payments-db" not found',
      ["secret", "not found", "missing"]
    ],
    [
      "config-missing-configmap",
      "Referenced ConfigMap does not exist",
      "mailer-6c5d4e3f2-s4t5u",
      "comms",
      'configmap "mailer-config" not found',
      ["configmap", "not found", "missing"]
    ]
  ].map(([id, title, name, ns, msg, cause]) => ({
    id: id as string,
    title: title as string,
    input: pod({
      name: name as string,
      ns: ns as string,
      node: "worker-1",
      status: "Pending",
      state: "Waiting",
      reason: "CreateContainerConfigError",
      rows: [
        ["Warning", "Failed", "1m (x8 over 3m)", "kubelet", `Error: ${msg}`]
      ]
    }),
    expected: { category: ["ConfigError"], cause: cause as string[] }
  })),

  // ---- Services, DNS, RBAC (3) ----
  {
    id: "svc-no-endpoints",
    title: "Service selector matches no pods",
    input:
      [
        "$ kubectl get endpoints web -n shop",
        "NAME   ENDPOINTS   AGE",
        "web    <none>      3d",
        "",
        "$ kubectl describe svc web -n shop",
        "Name:              web",
        "Namespace:         shop",
        "Selector:          app=web",
        "Port:              http  80/TCP",
        "TargetPort:        8080/TCP",
        "Endpoints:         <none>",
        "",
        "$ kubectl get pods -n shop --show-labels",
        "NAME                   READY   STATUS    RESTARTS   AGE   LABELS",
        "webapp-6c5b4a3d2-a1b2c   1/1     Running   0          3d    app=webapp,pod-template-hash=6c5b4a3d2"
      ].join("\n") + "\n",
    expected: {
      category: ["ServiceNoEndpoints"],
      cause: ["selector", "label mismatch", "webapp", "app=web"]
    }
  },
  {
    id: "dns-no-such-host",
    title: "In-cluster DNS lookup fails",
    input:
      [
        '2026-11-19T11:02:44Z ERROR upstream call failed: Get "http://payments-db.payments.svc.cluster.local:5432": dial tcp: lookup payments-db.payments.svc.cluster.local on 10.96.0.10:53: no such host',
        "2026-11-19T11:02:45Z ERROR upstream call failed: dial tcp: lookup payments-db.payments.svc.cluster.local on 10.96.0.10:53: no such host"
      ].join("\n") + "\n",
    expected: {
      category: ["Other"],
      cause: ["dns", "coredns", "no such host", "resolve"]
    }
  },
  {
    id: "rbac-forbidden",
    title: "ServiceAccount lacks RBAC permission",
    input:
      'E1119 11:14:02.123456       1 reflector.go:138] failed to list *v1.Pod: pods is forbidden: User "system:serviceaccount:ops:runner" cannot list resource "pods" in API group "" in namespace "payments"\n',
    expected: {
      category: ["Other"],
      cause: ["rbac", "rolebinding", "clusterrole", "serviceaccount"]
    }
  }
];
