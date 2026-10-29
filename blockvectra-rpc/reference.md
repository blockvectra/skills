# BlockVectra reference

Source of truth: https://docs.blockvectra.com/errors.json (catalog) and https://docs.blockvectra.com/en/errors/?ref=skills (page). Anchors: `https://docs.blockvectra.com/en/errors/#<reason>`. Values below were read from the catalog; re-read it for the current list.

## Live endpoints (no key)

| Purpose | URL |
| --- | --- |
| Chains, methods, public limits | `GET https://api.blockvectra.com/v1/chains` |
| Public JSON-RPC | `POST https://api.blockvectra.com/v1/<chain>/public` |
| Top-up status | `GET https://api.blockvectra.com/v1/topup/status` |
| Plans and CU weights | `GET https://console-api.blockvectra.com/v1/plans` |
| Error catalog | `GET https://docs.blockvectra.com/errors.json` |

## Reasons

Recovery actions in the catalog below are options, not spending authorization. A `balance_exhausted` or `free_grant_exhausted` response must not trigger an automatic payment. Apply the user's existing authorization and the current network/token/amount checks in `SKILL.md` section 7 before any transfer; do not repeat approval requests when valid authorization already covers the action.

| reason | HTTP | Retryable | Action (from the catalog) |
| --- | --- | --- | --- |
| missing_api_key | 401 | no | Provide a valid API key in the request path or the `x-api-key` header. |
| invalid_api_key | 401 | no | Check the key; sign in again to create a new one if needed. |
| key_expired | 403 | no | Create a new key. |
| auth_unavailable | 503 | yes | Honor `Retry-After`; do not recreate the key. |
| method_not_public | 200 (JSON-RPC -32601) | no | Use a method the public endpoint supports, or send an API key. |
| method_not_allowed | 200 (JSON-RPC -32601) | no | Check `methods.allow` and `methods.deny` in `GET /v1/chains`. |
| logs_range_too_large | 200 | no | Narrow the range to within `max_logs_block_range` from `GET /v1/chains`. |
| state_window | 200 | no | Query within `state_window_blocks`, or use the Data API for history. |
| public_rate_limit | 429 | yes | Wait for `Retry-After`, then retry; or use an API key. |
| key_rate_limit | 429 | yes | Sleep for `Retry-After`, or distribute load. |
| concurrency_limit | 429 | yes | Honor `Retry-After` or wait for active calls; limit client concurrency. |
| balance_exhausted | 402 | no | Top up on-chain. |
| free_grant_exhausted | 402 | no | Top up on-chain, or wait for the next cycle grant. |
| upstream_unavailable | 200 (-32603) | yes | Wait a few seconds, retry with exponential backoff. |
| upstream_timeout | 504 | yes | Retry with exponential backoff. |
| overloaded | 200 (-32005) | yes | Back off with jitter and retry. |
| signup_rate_limited | 429 | yes | Honor `Retry-After` before creating an account. |
| not_indexed_yet (Data API) | 409 | yes | Poll until `indexed_through` reaches the block. |
| window_too_large (Data API) | 409 | no | Narrow `from_block`..`to_block` to at most 100,000 blocks, or pass `clamp=true`. |
| no_coverage (Data API) | 422 | no | Check coverage via `GET /v1/data/<chain>/status`. |

## Docs pages

- Quickstart: https://docs.blockvectra.com/en/quickstart/?ref=skills
- Programmatic sign-up: https://docs.blockvectra.com/en/guides/programmatic-signup/?ref=skills
- Agent top-up: https://docs.blockvectra.com/en/guides/agent-topup/?ref=skills
- Errors: https://docs.blockvectra.com/en/errors/?ref=skills
- AI agents: https://docs.blockvectra.com/en/guides/ai-agents/?ref=skills
