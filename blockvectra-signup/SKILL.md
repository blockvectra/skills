---
name: blockvectra-signup
description: Use when an agent needs to obtain a BlockVectra API key without a browser (wallet-signature sign-up via EIP-191 / SIWE), when a first wallet login should automatically create the account and claim the free compute-unit grant, or when the agent needs to create, list, or revoke API keys programmatically. Does not apply when the user already has BLOCKVECTRA_API_KEY in the environment.
---

# BlockVectra Programmatic Sign-up (Wallet Signature / SIWE)

An agent gets a BlockVectra API key without a browser in four steps: three HTTP requests and one local signature.

1. **Request challenge** — `POST /auth/siwe/challenge`
2. **Sign message** — EIP-191 `personal_sign` (EIP-4361 / SIWE)
3. **Log in / open account** — `POST /auth/siwe/login`
4. **Create API key** — `POST /keys`

The first login for a wallet creates the account automatically and grants a free compute-unit (CU) allowance. Read the current CU grant from `GET /v1/plans` (no key required) rather than relying on any hardcoded number.

Base URL for all console API calls:

```
https://console-api.blockvectra.com/v1
```

Do **not** include an `Origin` header in any of these requests. `curl` and standard HTTP clients omit it by default; do not add it manually. If an `Origin` header is sent and is not a configured web console domain, the challenge request returns HTTP 400 `invalid_request`.

## Default workflow for Agents and CI

Use the bundled [signup.mjs](signup.mjs) helper to keep credentials out of tool transcripts and CI logs. The numbered protocol walkthrough and key-management curl snippets below are reference material, not a runnable shell recipe; do not execute those credential-bearing or credential-returning examples in a logged tool.

Use Node.js 22+ and make the dedicated test wallet's PRIVATE_KEY available through your existing private process environment. Do not put its value in a command or chat. From the directory containing signup.mjs, install its dependency:

```bash
npm install --no-save --package-lock=false viem
```

Choose a new absolute output path inside an existing directory owned by you with mode 0700. The helper creates the file with mode 0600 and refuses to overwrite any existing path.

```bash
BLOCKVECTRA_API_KEY_FILE=/absolute/private/directory/new-api-key node signup.mjs
```

A first wallet login can create a real account; a successful helper run creates a new API key. On success, import the file's credential into your secret manager without printing it into Agent or CI logs.

If the helper fails before requesting a key, it removes its reserved empty file. After the key request starts, it preserves the file, which may be empty, partial, or complete. A nonzero exit does not prove that no key was created. Do not delete the file or blindly rerun. Privately inspect the account's key list using an existing session or sign in with the same wallet through a non-logging Console API client or the web Console, then revoke an unwanted key if appropriate. The helper does not retain the session token.

## Protocol reference

Below, MSG means the exact challenge message, SIG its EIP-191 signature, and TOKEN the login response's session.token. These are placeholders for privately captured fields; the illustrative snippets do not assign them.

---

## Step 1 — Request a challenge

```bash
BASE=https://console-api.blockvectra.com/v1
ADDR=0xYourEthereumAddress

curl -s "$BASE/auth/siwe/challenge" \
  -H 'Content-Type: application/json' \
  -d "{\"address\":\"$ADDR\",\"purpose\":\"login\"}"
```

Response field of interest: `message` — the exact EIP-4361 text to sign.

**Constraint**: Each challenge nonce is single-use and expires after **5 minutes**.

---

## Step 2 — Sign the message (EIP-191 `personal_sign`)

Sign the `message` string returned above **verbatim** — do not alter whitespace, domain, chain ID, or any fields.  
Only Ethereum mainnet (Chain ID 1) Externally Owned Accounts (EOA) are supported.  
Contract wallets (EIP-1271) and smart accounts are **not** supported.

Using Foundry `cast`:

`KEYSTORE` and `PASSWORD_FILE` are paths to an already-configured encrypted test wallet and its password file; restrict the password file to owner read. Keep private key and password values out of command arguments.

```bash
KEYSTORE=/path/to/encrypted-test-keystore
PASSWORD_FILE=/path/to/keystore-password
SIG=$(cast wallet sign --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" "$MSG")
```

Using `viem` (TypeScript):

```ts
import { privateKeyToAccount } from "viem/accounts";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const signature = await account.signMessage({ message });
```

