/**
 * Realistic kubectl output used by the parser tests and, later, the demo
 * sample buttons. Keep them verbatim-looking: the parser must cope with the
 * real column layout.
 */
export interface Fixture {
  id: string;
  title: string;
  text: string;
}

const crashLoop = `Name:             payments-api-7d9f8b6c5-x2k4p
Namespace:        payments
Priority:         0
Service Account:  default
Node:             ip-10-0-3-41.eu-west-1.compute.internal/10.0.3.41
Start Time:       Wed, 19 Nov 2026 09:12:04 +0000
Labels:           app=payments-api
                  pod-template-hash=7d9f8b6c5
Status:           Running
IP:               10.0.3.88
Controlled By:    ReplicaSet/payments-api-7d9f8b6c5
Containers:
  api:
    Container ID:   containerd://3f1c0a
    Image:          registry.example.com/payments-api:2.14.0
    Port:           8080/TCP
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Wed, 19 Nov 2026 09:20:11 +0000
      Finished:     Wed, 19 Nov 2026 09:20:12 +0000
    Ready:          False
    Restart Count:  7
    Limits:
      memory:  512Mi
    Requests:
      cpu:     100m
      memory:  256Mi
    Environment:
      DATABASE_URL:  <set to the key 'url' in secret 'payments-db'>  Optional: false
Conditions:
  Type                        Status
  Ready                       False
  ContainersReady             False
Events:
  Type     Reason     Age                   From               Message
  ----     ------     ----                  ----               -------
  Normal   Scheduled  14m                   default-scheduler  Successfully assigned payments/payments-api-7d9f8b6c5-x2k4p to ip-10-0-3-41
  Normal   Pulled     12m (x5 over 14m)     kubelet            Container image "registry.example.com/payments-api:2.14.0" already present on machine
  Warning  BackOff    4m (x38 over 14m)     kubelet            Back-off restarting failed container api in pod payments-api-7d9f8b6c5-x2k4p_payments
`;

const oomKilled = `Name:             checkout-5c8d6f7b9d-m7q2w
Namespace:        shop
Node:             worker-2/192.168.10.12
Status:           Running
Controlled By:    ReplicaSet/checkout-5c8d6f7b9d
Containers:
  checkout:
    Image:          registry.example.com/checkout:1.9.3
    State:          Running
      Started:      Wed, 19 Nov 2026 10:02:41 +0000
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Wed, 19 Nov 2026 09:41:07 +0000
      Finished:     Wed, 19 Nov 2026 10:02:39 +0000
    Ready:          True
    Restart Count:  4
    Limits:
      memory:  256Mi
    Requests:
      cpu:        200m
      memory:     128Mi
Events:
  Type     Reason   Age                From     Message
  ----     ------   ----               ----     -------
  Warning  BackOff  3m (x6 over 21m)   kubelet  Back-off restarting failed container checkout in pod checkout-5c8d6f7b9d-m7q2w_shop
`;

const imagePull = `Name:             reports-6b7f9c4d58-h9z4t
Namespace:        analytics
Node:             worker-1/192.168.10.11
Status:           Pending
Containers:
  reports:
    Image:          registry.example.com/reports:v3.0.0-rc1
    State:          Waiting
      Reason:       ImagePullBackOff
    Ready:          False
    Restart Count:  0
Events:
  Type     Reason     Age                 From               Message
  ----     ------     ----                ----               -------
  Normal   Scheduled  6m                  default-scheduler  Successfully assigned analytics/reports-6b7f9c4d58-h9z4t to worker-1
  Normal   Pulling    4m (x4 over 6m)     kubelet            Pulling image "registry.example.com/reports:v3.0.0-rc1"
  Warning  Failed     4m (x4 over 6m)     kubelet            Failed to pull image "registry.example.com/reports:v3.0.0-rc1": rpc error: code = NotFound desc = failed to pull and unpack image: not found
  Warning  Failed     4m (x4 over 6m)     kubelet            Error: ErrImagePull
  Normal   BackOff    78s (x12 over 6m)   kubelet            Back-off pulling image "registry.example.com/reports:v3.0.0-rc1"
  Warning  Failed     78s (x12 over 6m)   kubelet            Error: ImagePullBackOff
`;

const pendingScheduling = `Name:             batch-worker-84f6d9c7b6-t5r8k
Namespace:        jobs
Status:           Pending
Node:             <none>
Containers:
  worker:
    Image:      registry.example.com/batch-worker:5.2.1
    State:      Waiting
      Reason:   ContainerCreating
    Ready:      False
    Restart Count:  0
    Requests:
      cpu:     16
      memory:  8Gi
Events:
  Type     Reason            Age                From               Message
  ----     ------            ----               ----               -------
  Warning  FailedScheduling  2m (x9 over 11m)   default-scheduler  0/5 nodes are available: 3 Insufficient cpu, 2 node(s) had untolerated taint {dedicated: gpu}. preemption: 0/5 nodes are available: 5 No preemption victims found for incoming pod.
`;

const getPods = `NAMESPACE     NAME                              READY   STATUS             RESTARTS        AGE
payments      payments-api-7d9f8b6c5-x2k4p     0/1     CrashLoopBackOff   7 (4m ago)      14m
payments      payments-api-7d9f8b6c5-b8w6n     1/1     Running            0               14m
shop          checkout-5c8d6f7b9d-m7q2w         1/1     Running            4 (21m ago)     2d
analytics     reports-6b7f9c4d58-h9z4t          0/1     ImagePullBackOff   0               6m
kube-system   coredns-76f75df574-9xk2c          1/1     Running            0               31d
`;

const crashLogs = `2026-11-19T09:20:11.482Z INFO  starting payments-api version=2.14.0
2026-11-19T09:20:11.490Z INFO  loading config from /etc/payments/config.yaml
2026-11-19T09:20:11.731Z ERROR failed to connect to database: dial tcp 10.96.14.7:5432: connect: connection refused
2026-11-19T09:20:11.731Z FATAL cannot start without database, exiting
panic: database unavailable

goroutine 1 [running]:
main.main()
	/app/cmd/api/main.go:42 +0x1a5
`;

export const FIXTURES: Fixture[] = [
  {
    id: "crashloop-describe",
    title: "CrashLoopBackOff (describe pod)",
    text: crashLoop
  },
  {
    id: "oomkilled-describe",
    title: "OOMKilled (describe pod)",
    text: oomKilled
  },
  {
    id: "imagepull-describe",
    title: "ImagePullBackOff (describe pod)",
    text: imagePull
  },
  {
    id: "pending-describe",
    title: "Pending: FailedScheduling (describe pod)",
    text: pendingScheduling
  },
  { id: "get-pods", title: "Mixed pod health (get pods -A)", text: getPods },
  { id: "crash-logs", title: "App crash (logs)", text: crashLogs }
];

export const fixture = (id: string): string => {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture ${id}`);
  return f.text;
};
