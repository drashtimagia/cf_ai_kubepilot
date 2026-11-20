# Evaluation results

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Run: 2026-11-20. 28 labelled scenarios, 0 errored.

| Metric                                      | Result        |
| ------------------------------------------- | ------------- |
| Correct category                            | 26/28 (93%)   |
| Correct cause is the top hypothesis         | 21/28 (75%)   |
| Correct cause is in the top 3               | 26/28 (93%)   |
| Confirm commands that are read-only         | 110/111 (99%) |
| Hypotheses stating a fact not in the input  | 0/111 (0%)    |
| Scenarios with at least one such hypothesis | 0/28 (0%)     |

## Per scenario

| Scenario                 | Category             | Correct cause rank | Grounded | Top hypothesis                                          |
| ------------------------ | -------------------- | ------------------ | -------- | ------------------------------------------------------- |
| crash-db-refused         | ✓                    | #2                 | ✓        | Application error on startup                            |
| crash-missing-env        | ✓                    | #1                 | ✓        | Missing environment variable                            |
| crash-bad-entrypoint     | ✓                    | ✗                  | ✓        | Application error on startup                            |
| crash-exec-format        | ✓                    | #1                 | ✓        | Application error on startup                            |
| crash-nil-panic          | ✓                    | ✗                  | ✓        | Application error on startup                            |
| crash-liveness           | ✓                    | #2                 | ✓        | Application error on startup                            |
| crash-permission-denied  | ✓                    | #1                 | ✓        | Application error on startup due to missing permissions |
| crash-bad-config         | ✓                    | #1                 | ✓        | Application error on startup                            |
| oom-limit-low            | ✓                    | #1                 | ✓        | Memory limit set lower than the real working set        |
| oom-java-heap            | ✓                    | #2                 | ✓        | Insufficient memory limit                               |
| oom-batch-job            | ✓                    | #1                 | ✓        | Memory limit set lower than the real working set        |
| pull-not-found           | ✓                    | #2                 | ✓        | Private registry without imagePullSecrets               |
| pull-unauthorized        | ✓                    | #1                 | ✓        | Private registry without imagePullSecrets               |
| pull-rate-limit          | ✓                    | #1                 | ✓        | Rate limit error due to excessive pulls                 |
| sched-insufficient-cpu   | ✓                    | #1                 | ✓        | Insufficient CPU resources on available nodes           |
| sched-taint              | ✓                    | #1                 | ✓        | Node taints without matching tolerations                |
| sched-pvc-unbound        | ✓                    | #2                 | ✓        | Insufficient CPU or memory on nodes                     |
| sched-node-selector      | ✓                    | #1                 | ✓        | Node affinity or selector mismatch                      |
| evicted-disk             | ✓                    | #1                 | ✓        | Low ephemeral storage on node                           |
| mount-multi-attach       | ✓                    | #1                 | ✓        | Volume still attached to another node                   |
| probe-readiness          | ✓                    | #1                 | ✓        | Probe path or port wrong                                |
| node-notready            | ✓                    | #1                 | ✓        | Kubelet crashed or cannot reach the API server          |
| node-disk-pressure       | ✓                    | #1                 | ✓        | Disk pressure causing node unavailability               |
| config-missing-secret    | ✓                    | #1                 | ✓        | Missing Secret                                          |
| config-missing-configmap | ✓                    | #1                 | ✓        | ConfigMap does not exist in the namespace               |
| svc-no-endpoints         | ✓                    | #1                 | ✓        | Service selector does not match any pod labels          |
| dns-no-such-host         | ✗ ServiceNoEndpoints | #1                 | ✓        | Service selector does not match any pod labels          |
| rbac-forbidden           | ✗ ConfigError        | #1                 | ✓        | Missing or Insufficient RoleBinding                     |
