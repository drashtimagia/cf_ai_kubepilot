import { describe, expect, it } from "vitest";
import { alertToEvidence } from "./alerts";
import { fixture } from "./fixtures";
import { parseK8sOutput } from "./k8s-parse";
import { deploymentName, fillPlaceholders, primaryPod } from "./placeholders";

const crash = parseK8sOutput(fixture("crashloop-describe"));

describe("fillPlaceholders", () => {
  it("fills namespace, pod, node and container from the evidence", () => {
    expect(
      fillPlaceholders(
        "kubectl logs <pod> -c <container> -n <ns> --previous",
        crash
      )
    ).toBe(
      "kubectl logs payments-api-7d9f8b6c5-x2k4p -c api -n payments --previous"
    );
    expect(fillPlaceholders("kubectl describe node <node>", crash)).toBe(
      "kubectl describe node ip-10-0-3-41.eu-west-1.compute.internal"
    );
  });

  it("fills the Deployment name from the pod name", () => {
    expect(
      fillPlaceholders("kubectl rollout undo deployment/<name> -n <ns>", crash)
    ).toBe("kubectl rollout undo deployment/payments-api -n payments");
  });

  it("leaves a placeholder alone when the evidence does not say", () => {
    const none = parseK8sOutput("my pod is sad");
    expect(fillPlaceholders("kubectl get pods -n <ns>", none)).toBe(
      "kubectl get pods -n <ns>"
    );
    expect(fillPlaceholders("kubectl get pods -n <ns>", none, "jobs")).toBe(
      "kubectl get pods -n jobs"
    );
  });

  it("does not guess a node for a pod that was never scheduled", () => {
    const pending = parseK8sOutput(fixture("pending-describe"));
    expect(fillPlaceholders("kubectl describe node <node>", pending)).toBe(
      "kubectl describe node <node>"
    );
  });
});

describe("alerts", () => {
  const alert = parseK8sOutput(
    alertToEvidence({
      status: "firing",
      labels: {
        alertname: "KubePodCrashLooping",
        namespace: "payments",
        pod: "payments-api-7d9f8b6c5-x2k4p",
        container: "api"
      },
      annotations: {
        summary: "Pod payments/payments-api-7d9f8b6c5-x2k4p is crash looping"
      }
    })
  );

  it("reads the pod, namespace and container from alert labels", () => {
    expect(alert.kind).toBe("alert");
    expect(alert.pods[0]).toMatchObject({
      name: "payments-api-7d9f8b6c5-x2k4p",
      namespace: "payments",
      containers: [{ name: "api" }]
    });
    expect(
      fillPlaceholders("kubectl logs <pod> -c <container> -n <ns>", alert)
    ).toBe("kubectl logs payments-api-7d9f8b6c5-x2k4p -c api -n payments");
  });

  it("turns the invalid namespace/pod form into a plain pod name", () => {
    expect(
      fillPlaceholders(
        "kubectl logs payments/payments-api-7d9f8b6c5-x2k4p -n payments --previous",
        alert
      )
    ).toBe("kubectl logs payments-api-7d9f8b6c5-x2k4p -n payments --previous");
  });
});

describe("primaryPod", () => {
  it("picks the unhealthy pod from get pods -A, not the first row", () => {
    const facts = parseK8sOutput(
      "NAMESPACE  NAME                        READY   STATUS    RESTARTS   AGE\n" +
        "kube-system   coredns-76f75df574-9xk2c   1/1     Running   0          31d\n" +
        "shop       checkout-5c8d6f7b9d-m7q2w   0/1     CrashLoopBackOff   9 (1m ago)   2d\n"
    );
    expect(primaryPod(facts)?.name).toBe("checkout-5c8d6f7b9d-m7q2w");
  });
});

describe("deploymentName", () => {
  it("strips the ReplicaSet hash and pod suffix", () => {
    expect(deploymentName("payments-api-7d9f8b6c5-x2k4p")).toBe("payments-api");
    expect(deploymentName("db-0")).toBe("db-0");
  });
});
