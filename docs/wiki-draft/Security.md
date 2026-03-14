# Security & Trust

This page covers trust assumptions, cryptographic integrity, and smart sharing guardrails.

## Cryptographic Integrity

CORTEX uses cryptographic signing to ensure that stored vectors and metadata cannot be tampered with.

## Smart Sharing Guardrails

When sharing memory fragments over P2P, CORTEX enforces:
- MIME type validation
- Model URN compatibility checks
- Eligibility filtering (to avoid leaking sensitive or irrelevant data)

> See `sharing/` for the implementation details of peer exchange and eligibility classification.
