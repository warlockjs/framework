import { describe, expect, it } from "vitest";
import { feature, flow, proof, snapshot } from "../../../tests/check/snapshot-builder";
import type { GrimoireSnapshot, ProofLine } from "../../contracts";
import { checkCriteriaTests, checkProofTargets } from "./criteria";

function criteriaSnapshot(
  proofs: ProofLine[],
  status: "shipped" | "retired" = "shipped",
): GrimoireSnapshot {
  const target = snapshot({ proofs });

  target.written.features = [
    feature("shop", {
      flows: [flow("shop", "order", { status, criteria: ["AC-1", ["AC-2", "web"]] })],
    }),
  ];

  return target;
}

describe("checkCriteriaTests", () => {
  it("reports nothing when every criterion has a proof", () => {
    expect(
      checkCriteriaTests(
        criteriaSnapshot([proof("shop/order", "AC-1"), proof("shop/order", "AC-2")]),
      ),
    ).toEqual([]);
  });

  it("GR4001: a criterion with no test; retired flows are left out", () => {
    const findings = checkCriteriaTests(criteriaSnapshot([proof("shop/order", "AC-1")]));

    expect(
      findings.map(
        (finding) => `${finding.code} ${finding.severity} ${finding.at?.line} ${finding.message}`,
      ),
    ).toEqual(["GR4001 warning 31 shop/order AC-2 has no test"]);
    expect(findings[0]?.subject).toMatchObject({ feature: "shop", flow: "shop/order" });
    expect(checkCriteriaTests(criteriaSnapshot([], "retired"))).toEqual([]);
  });
});

describe("checkProofTargets", () => {
  it("reports nothing when every proof names an existing criterion", () => {
    expect(checkProofTargets(criteriaSnapshot([proof("shop/order", "AC-2")]))).toEqual([]);
  });

  it("GR4002: a proof naming no flow, or no criterion of its flow", () => {
    const findings = checkProofTargets(
      criteriaSnapshot([
        proof("shop/refund", "AC-1"),
        proof("shop/order", "AC-9", "e2e/order.e2e.ts", 7),
      ]),
    );

    expect(
      findings.map(
        (finding) => `${finding.code} ${finding.at?.file}:${finding.at?.line} ${finding.message}`,
      ),
    ).toEqual([
      'GR4002 src/app/x/tests/x.test.ts:3 "@proves shop/refund AC-1" names no flow shop/refund',
      'GR4002 e2e/order.e2e.ts:7 "@proves shop/order AC-9" names no AC-9 in shop/order',
    ]);
  });
});
