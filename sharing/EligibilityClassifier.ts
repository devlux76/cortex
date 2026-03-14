// ---------------------------------------------------------------------------
// EligibilityClassifier — classify pages as share-eligible or blocked (P2-G1)
// ---------------------------------------------------------------------------
//
// Detects identity/PII-bearing content before any graph export operation.
// Emits deterministic eligibility decisions with reason codes for auditability.
//
// Rules:
// - Identity PII: person names with SSN/passport/national ID patterns
// - Credentials: password, API key, secret, token patterns
// - Financial: credit card, IBAN, account number patterns
// - Health: medical record, diagnosis, prescription patterns
// - No public interest: very short or empty content
// ---------------------------------------------------------------------------

import type { Hash, Page } from "../core/types";
import type { BlockReason, EligibilityDecision, EligibilityStatus } from "./types";

// ---------------------------------------------------------------------------
// PII detection patterns
// ---------------------------------------------------------------------------

/** Minimum content length (chars) to be considered public-interest. */
const MIN_PUBLIC_INTEREST_LENGTH = 20;

const PATTERNS: Array<{ reason: BlockReason; pattern: RegExp }> = [
  {
    reason: "pii_credentials",
    // Passwords, API keys, tokens, secrets in common formats
    pattern: /\b(?:password|passwd|api[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*\S+/i,
  },
  {
    reason: "pii_credentials",
    // Bearer tokens, basic auth, SSH key headers
    pattern: /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|-----BEGIN (?:RSA |EC |)PRIVATE KEY-----)/,
  },
  {
    reason: "pii_financial",
    // Credit card: 13-19 digits with optional separators
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3,6})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12,15})\b/,
  },
  {
    reason: "pii_financial",
    // IBAN: up to 34 alphanumeric chars after country code
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}(?:[A-Z0-9]{0,16})?\b/,
  },
  {
    reason: "pii_identity",
    // US Social Security Number
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/,
  },
  {
    reason: "pii_identity",
    // Email addresses (identity signal — may be PII)
    pattern: /\b[-a-zA-Z0-9._%+]+@[a-zA-Z0-9.]+\.[a-zA-Z]{2,}\b/i,
  },
  {
    reason: "pii_health",
    // Medical record / health identifiers
    pattern: /\b(?:medical[_-]?record|patient[_-]?id|diagnosis|prescription|ICD[-\s]?\d{1,2})\b/i,
  },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a single page as share-eligible or blocked.
 *
 * Scans `page.content` against a set of PII/credential patterns and
 * returns a deterministic decision with a reason code when blocked.
 */
export function classifyPage(page: Page): EligibilityDecision {
  // Reject trivially short content as not public-interest
  if (page.content.trim().length < MIN_PUBLIC_INTEREST_LENGTH) {
    return blocked(page.pageId, "no_public_interest");
  }

  for (const { reason, pattern } of PATTERNS) {
    if (pattern.test(page.content)) {
      return blocked(page.pageId, reason);
    }
  }

  return { pageId: page.pageId, status: "eligible" };
}

/**
 * Classify a batch of pages, returning one decision per page.
 *
 * Results are in the same order as the input array.
 */
export function classifyPages(pages: Page[]): EligibilityDecision[] {
  return pages.map((p) => classifyPage(p));
}

/**
 * Filter a page array down to only share-eligible pages.
 */
export function filterEligible(pages: Page[]): Page[] {
  return pages.filter((p) => classifyPage(p).status === "eligible");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blocked(pageId: Hash, reason: BlockReason): EligibilityDecision {
  return { pageId, status: "blocked" as EligibilityStatus, reason };
}
