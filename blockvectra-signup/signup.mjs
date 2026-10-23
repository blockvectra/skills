/**
 * BlockVectra programmatic sign-up — Node 22+ ESM script
 *
 * Completes the four-step SIWE flow (challenge → sign → login → create key)
 * and writes the new API key to a private credential file. The key is never
 * printed.
 *
 * Usage:
 *   npm i viem
 *   BLOCKVECTRA_API_KEY_FILE=/absolute/path/to/new/blockvectra-api-key \
 *     node signup.mjs
 *
 * PRIVATE_KEY is read from the existing private environment, not from the
 * command line. The credential file must not exist yet. Its parent directory
 * must already exist, must not be a symlink, must be owned by the current
 * POSIX uid, and must have no group/other permissions (0700 or stricter).
 * The helper creates the credential file with mode 0600.
 *
 * ⚠️  Use a dedicated TEST wallet — never a wallet holding real assets.
 *     The script creates a real BlockVectra account tied to that wallet address.
 */

import { constants as fsConstants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const BASE = "https://console-api.blockvectra.com/v1";
const REF = "blockvectra-signup-skill";
const API_KEY_RE = /^rgw_[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const REMOVED = " No credential file was kept.";
const RETAINED =
  " The credential file was kept; check the Console key status before retrying.";

const ERRORS = {
  missingFile:
    "Error: BLOCKVECTRA_API_KEY_FILE must be set to an absolute path.",
  relativeFile: "Error: BLOCKVECTRA_API_KEY_FILE must be an absolute path.",
  noGetuid:
    "Error: this helper requires POSIX uid support (process.getuid is unavailable).",
  badParent:
    "Error: the credential file parent must exist, must not be a symlink, and must be owned by you with no group/other permissions.",
  existing:
    "Error: the credential file already exists; refusing to overwrite it.",
  create: "Error: could not create the credential file securely.",
  badFile:
    "Error: the credential file did not pass the owner and permission check.",
  privateKey:
    "Error: set PRIVATE_KEY to 0x followed by 64 hexadecimal characters.",
  signing: "Error: signing the challenge message failed.",
  challengeInvalid: "Error: challenge response was invalid.",
  loginInvalid: "Error: login response was invalid.",
  keyInvalid: "Error: key response was invalid.",
  keyFormat: "Error: key response did not contain a valid API key.",
  write: "Error: writing the credential file failed.",
  unexpected: "Error: unexpected failure.",
};

class SafeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SafeError";
  }
}

function stageSuffix(stage) {
  return stage === "key" ? RETAINED : REMOVED;
}

function networkError(stage) {
  return new SafeError(
    `Error: ${stage} request failed before a response was received.${stageSuffix(stage)}`,
  );
}

function httpError(stage, status) {
  const safeStatus = Number.isInteger(status) ? status : "unknown";
  return new SafeError(
    `Error: ${stage} request failed (HTTP ${safeStatus}).${stageSuffix(stage)}`,
  );
}

function responseError(stage, message) {
  return new SafeError(`${message}${stageSuffix(stage)}`);
}

async function fetchSafe(stage, url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw networkError(stage);
  }
}

async function readJsonSafe(response, stage) {
  try {
    return await response.json();
  } catch {
    throw responseError(stage, ERRORS[`${stage}Invalid`]);
  }
}

async function closeQuietly(handle) {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // The caller reports a fixed diagnostic; this is best-effort cleanup.
  }
}

async function unlinkQuietly(path) {
  try {
    await unlink(path);
  } catch {
    // Best-effort cleanup of a file this process created exclusively.
  }
}

async function validateApiKeyFile(filePath) {
  if (!filePath) throw new SafeError(ERRORS.missingFile);
  if (!isAbsolute(filePath)) throw new SafeError(ERRORS.relativeFile);
  if (typeof process.getuid !== "function") throw new SafeError(ERRORS.noGetuid);

  let parentStat;
  try {
    parentStat = await lstat(dirname(filePath));
  } catch {
    throw new SafeError(ERRORS.badParent);
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new SafeError(ERRORS.badParent);
  }
  if (parentStat.uid !== process.getuid()) throw new SafeError(ERRORS.badParent);
  if ((parentStat.mode & 0o077) !== 0) throw new SafeError(ERRORS.badParent);

  try {
    await lstat(filePath);
    throw new SafeError(ERRORS.existing);
  } catch (error) {
    if (error instanceof SafeError) throw error;
    if (!error || error.code !== "ENOENT") throw new SafeError(ERRORS.existing);
  }
}

