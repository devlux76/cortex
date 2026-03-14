/**
 * EligibilityClassifier tests (P2-G4)
 *
 * Tests that blocked nodes are never exported, and eligible nodes pass through.
 */

import { describe, expect, it } from "vitest";

import type { Page } from "../../core/types";
import {
  classifyPage,
  classifyPages,
  filterEligible,
} from "../../sharing/EligibilityClassifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_STR = "2026-03-13T00:00:00.000Z";

function makePage(pageId: string, content: string): Page {
  return {
    pageId,
    content,
    embeddingOffset: 0,
    embeddingDim: 4,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "pk",
    signature: "sig",
    createdAt: NOW_STR,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EligibilityClassifier — eligible content", () => {
  it("classifies clean public-interest text as eligible", () => {
    const page = makePage("p1", "The history of quantum computing began in the 1980s with Feynman.");
    const result = classifyPage(page);
    expect(result.status).toBe("eligible");
    expect(result.reason).toBeUndefined();
  });

  it("classifies long prose text without PII as eligible", () => {
    const page = makePage("p2",
      "Label propagation is a semi-supervised machine learning algorithm that assigns labels " +
      "to previously unlabeled data points by propagating labels through the graph structure.");
    const result = classifyPage(page);
    expect(result.status).toBe("eligible");
  });
});

describe("EligibilityClassifier — blocked content", () => {
  it("blocks very short content as no_public_interest", () => {
    const page = makePage("p3", "hi");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("no_public_interest");
  });

  it("blocks content containing a password assignment", () => {
    const page = makePage("p4", "My database password: s3cr3tP@ss! Please don't share this string with anyone.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_credentials");
  });

  it("blocks content containing an API key assignment", () => {
    const page = makePage("p5", "Set api_key=sk-1234abcdef in your .env file to authenticate requests.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_credentials");
  });

  it("blocks content containing a Bearer token", () => {
    const page = makePage("p6", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_credentials");
  });

  it("blocks content containing a Visa credit card number", () => {
    const page = makePage("p7", "Please charge card 4111111111111111 for the purchase of $99.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_financial");
  });

  it("blocks content containing a US SSN", () => {
    const page = makePage("p8", "Applicant SSN: 123-45-6789. Please keep this information confidential.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_identity");
  });

  it("blocks content containing an email address", () => {
    const page = makePage("p9", "Contact john.doe@example.com for further information about this matter.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_identity");
  });

  it("blocks content containing medical terminology", () => {
    const page = makePage("p10", "Patient diagnosis: hypertension. Prescription: lisinopril 10mg daily.");
    const result = classifyPage(page);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("pii_health");
  });
});

describe("EligibilityClassifier — batch API", () => {
  it("classifyPages returns one decision per page in input order", () => {
    const pages = [
      makePage("a", "Clean text about distributed systems and consensus algorithms in databases."),
      makePage("b", "password: secret123 this is a credential leak"),
      makePage("c", "Another clean paragraph about graph neural networks for representation learning."),
    ];

    const results = classifyPages(pages);
    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("eligible");
    expect(results[1].status).toBe("blocked");
    expect(results[2].status).toBe("eligible");
  });

  it("filterEligible removes blocked pages and keeps eligible ones", () => {
    const pages = [
      makePage("e1", "Eligible public-interest content about machine learning research trends."),
      makePage("b1", "api_key=supersecret123 configure with this key in your settings file."),
      makePage("e2", "Another eligible page discussing knowledge graph embedding techniques."),
    ];

    const eligible = filterEligible(pages);
    expect(eligible).toHaveLength(2);
    expect(eligible.map((p) => p.pageId)).toEqual(["e1", "e2"]);
  });

  it("blocked nodes are never present in filterEligible output", () => {
    const pages = [
      makePage("blocked1", "SSN: 987-65-4321 — employee record please handle securely"),
      makePage("blocked2", "password: p@ssw0rd1 — please change this immediately"),
    ];

    const eligible = filterEligible(pages);
    expect(eligible).toHaveLength(0);
  });
});

describe("EligibilityClassifier — determinism", () => {
  it("produces identical decisions on repeated calls for the same input", () => {
    const page = makePage(
      "determ",
      "The quick brown fox jumps over the lazy dog to test deterministic behavior.",
    );
    const r1 = classifyPage(page);
    const r2 = classifyPage(page);
    expect(r1).toEqual(r2);
  });
});
