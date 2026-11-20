# Evaluation results

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Run: 2026-11-20. 28 labelled scenarios, 0 errored.

| Metric                                      | Result        |
| ------------------------------------------- | ------------- |
| Correct category                            | 25/28 (89%)   |
| Correct cause is the top hypothesis         | 23/28 (82%)   |
| Correct cause is in the top 3               | 26/28 (93%)   |
| Confirm commands that are read-only         | 110/112 (98%) |
| Hypotheses stating a fact not in the input  | 0/112 (0%)    |
| Scenarios with at least one such hypothesis | 0/28 (0%)     |

## Per scenario

| Scenario                 | Category             | Correct cause rank | Grounded | Top hypothesis                                            |
| ------------------------ | -------------------- | ------------------ | -------- | --------------------------------------------------------- |
| crash-db-refused         | ✓                    | #2                 | ✓        | Application error on startup                              |
| crash-missing-env        | ✓                    | #1                 | ✓        | Missing environment variable                              |
| crash-bad-entrypoint     | ✓                    | #1                 | ✓        | Application error on startup                              |
| crash-exec-format        | ✓                    | #1                 | ✓        | Application error on startup                              |
| crash-nil-panic          | ✓                    | ✗                  | ✓        | Application error on startup                              |
| crash-liveness           | ✗ OOMKilled          | ✗                  | ✓        | Memory limit set too low                                  |
| crash-permission-denied  | ✓                    | #1                 | ✓        | Insufficient permissions to access /data/cache.db         |
| crash-bad-config         | ✓                    | #1                 | ✓        | Application error on startup                              |
| oom-limit-low            | ✓                    | #1                 | ✓        | Insufficient memory limit                                 |
| oom-java-heap            | ✓                    | #1                 | ✓        | Insufficient memory limit                                 |
| oom-batch-job            | ✓                    | #1                 | ✓        | Insufficient memory limit                                 |
| pull-not-found           | ✓                    | #1                 | ✓        | Typo in image name or tag                                 |
| pull-unauthorized        | ✓                    | #1                 | ✓        | Private registry without imagePullSecrets                 |
| pull-rate-limit          | ✓                    | #1                 | ✓        | Rate limit error due to excessive pulls                   |
| sched-insufficient-cpu   | ✓                    | #1                 | ✓        | Insufficient CPU resources on nodes                       |
| sched-taint              | ✓                    | #1                 | ✓        | Node taints without matching tolerations                  |
| sched-pvc-unbound        | ✓                    | #2                 | ✓        | Insufficient CPU or memory on nodes                       |
| sched-node-selector      | ✓                    | #2                 | ✓        | Insufficient CPU or memory on nodes                       |
| evicted-disk             | ✓                    | #1                 | ✓        | Low ephemeral storage on node worker-5                    |
| mount-multi-attach       | ✓                    | #1                 | ✓        | Volume still attached to another node                     |
| probe-readiness          | ✓                    | #1                 | ✓        | Probe path or port wrong                                  |
| node-notready            | ✓                    | #1                 | ✓        | Kubelet Crash or API Server Inaccessibility               |
| node-disk-pressure       | ✓                    | #1                 | ✓        | Node out of disk space                                    |
| config-missing-secret    | ✓                    | #1                 | ✓        | Missing Secret                                            |
| config-missing-configmap | ✓                    | #1                 | ✓        | ConfigMap mailer-config does not exist in comms namespace |
| svc-no-endpoints         | ✓                    | #1                 | ✓        | Service selector does not match pod labels                |
| dns-no-such-host         | ✗ ServiceNoEndpoints | #1                 | ✓        | Service selector does not match any pod labels            |
| rbac-forbidden           | ✗ ConfigError        | #1                 | ✓        | Missing or Insufficient RoleBinding                       |
