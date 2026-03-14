# Security & Trust

This page covers trust assumptions, cryptographic integrity, and smart sharing guardrails.

## Cryptographic Integrity

CORTEX supports cryptographic signing (and optional verification) for stored vectors and metadata to help detect tampering and integrity issues.

## Smart Sharing Guardrails

When sharing memory fragments over P2P, CORTEX enforces:
- MIME type validation
- Model URN compatibility checks
- Eligibility filtering (to avoid leaking sensitive or irrelevant data)

> See `sharing/` for the implementation details of peer exchange and eligibility classification.