async function openCredentialFile(filePath) {
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_WRONLY |
    fsConstants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(filePath, flags, 0o600);
  } catch (error) {
    if (error && error.code === "EEXIST") throw new SafeError(ERRORS.existing);
    throw new SafeError(ERRORS.create);
  }

  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0
    ) {
      throw new SafeError(ERRORS.badFile);
    }
  } catch (error) {
    await closeQuietly(handle);
    await unlinkQuietly(filePath);
    if (error instanceof SafeError) throw error;
    throw new SafeError(ERRORS.badFile);
  }

  return handle;
}

async function main() {
  const filePath = process.env.BLOCKVECTRA_API_KEY_FILE;
  await validateApiKeyFile(filePath);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey || !PRIVATE_KEY_RE.test(privateKey)) {
    throw new SafeError(ERRORS.privateKey);
  }

  let account;
  try {
    account = privateKeyToAccount(privateKey);
  } catch {
    throw new SafeError(ERRORS.privateKey);
  }
  if (
    !account ||
    typeof account.address !== "string" ||
    !ADDRESS_RE.test(account.address) ||
    typeof account.signMessage !== "function"
  ) {
    throw new SafeError(ERRORS.privateKey);
  }

  let handle = await openCredentialFile(filePath);
  let keyRequestStarted = false;

  try {
    console.log("[1/4] Requesting challenge…");
    const challengeRes = await fetchSafe(
      "challenge",
      `${BASE}/auth/siwe/challenge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omit the Origin header — programmatic (non-browser) mode requires it absent.
        body: JSON.stringify({ address: account.address, purpose: "login" }),
      },
    );
    if (!challengeRes.ok) throw httpError("challenge", challengeRes.status);
    const challengeBody = await readJsonSafe(challengeRes, "challenge");
    const message = challengeBody && challengeBody.message;
    if (typeof message !== "string" || message.length === 0) {
      throw new SafeError(`${ERRORS.challengeInvalid}${REMOVED}`);
    }

    console.log("[2/4] Signing the challenge message…");
    let signature;
    try {
      // viem applies the EIP-191 prefix and signs the exact challenge string.
      signature = await account.signMessage({ message });
    } catch {
      throw new SafeError(`${ERRORS.signing}${REMOVED}`);
    }
    if (typeof signature !== "string" || signature.length === 0) {
      throw new SafeError(`${ERRORS.signing}${REMOVED}`);
    }

    console.log("[3/4] Logging in…");
    const loginRes = await fetchSafe("login", `${BASE}/auth/siwe/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Omit the Origin header — same requirement as Step 1.
      body: JSON.stringify({
        message,
        signature,
        // Optional: "ref" identifies this agent/framework (lowercase, max 64 chars,
        // must match ^[a-z0-9._-]{1,64}$). Omit or set to null if not applicable.
        ref: REF,
      }),
    });
    if (!loginRes.ok) throw httpError("login", loginRes.status);
    const loginBody = await readJsonSafe(loginRes, "login");
    const sessionToken =
      loginBody && loginBody.session && loginBody.session.token;
    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      throw new SafeError(`${ERRORS.loginInvalid}${REMOVED}`);
    }
    console.log(
      loginBody.account_created === true
        ? "Account created; logged in."
        : "Existing account; logged in.",
    );

    console.log("[4/4] Creating API key…");
    keyRequestStarted = true;
    const keyRes = await fetchSafe("key", `${BASE}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ label: "agent-key" }),
    });
    if (!keyRes.ok) throw httpError("key", keyRes.status);
    const keyBody = await readJsonSafe(keyRes, "key");
    const apiKey = keyBody && keyBody.api_key;
    if (typeof apiKey !== "string" || !API_KEY_RE.test(apiKey)) {
      throw new SafeError(`${ERRORS.keyFormat}${RETAINED}`);
    }

    // Write only the credential and its newline. The session token is never persisted.
    try {
      await handle.writeFile(`${apiKey}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
    } catch {
      await closeQuietly(handle);
      handle = null;
      throw new SafeError(`${ERRORS.write}${RETAINED}`);
    }

    console.log("API key created and stored in the credential file.");
    console.log(`Credential file: ${filePath}`);
  } catch (error) {
    await closeQuietly(handle);
    handle = null;
    if (!keyRequestStarted) {
      await unlinkQuietly(filePath);
    }
    if (error instanceof SafeError) throw error;
    throw new SafeError(
      `${ERRORS.unexpected}${keyRequestStarted ? RETAINED : REMOVED}`,
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SafeError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${ERRORS.unexpected}\n`);
  }
  process.exitCode = 1;
}
