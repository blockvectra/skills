/**
 * BlockVectra programmatic sign-up — Node 20+ ESM script
 *
 * Completes the four-step SIWE flow (challenge → sign → login → create key)
 * and prints the key ID. The secret (api_key) is printed once — save it.
 *
 * Usage:
 *   npm i viem
 *   PRIVATE_KEY=0x… node signup.mjs
 *
 * ⚠️  Use a dedicated TEST wallet — never a wallet holding real assets.
 *     The script creates a real BlockVectra account tied to that wallet address.
 */

import { privateKeyToAccount } from "viem/accounts";

const BASE = "https://console-api.blockvectra.com/v1";

// Load private key from environment — never hardcode it.
const privateKey = /** @type {`0x${string}`} */ (process.env.PRIVATE_KEY);
if (!privateKey || !privateKey.startsWith("0x")) {
  console.error("Error: set PRIVATE_KEY=0x<64 hex chars> before running.");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
const address = account.address;
console.log("Wallet address:", address);

// ---------------------------------------------------------------------------
// Step 1: Request a SIWE challenge
// ---------------------------------------------------------------------------
console.log("\n[1/4] Requesting challenge…");
const challengeRes = await fetch(`${BASE}/auth/siwe/challenge`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  // Omit the Origin header — programmatic (non-browser) mode requires it absent.
  body: JSON.stringify({ address, purpose: "login" }),
});
if (!challengeRes.ok) {
  const body = await challengeRes.text();
  console.error(`Challenge failed (HTTP ${challengeRes.status}):`, body);
  process.exit(1);
}
const { message } = /** @type {{ message: string }} */ (await challengeRes.json());
console.log("Challenge message received (first 80 chars):", message.slice(0, 80) + "…");

// ---------------------------------------------------------------------------
// Step 2: Sign the exact EIP-4361 message with EIP-191 personal_sign
// ---------------------------------------------------------------------------
console.log("\n[2/4] Signing message with EIP-191 personal_sign…");
// viem's signMessage applies EIP-191 prefix and signs with the private key.
const signature = await account.signMessage({ message });
console.log("Signature:", signature.slice(0, 20) + "…");

// ---------------------------------------------------------------------------
// Step 3: Submit message + signature to log in (first login creates account)
// ---------------------------------------------------------------------------
console.log("\n[3/4] Logging in…");
const loginRes = await fetch(`${BASE}/auth/siwe/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  // Omit the Origin header — same requirement as Step 1.
  body: JSON.stringify({
    message,
    signature,
    // Optional: "ref" identifies this agent/framework (lowercase, max 64 chars,
    // must match ^[a-z0-9._-]{1,64}$). Omit or set to null if not applicable.
    ref: "blockvectra-signup-skill",
  }),
});
if (!loginRes.ok) {
  const body = await loginRes.text();
  console.error(`Login failed (HTTP ${loginRes.status}):`, body);
  process.exit(1);
}
const loginBody = /** @type {{ session: { token: string }; account_created?: boolean }} */ (
  await loginRes.json()
);
const sessionToken = loginBody.session.token;
const accountCreated = loginBody.account_created ?? false;
console.log(accountCreated ? "New account created ✓" : "Existing account — logged in ✓");
console.log("Session token prefix:", sessionToken.slice(0, 8) + "…");

// ---------------------------------------------------------------------------
// Step 4: Create an API key
// ---------------------------------------------------------------------------
console.log("\n[4/4] Creating API key…");
const keyRes = await fetch(`${BASE}/keys`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionToken}`,
  },
  body: JSON.stringify({ label: "agent-key" }),
});
if (!keyRes.ok) {
  const body = await keyRes.text();
  console.error(`Key creation failed (HTTP ${keyRes.status}):`, body);
  process.exit(1);
}
const keyBody = /** @type {{ api_key: string; key?: { key_id?: string } }} */ (await keyRes.json());
const apiKey = keyBody.api_key;
const keyId = keyBody.key?.key_id ?? "(see key object in full response)";

// The secret is returned ONLY ONCE — print it now and save it.
console.log("\n✅ API key created successfully.");
console.log("Key ID    :", keyId);
console.log("Secret    :", apiKey);
console.log("\n⚠️  The secret above is shown only once and cannot be retrieved again.");
console.log("   Save it immediately to your secrets manager or environment:");
console.log(`   export BLOCKVECTRA_API_KEY=${apiKey}`);
console.log("\n   Use x-api-key header (not URL) to pass the key, so it stays out of logs:");
console.log('   curl -H "x-api-key: $BLOCKVECTRA_API_KEY" https://api.blockvectra.com/v1/<chain> …');
