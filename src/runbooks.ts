/** A command with a flag saying whether it changes the cluster. */
export interface RunbookCommand {
  description: string;
  command: string;
  readOnly: boolean;
}

export interface Runbook {
  /** Matches the signal names produced by parseK8sOutput. */
  id: string;
  title: string;
  causes: string[];
  checks: RunbookCommand[];
  fixes: RunbookCommand[];
}

const ro = (description: string, command: string): RunbookCommand => ({
  description,
  command,
  readOnly: true
});
const rw = (description: string, command: string): RunbookCommand => ({
  description,
  command,
  readOnly: false
});

export const RUNBOOKS: Runbook[] = [
  {
    id: "CrashLoopBackOff",
    title:
      "CrashLoopBackOff: container starts, exits, and is restarted with backoff",
    causes: [
      "Application error on startup (bad config, missing env var or secret, unreachable dependency)",
      "Wrong command or args in the pod spec",
      "Failing liveness probe killing a healthy-but-slow container",
      "OOMKilled (see the OOMKilled runbook)"
    ],
    checks: [
      ro(
        "Logs from the previous (crashed) run",
        "kubectl logs <pod> -n <ns> --previous"
      ),
      ro(
        "Exit code, last state and events",
        "kubectl describe pod <pod> -n <ns>"
      ),
      ro(
        "Recent events in the namespace",
        "kubectl get events -n <ns> --sort-by=.lastTimestamp"
      )
    ],
    fixes: [
      rw(
        "Fix the config or secret the logs point to, then restart",
        "kubectl rollout restart deployment/<name> -n <ns>"
      ),
      rw(
        "Roll back a bad release",
        "kubectl rollout undo deployment/<name> -n <ns>"
      )
    ]
  },
  {
    id: "OOMKilled",
    title: "OOMKilled: container exceeded its memory limit (exit code 137)",
    causes: [
      "Memory limit set lower than the real working set",
      "Memory leak or unbounded cache",
      "Traffic spike or large request batch",
      "JVM or runtime heap sized larger than the container limit"
    ],
    checks: [
      ro(
        "Confirm reason and current limit",
        "kubectl describe pod <pod> -n <ns>"
      ),
      ro(
        "Live memory use per container",
        "kubectl top pod <pod> -n <ns> --containers"
      ),
      ro("Previous run logs", "kubectl logs <pod> -n <ns> --previous")
    ],
    fixes: [
      rw(
        "Raise the memory limit",
        "kubectl set resources deployment/<name> -n <ns> --limits=memory=<new>"
      ),
      rw(
        "Restart after fixing the leak or config",
        "kubectl rollout restart deployment/<name> -n <ns>"
      )
    ]
  },
  {
    id: "ImagePullBackOff",
    title: "ImagePullBackOff / ErrImagePull: kubelet cannot pull the image",
    causes: [
      "Tag or repository does not exist (typo, unpushed image)",
      "Private registry without imagePullSecrets, or an expired credential",
      "Registry unreachable from the node (network, rate limit)"
    ],
    checks: [
      ro("Exact pull error in events", "kubectl describe pod <pod> -n <ns>"),
      ro(
        "Image reference in the spec",
        "kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.containers[*].image}'"
      ),
      ro(
        "Pull secrets on the service account",
        "kubectl get serviceaccount <sa> -n <ns> -o yaml"
      )
    ],
    fixes: [
      rw(
        "Point the workload at a valid tag",
        "kubectl set image deployment/<name> <container>=<image:tag> -n <ns>"
      ),
      rw(
        "Create or refresh the registry secret",
        "kubectl create secret docker-registry <name> --docker-server=<host> --docker-username=<u> --docker-password=<p> -n <ns>"
      )
    ]
  },
  {
    id: "FailedScheduling",
    title: "Pending / FailedScheduling: scheduler cannot place the pod",
    causes: [
      "Not enough CPU or memory on any node for the requests",
      "Node taints without matching tolerations",
      "nodeSelector or affinity matching no node",
      "PersistentVolumeClaim not bound or in another zone"
    ],
    checks: [
      ro(
        "Scheduler message with the per-reason node counts",
        "kubectl describe pod <pod> -n <ns>"
      ),
      ro("Node capacity and allocations", "kubectl describe nodes"),
      ro(
        "Taints per node",
        "kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints"
      ),
      ro("PVC status", "kubectl get pvc -n <ns>")
    ],
    fixes: [
      rw(
        "Lower the pod's requests, or add node capacity",
        "kubectl set resources deployment/<name> -n <ns> --requests=cpu=<c>,memory=<m>"
      ),
      rw(
        "Add a toleration or fix the selector in the manifest",
        "kubectl edit deployment/<name> -n <ns>"
      )
    ]
  },
  {
    id: "Evicted",
    title: "Evicted: kubelet removed the pod under node resource pressure",
    causes: [
      "Node memory, disk or PID pressure",
      "Pod using more ephemeral storage than expected",
      "Low QoS class (BestEffort/Burstable) evicted first"
    ],
    checks: [
      ro("Eviction reason and message", "kubectl describe pod <pod> -n <ns>"),
      ro("Node pressure conditions", "kubectl describe node <node>"),
      ro(
        "Evicted pods in the namespace",
        "kubectl get pods -n <ns> --field-selector=status.phase=Failed"
      )
    ],
    fixes: [
      rw(
        "Clean up evicted pod records",
        "kubectl delete pods -n <ns> --field-selector=status.phase=Failed"
      ),
      rw(
        "Set requests equal to limits for critical workloads",
        "kubectl edit deployment/<name> -n <ns>"
      )
    ]
  },
  {
    id: "ConfigError",
    title:
      "CreateContainerConfigError: referenced ConfigMap or Secret is missing or invalid",
    causes: [
      "ConfigMap or Secret does not exist in the namespace",
      "Key referenced by env or volume is absent",
      "Invalid securityContext or runAsNonRoot with a root image"
    ],
    checks: [
      ro(
        "Error message naming the missing object",
        "kubectl describe pod <pod> -n <ns>"
      ),
      ro("List ConfigMaps", "kubectl get configmap -n <ns>"),
      ro("List Secrets (names only)", "kubectl get secret -n <ns>")
    ],
    fixes: [
      rw(
        "Create the missing object, then the pod will start on its next retry",
        "kubectl apply -f <manifest>.yaml -n <ns>"
      )
    ]
  },
  {
    id: "ProbeFailed",
    title: "Probe failures: readiness or liveness checks failing",
    causes: [
      "Probe path or port wrong",
      "App slower to start than initialDelaySeconds or the startup probe allows",
      "Dependency down making the health endpoint fail",
      "Timeout too tight under load"
    ],
    checks: [
      ro(
        "Probe definition and failure events",
        "kubectl describe pod <pod> -n <ns>"
      ),
      ro(
        "Does the endpoint respond from inside the pod",
        "kubectl exec <pod> -n <ns> -- wget -qO- http://localhost:<port><path>"
      ),
      ro("App logs around the probe times", "kubectl logs <pod> -n <ns>")
    ],
    fixes: [
      rw(
        "Add a startupProbe or raise initialDelaySeconds/timeoutSeconds",
        "kubectl edit deployment/<name> -n <ns>"
      )
    ]
  },
  {
    id: "FailedMount",
    title: "FailedMount / FailedAttachVolume: volume cannot be mounted",
    causes: [
      "PVC not bound or storage class missing",
      "Volume still attached to another node (multi-attach error)",
      "Missing Secret or ConfigMap used as a volume",
      "CSI driver unhealthy"
    ],
    checks: [
      ro("Mount error in events", "kubectl describe pod <pod> -n <ns>"),
      ro("PVC and PV state", "kubectl get pvc,pv -n <ns>"),
      ro("CSI driver pods", "kubectl get pods -n kube-system | grep -i csi")
    ],
    fixes: [
      rw(
        "Fix or recreate the claim, or delete the stuck old pod so the volume detaches",
        "kubectl delete pod <old-pod> -n <ns>"
      )
    ]
  },
  {
    id: "NodeNotReady",
    title: "NodeNotReady: node stopped reporting healthy",
    causes: [
      "Kubelet crashed or cannot reach the API server",
      "Node out of memory, disk or PIDs",
      "Network partition or CNI failure on the node",
      "Instance stopped or rebooting"
    ],
    checks: [
      ro("Node conditions and recent events", "kubectl describe node <node>"),
      ro("Node list with status", "kubectl get nodes -o wide"),
      ro(
        "Pods on that node",
        "kubectl get pods -A --field-selector spec.nodeName=<node>"
      )
    ],
    fixes: [
      rw(
        "Stop new pods landing on it while you investigate",
        "kubectl cordon <node>"
      ),
      rw(
        "Move workloads off before maintenance",
        "kubectl drain <node> --ignore-daemonsets --delete-emptydir-data"
      )
    ]
  },
  {
    id: "ServiceNoEndpoints",
    title: "Service has no endpoints: traffic has nowhere to go",
    causes: [
      "Service selector does not match any pod labels",
      "Matching pods are not Ready (failing readiness probe)",
      "targetPort differs from the container port"
    ],
    checks: [
      ro("Endpoints behind the service", "kubectl get endpoints <svc> -n <ns>"),
      ro("Service selector and ports", "kubectl describe svc <svc> -n <ns>"),
      ro(
        "Pods matching the selector",
        "kubectl get pods -n <ns> -l <key>=<value> --show-labels"
      )
    ],
    fixes: [
      rw(
        "Correct the selector or port in the Service",
        "kubectl edit svc <svc> -n <ns>"
      )
    ]
  }
];

/**
 * Finds a runbook by signal id first, then by keyword in title and causes.
 * Returns undefined when nothing matches, so callers never invent guidance.
 */
export function lookupRunbook(query: string): Runbook | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exact = RUNBOOKS.find((r) => r.id.toLowerCase() === q);
  if (exact) return exact;

  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: { runbook: Runbook; score: number } | undefined;
  for (const runbook of RUNBOOKS) {
    const haystack =
      `${runbook.id} ${runbook.title} ${runbook.causes.join(" ")}`.toLowerCase();
    const score = words.filter((w) => haystack.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { runbook, score };
  }
  return best?.runbook;
}