Any modification to the message results in HTTP 400 `siwe_invalid` with `reason: signature`.

---

## Step 3 — Log in (first login creates the account)

Reference only: this curl prints the session response. Use the helper above in Agents and CI.

```bash
MSG="$MSG" SIG="$SIG" node -e 'process.stdout.write(JSON.stringify({ message: process.env.MSG, signature: process.env.SIG }))' | curl -s "$BASE/auth/siwe/login" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

Node.js preserves the multiline SIWE message and signature exactly when encoding them as JSON.

Required fields:

| Field | Description |
|---|---|
| `message` | The complete SIWE message string from Step 1, verbatim |
| `signature` | 65-byte hex signature (`0x`-prefixed) produced by `personal_sign` |

Optional field (saved once when the account is first created; ignored on subsequent logins):

| Field | Constraints |
|---|---|
| `ref` | Lowercase ASCII string matching `^[a-z0-9._-]{1,64}$`. Non-compliant values return HTTP 400 `invalid_request` and prevent account creation; omit or pass `null` when not applicable |
| `referrer` | Source URL or hostname string; only non-string types return HTTP 400 |

Response on success carries `session.token` — a `rgs_` + 64 hex characters token. Absolute lifetime 7 days; expires after 24 hours of idle time. Pass as `Authorization: Bearer rgs_...`.

When `account_created: true` in the response, the account has just been created and the free CU grant has been applied.

**Sign-up rate limits**: `POST /auth/siwe/login` returns HTTP 429 `signup_rate_limited` when the per-IP budget (100 accounts/hour per IPv4 or IPv6 /64 prefix) or the global platform limit is exhausted. Existing accounts logging in again are not subject to sign-up rate limits.

---

## Step 4 — Create an API key

Reference only: this curl prints the one-time API key. Use the helper above in Agents and CI.

```bash
curl -s "$BASE/keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"label":"agent-key"}'
```

Response: HTTP 201. The secret is in `api_key` (format: `rgw_` + 64 hex characters).

> **The secret `api_key` is returned only once.** Store it immediately in your secrets manager or environment variables. It cannot be retrieved again.

**If you lose the key**: log in again with the same wallet to get a new session token, call `POST /keys` for a new key, and revoke the old one.

**Key limits**:

- At most **20** unrevoked, unexpired (`active` + `disabled`) keys per account. Exceeding this returns HTTP 409 `key_limit_reached` (`reason: active_keys`, `limit: 20`). Revoke a key first.
- At most **20** key creations/rotations per 24 hours. Exceeding this returns HTTP 429 `rate_limited` with `Retry-After: 3600`.
- Optional `cu_cap` (soft lifetime CU cap) and expiry (`expires_in_secs` or `expires_at`) may be specified.

One API key works across all supported chains on JSON-RPC and the Data API.

**Pass the key in the request header, not in the URL**, so it does not appear in logs:

```bash
curl -s "https://api.blockvectra.com/v1/<chain>" \
  -H "x-api-key: $BLOCKVECTRA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```


## Key management

### List keys

```bash
curl -s "$BASE/keys" \
  -H "Authorization: Bearer $TOKEN"
# Add ?include_revoked=true to include revoked keys
```

Response: `{"items": [...]}`. Each item has `key_id`, `label`, `status` (`active` / `disabled` / `revoked`), `created_at`, `revoked_at`.

### Revoke a key

```bash
curl -s -X POST "$BASE/keys/{key_id}/revoke" \
  -H "Authorization: Bearer $TOKEN"
```

Idempotent. Returns HTTP 200 with the revoked key object. After revocation, requests using that key are rejected.

---

## Free CU grant amount

Do not hardcode a number. Read it from:

```bash
curl -s https://console-api.blockvectra.com/v1/plans
```

The free tier grant and per-second call limits are in the response. Up to the first top-up, the account is subject to the free-plan rate limit; see the response for the current value.

---

## Security

- **Use a dedicated test wallet** for development; never reuse a production wallet.
- Store private keys and API keys in environment variables or a secrets manager.
- Never commit them to code, write them to logs, or paste them into AI chat conversations.
- Never pass private keys or session tokens as MCP tool arguments.
- For short-lived tasks, supply `expires_in_secs` when creating the key and revoke it via `POST /keys/{key_id}/revoke` when done.
- Account identity is bound to the wallet address — recovering access only requires signing a new challenge with the same wallet.
