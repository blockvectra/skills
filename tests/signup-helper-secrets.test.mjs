// Synthetic-fixture suite for the signup helper's credential handling.
//
// SCOPE: this suite stubs viem and fetch, and uses only synthetic values. It
// does not test real EIP-191 signatures, real network behavior, BlockVectra
// authorization, or account creation. It verifies the local request contract,
// credential-file handling, preflight rejection, and failure diagnostics.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_ROOT = resolve(HERE, "..");
const SCRIPT_SOURCE = join(CANDIDATE_ROOT, "blockvectra-signup", "signup.mjs");
const TMP_ROOT = join(CANDIDATE_ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const RUN_ROOT = mkdtempSync(join(TMP_ROOT, "signup-helper-secrets-"));

const BASE = "https://console-api.blockvectra.com/v1";
const CHALLENGE_URL = `${BASE}/auth/siwe/challenge`;
const LOGIN_URL = `${BASE}/auth/siwe/login`;
const KEYS_URL = `${BASE}/keys`;

const PRIVATE_KEY = `0x${"11".repeat(32)}`;
const ADDRESS = `0x${"22".repeat(20)}`;
const SIGNATURE = `0x${"33".repeat(65)}`;
const SESSION = `rgs_${"44".repeat(32)}`;
const API_KEY = `rgw_${"55".repeat(32)}`;
const STATUS_SECRET = "SYNTHETIC_UPSTREAM_BODY_SECRET_9f3c";

const MESSAGE = [
  "synthetic.test.invalid wants you to sign in with your Ethereum account:",
  ADDRESS,
  "",
  'Sign in to BlockVectra with "quotes" and a \\ backslash.',
  "Second line keeps its newline.",
].join("\n") + "\n";

const ALL_SECRETS = [
  PRIVATE_KEY,
  MESSAGE,
  SIGNATURE,
  SESSION,
  API_KEY,
  ADDRESS,
  STATUS_SECRET,
];

const VIEM_STUB_SOURCE = `
import { appendFileSync } from "node:fs";

const address = process.env.STUB_ADDRESS;
const signature = process.env.STUB_SIGNATURE;

export function privateKeyToAccount() {
  return {
    address,
    async signMessage({ message }) {
      const capture = process.env.STUB_SIGN_CAPTURE_FILE;
      if (capture) {
        appendFileSync(capture, JSON.stringify({ message }) + "\\n");
      }
      if (process.env.STUB_SIGN_FAIL === "1") {
        throw new Error(process.env.STUB_SIGN_ERROR || "synthetic signing failure");
      }
      return signature;
    },
  };
}
`;

const PRELOAD_SOURCE = `
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const scenarioPath = process.env.FETCH_SCENARIO_FILE;
const scenario = scenarioPath
  ? JSON.parse(readFileSync(scenarioPath, "utf8"))
  : { responses: [] };
const capturePath = process.env.FETCH_CAPTURE_FILE;
const keyFile = process.env.BLOCKVECTRA_API_KEY_FILE;
let callIndex = 0;

function record(fact) {
  if (capturePath) {
    appendFileSync(capturePath, JSON.stringify(fact) + "\\n");
  }
}

if (process.env.ARGV_CAPTURE_FILE) {
  appendFileSync(process.env.ARGV_CAPTURE_FILE, JSON.stringify(process.argv));
}

if (process.env.FS_FAIL_MODE) {
  const shim = pathToFileURL(new URL("./fsp-shim.mjs", import.meta.url).pathname).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "node:fs/promises") {
        return { url: shim, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input);
  const method = String(init.method || "GET").toUpperCase();
  const rawHeaders = init.headers || {};
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    headers[key.toLowerCase()] = String(value);
  }
  const body = typeof init.body === "string" ? init.body : null;
  const index = callIndex;
  callIndex += 1;
  const expected = scenario.responses[index];
  const unknown = !expected || expected.url !== url || expected.method !== method;
  const outputExists = Boolean(keyFile && existsSync(keyFile));
  const outputMode = outputExists ? statSync(keyFile).mode & 0o777 : null;
  record({ index, url, method, headers, body, unknown, outputExists, outputMode });
  if (unknown) {
    throw new Error("synthetic fetch stub: unexpected request");
  }
  if (expected.kind === "network") {
    throw new Error(expected.message || "synthetic fetch stub: network failure");
  }
  return {
    ok: expected.status >= 200 && expected.status < 300,
    status: expected.status,
    async json() {
      return expected.body;
    },
    async text() {
      return typeof expected.body === "string"
        ? expected.body
        : JSON.stringify(expected.body);
    },
  };
};
`;

const FSP_SHIM_SOURCE = `
const real = process.getBuiltinModule("fs/promises");
const mode = process.env.FS_FAIL_MODE;
const failure = () =>
  new Error(process.env.FS_FAIL_ERROR || "synthetic local filesystem failure");

export const lstat = (...args) => real.lstat(...args);
export const unlink = (...args) => real.unlink(...args);

export async function open(...args) {
  const handle = await real.open(...args);
  if (!mode) return handle;
  return {
    stat: (...statArgs) => handle.stat(...statArgs),
    writeFile: async (data, ...rest) => {
      if (mode === "write-before") throw failure();
      if (mode === "write-partial") {
        await handle.writeFile(String(data).slice(0, 10), ...rest);
        throw failure();
      }
      return handle.writeFile(data, ...rest);
    },
    sync: async () => {
      if (mode === "sync") throw failure();
      return handle.sync();
    },
    close: async () => {
      if (mode === "close") {
        await handle.close();
        throw failure();
      }
      return handle.close();
    },
  };
}
`;

const NO_GETUID_SOURCE = "delete process.getuid;\n";

function successScenario() {
  return [
    {
      url: CHALLENGE_URL,
      method: "POST",
      kind: "json",
      status: 200,
      body: { message: MESSAGE },
    },
    {
      url: LOGIN_URL,
      method: "POST",
      kind: "json",
      status: 200,
      body: { session: { token: SESSION }, account_created: true },
    },
    {
      url: KEYS_URL,
      method: "POST",
      kind: "json",
      status: 201,
      body: { api_key: API_KEY, key: { key_id: "key_synthetic" } },
    },
  ];
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

function readJson(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").trim();
  return text ? JSON.parse(text) : null;
}

function writePrivateFile(file, text) {
  writeFileSync(file, text, { mode: 0o600 });
}

function runHelper(options = {}) {
  const runDir = mkdtempSync(join(RUN_ROOT, "run-"));
  try {
    const scriptPath = join(runDir, "signup.mjs");
    copyFileSync(SCRIPT_SOURCE, scriptPath);

    const viemDir = join(runDir, "node_modules", "viem");
    mkdirSync(join(viemDir, "accounts"), { recursive: true });
    writeFileSync(
      join(viemDir, "package.json"),
      JSON.stringify({
        name: "viem",
        version: "0.0.0-synthetic",
        type: "module",
        exports: { "./accounts": "./accounts/index.mjs" },
      }),
    );
    writeFileSync(join(viemDir, "accounts", "index.mjs"), VIEM_STUB_SOURCE);
    writeFileSync(join(runDir, "preload.mjs"), PRELOAD_SOURCE);
    writeFileSync(join(runDir, "fsp-shim.mjs"), FSP_SHIM_SOURCE);
    writeFileSync(join(runDir, "no-getuid.mjs"), NO_GETUID_SOURCE);

    const privateParent = join(runDir, "private");
    mkdirSync(privateParent, { mode: 0o700 });
    chmodSync(privateParent, 0o700);

    let outputPath;
    if (options.outputPath) {
      outputPath = options.outputPath({ runDir, privateParent });
    } else {
      outputPath = join(privateParent, "api-key.txt");
    }
    if (options.prepare) {
      options.prepare({ runDir, privateParent, outputPath });
    }

    const scenarioPath = join(runDir, "scenario.json");
    writePrivateFile(
      scenarioPath,
      JSON.stringify({ responses: options.responses ?? successScenario() }),
    );

    const fetchCapture = join(runDir, "fetch.jsonl");
    const signCapture = join(runDir, "sign.jsonl");
    const argvCapture = join(runDir, "argv.json");
    for (const file of [fetchCapture, signCapture, argvCapture]) {
      writePrivateFile(file, "");
    }

    const env = {
      HOME: runDir,
      TMPDIR: runDir,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      PRIVATE_KEY: options.privateKey ?? PRIVATE_KEY,
      STUB_ADDRESS: ADDRESS,
      STUB_SIGNATURE: SIGNATURE,
      STUB_SIGN_CAPTURE_FILE: signCapture,
      FETCH_SCENARIO_FILE: scenarioPath,
      FETCH_CAPTURE_FILE: fetchCapture,
      ARGV_CAPTURE_FILE: argvCapture,
    };
    if (!options.omitApiKeyFile) {
      env.BLOCKVECTRA_API_KEY_FILE = options.relativePath ?? outputPath;
    }
    if (options.signFail) {
      env.STUB_SIGN_FAIL = "1";
      env.STUB_SIGN_ERROR = STATUS_SECRET;
    }
    if (options.fsFail) {
      env.FS_FAIL_MODE = options.fsFail;
      env.FS_FAIL_ERROR = STATUS_SECRET;
    }

    const args = [];
    if (options.noGetuid) {
      args.push("--import", pathToFileURL(join(runDir, "no-getuid.mjs")).href);
    }
    args.push("--import", pathToFileURL(join(runDir, "preload.mjs")).href);
    args.push(scriptPath);

    const result = spawnSync(process.execPath, args, {
      cwd: runDir,
      env,
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      runDir,
      outputPath,
      result,
      fetchCalls: readJsonl(fetchCapture),
      signCalls: readJsonl(signCapture),
      argv: readJson(argvCapture),
    };
  } catch (error) {
    rmSync(runDir, { recursive: true, force: true });
    throw error;
  }
}

function cleanup(run) {
  rmSync(run.runDir, { recursive: true, force: true });
}

function assertNoSecretPrefix(text, label) {
  for (let secretIndex = 0; secretIndex < ALL_SECRETS.length; secretIndex += 1) {
    const secret = ALL_SECRETS[secretIndex];
    const min = Math.min(4, secret.length);
    for (let length = min; length <= secret.length; length += 1) {
      const prefix = secret.slice(0, length);
      if (text.includes(prefix)) {
        assert.fail(
          `${label}: leaked a ${length}-character prefix of synthetic secret ${secretIndex}`,
        );
      }
    }
  }
}

function assertNoLeak(run, label) {
  const logs = `${run.result.stdout}\n${run.result.stderr}`;
  assertNoSecretPrefix(logs, `${label} stdout/stderr`);
  assertNoSecretPrefix(JSON.stringify(run.argv), `${label} argv`);
  assertNoSecretPrefix(
    run.fetchCalls.map((call) => call.url).join("\n"),
    `${label} URLs`,
  );
}

function assertChildStarted(run, label) {
  assert.equal(run.result.error, undefined, `${label}: child did not start cleanly`);
  assert.equal(
    run.result.status,
    0,
    `${label}: child exited with ${run.result.status} (${run.result.signal})`,
  );
}

function assertChildFailed(run, label) {
  assert.equal(run.result.error, undefined, `${label}: child did not start cleanly`);
  assert.notEqual(run.result.status, 0, `${label}: child should exit non-zero`);
  assert.match(run.result.stderr, /^Error:/m, `${label}: fixed error diagnostic`);
}

function assertNoUnknownRequests(run, label) {
  assert.equal(
    run.fetchCalls.filter((call) => call.unknown).length,
    0,
    `${label}: no unknown URL/method was attempted`,
  );
}

// ---------------------------------------------------------------------------
// Normal success path first
// ---------------------------------------------------------------------------

test("success: raw multiline message survives unchanged and the key is written only to the 0600 file", () => {
  const run = runHelper();
  try {
    assertChildStarted(run, "success");
    assert.equal(run.fetchCalls.length, 3, "exactly three HTTP requests");
    assertNoUnknownRequests(run, "success");
    assert.deepEqual(run.fetchCalls.map((call) => call.url), [
      CHALLENGE_URL,
      LOGIN_URL,
      KEYS_URL,
    ]);
    assert.deepEqual(run.fetchCalls.map((call) => call.method), [
      "POST",
      "POST",
      "POST",
    ]);
    for (const call of run.fetchCalls) {
      assert.equal(call.headers.origin, undefined, "no Origin header");
      assert.equal(
        call.outputExists,
        true,
        "the private credential file already exists before each HTTP request",
      );
      assert.equal(
        call.outputMode,
        0o600,
        "the credential file is already 0600 before each HTTP request",
      );
    }
    assert.equal(run.fetchCalls[0].headers["content-type"], "application/json");
    assert.equal(run.fetchCalls[0].headers.authorization, undefined);
    assert.equal(run.fetchCalls[1].headers["content-type"], "application/json");
    assert.equal(run.fetchCalls[1].headers.authorization, undefined);
    assert.equal(run.fetchCalls[2].headers["content-type"], "application/json");
    assert.equal(
      run.fetchCalls[2].headers.authorization,
      `Bearer ${SESSION}`,
      "key request uses the session bearer token",
    );

    assert.deepEqual(JSON.parse(run.fetchCalls[0].body), {
      address: ADDRESS,
      purpose: "login",
    });
    assert.deepEqual(JSON.parse(run.fetchCalls[1].body), {
      message: MESSAGE,
      signature: SIGNATURE,
      ref: "blockvectra-signup-skill",
    });
    assert.deepEqual(JSON.parse(run.fetchCalls[2].body), { label: "agent-key" });

    assert.equal(run.signCalls.length, 1, "one local signature");
    assert.equal(run.signCalls[0].message, MESSAGE, "the exact raw message was signed");
    assert.ok(Array.isArray(run.argv), "argv was captured");

    const bytes = readFileSync(run.outputPath);
    assert.deepEqual(bytes, Buffer.from(`${API_KEY}\n`), "file contains only key + newline");
    assert.equal(statSync(run.outputPath).mode & 0o777, 0o600, "file mode is 0600");
    assert.match(run.result.stdout, /API key created and stored/);
    assert.match(run.result.stdout, /Credential file:/);
    assertNoLeak(run, "success");
  } finally {
    cleanup(run);
  }
});

// ---------------------------------------------------------------------------
// Preflight rejection: zero HTTP and no touching existing paths
// ---------------------------------------------------------------------------

const EXISTING_BYTES = "existing credential bytes must stay unchanged\n";

function expectPreflightRejection(name, options, verify) {
  test(`preflight rejects ${name} with zero HTTP`, () => {
    const run = runHelper(options);
    try {
      assertChildFailed(run, name);
      assert.equal(run.fetchCalls.length, 0, "no HTTP request");
      assertNoUnknownRequests(run, name);
      assertNoLeak(run, name);
      if (verify) verify(run);
    } finally {
      cleanup(run);
    }
  });
}

expectPreflightRejection(
  "an existing target file",
  {
    prepare({ outputPath }) {
      writeFileSync(outputPath, EXISTING_BYTES, { mode: 0o644 });
    },
  },
  (run) => {
    assert.equal(readFileSync(run.outputPath, "utf8"), EXISTING_BYTES);
    assert.equal(lstatSync(run.outputPath).isSymbolicLink(), false);
  },
);

expectPreflightRejection(
  "a symlink target file",
  {
    prepare({ runDir, privateParent }) {
      const target = join(runDir, "existing-target.txt");
      writeFileSync(target, EXISTING_BYTES, { mode: 0o644 });
      symlinkSync(target, join(privateParent, "api-key.txt"));
    },
  },
  (run) => {
    assert.equal(readFileSync(run.outputPath, "utf8"), EXISTING_BYTES);
    assert.equal(lstatSync(run.outputPath).isSymbolicLink(), true);
  },
);

expectPreflightRejection(
  "a parent with group/other permissions",
  {
    outputPath({ runDir }) {
      const wide = join(runDir, "wide-parent");
      mkdirSync(wide, { mode: 0o755 });
      chmodSync(wide, 0o755);
      return join(wide, "api-key.txt");
    },
  },
  (run) => {
    assert.equal(existsSync(run.outputPath), false);
  },
);

expectPreflightRejection(
  "a symlink parent",
  {
    outputPath({ runDir }) {
      const real = join(runDir, "real-parent");
      mkdirSync(real, { mode: 0o700 });
      chmodSync(real, 0o700);
      const link = join(runDir, "linked-parent");
      symlinkSync(real, link);
      return join(link, "api-key.txt");
    },
  },
  (run) => {
    assert.equal(existsSync(run.outputPath), false);
    assert.equal(existsSync(join(run.runDir, "real-parent", "api-key.txt")), false);
  },
);

expectPreflightRejection(
  "a missing parent directory",
  {
    outputPath({ runDir }) {
      return join(runDir, "does-not-exist", "api-key.txt");
    },
  },
  (run) => {
    assert.equal(existsSync(run.outputPath), false);
    assert.equal(existsSync(join(run.runDir, "does-not-exist")), false);
  },
);

expectPreflightRejection("a missing BLOCKVECTRA_API_KEY_FILE", { omitApiKeyFile: true }, (run) => {
  assert.equal(existsSync(run.outputPath), false);
});

expectPreflightRejection(
  "a relative BLOCKVECTRA_API_KEY_FILE",
  { relativePath: "relative-key.txt" },
  (run) => {
    assert.equal(existsSync(join(run.runDir, "relative-key.txt")), false);
  },
);

expectPreflightRejection("missing POSIX getuid support", { noGetuid: true }, (run) => {
  assert.equal(existsSync(run.outputPath), false);
});

// ---------------------------------------------------------------------------
// Upstream failure bodies must not leak, and cleanup follows the key boundary
// ---------------------------------------------------------------------------

function expectHttpError(name, responses, expectedFetches, status, retained) {
  test(`${name} HTTP error body is not leaked and cleanup matches the key boundary`, () => {
    const run = runHelper({ responses });
    try {
      assertChildFailed(run, name);
      assert.equal(run.fetchCalls.length, expectedFetches, "request count is exact");
      assertNoUnknownRequests(run, name);
      assert.match(run.result.stderr, new RegExp(`${name} request failed \\(HTTP ${status}\\)`));
      if (retained) {
        assert.equal(existsSync(run.outputPath), true, "credential file is kept");
        const stat = statSync(run.outputPath);
        assert.equal(stat.mode & 0o777, 0o600);
        assert.equal(stat.size, 0, "retained file is empty");
        assert.match(run.result.stderr, /credential file was kept/);
      } else {
        assert.equal(existsSync(run.outputPath), false, "empty credential file is removed");
        assert.match(run.result.stderr, /No credential file was kept/);
      }
      assertNoLeak(run, name);
    } finally {
      cleanup(run);
    }
  });
}

expectHttpError(
  "challenge",
  [
    {
      url: CHALLENGE_URL,
      method: "POST",
      kind: "json",
      status: 500,
      body: { error: "synthetic", detail: STATUS_SECRET },
    },
  ],
  1,
  500,
  false,
);

expectHttpError(
  "login",
  [
    successScenario()[0],
    {
      url: LOGIN_URL,
      method: "POST",
      kind: "json",
      status: 401,
      body: { error: "synthetic", detail: STATUS_SECRET },
    },
  ],
  2,
  401,
  false,
);

expectHttpError(
  "key",
  [
    successScenario()[0],
    successScenario()[1],
    {
      url: KEYS_URL,
      method: "POST",
      kind: "json",
      status: 500,
      body: { error: "synthetic", detail: STATUS_SECRET },
    },
  ],
  3,
  500,
  true,
);

test("signing failure removes the empty owned file and hides the viem error text", () => {
  const run = runHelper({
    responses: [successScenario()[0]],
    signFail: true,
  });
  try {
    assertChildFailed(run, "signing");
    assert.equal(run.fetchCalls.length, 1, "only the challenge request was sent");
    assertNoUnknownRequests(run, "signing");
    assert.match(run.result.stderr, /signing the challenge message failed/);
    assert.equal(existsSync(run.outputPath), false);
    assertNoLeak(run, "signing");
  } finally {
    cleanup(run);
  }
});

test("challenge fetch exception text is not leaked and the empty file is removed", () => {
  const run = runHelper({
    responses: [
      {
        url: CHALLENGE_URL,
        method: "POST",
        kind: "network",
        message: `synthetic fetch failure ${STATUS_SECRET}`,
      },
    ],
  });
  try {
    assertChildFailed(run, "challenge network");
    assert.equal(run.fetchCalls.length, 1);
    assertNoUnknownRequests(run, "challenge network");
    assert.match(
      run.result.stderr,
      /challenge request failed before a response was received/,
    );
    assert.equal(existsSync(run.outputPath), false);
    assertNoLeak(run, "challenge network");
  } finally {
    cleanup(run);
  }
});

test("key fetch exception text is not leaked and the owned file is kept", () => {
  const responses = successScenario();
  responses[2] = {
    url: KEYS_URL,
    method: "POST",
    kind: "network",
    message: `synthetic fetch failure ${STATUS_SECRET}`,
  };
  const run = runHelper({ responses });
  try {
    assertChildFailed(run, "key network");
    assert.equal(run.fetchCalls.length, 3);
    assertNoUnknownRequests(run, "key network");
    assert.match(run.result.stderr, /key request failed before a response was received/);
    assert.match(run.result.stderr, /credential file was kept/);
    assert.equal(existsSync(run.outputPath), true);
    assert.equal(statSync(run.outputPath).mode & 0o777, 0o600);
    assert.equal(statSync(run.outputPath).size, 0);
    assertNoLeak(run, "key network");
  } finally {
    cleanup(run);
  }
});

test("invalid api_key response is not written and the owned file is kept empty", () => {
  const responses = successScenario();
  responses[2] = {
    url: KEYS_URL,
    method: "POST",
    kind: "json",
    status: 201,
    body: { api_key: `rgw_${"zz".repeat(32)}`, detail: STATUS_SECRET },
  };
  const run = runHelper({ responses });
  try {
    assertChildFailed(run, "invalid key format");
    assert.equal(run.fetchCalls.length, 3);
    assertNoUnknownRequests(run, "invalid key format");
    assert.match(run.result.stderr, /did not contain a valid API key/);
    assert.equal(existsSync(run.outputPath), true);
    assert.equal(statSync(run.outputPath).mode & 0o777, 0o600);
    assert.equal(statSync(run.outputPath).size, 0, "invalid key never reaches the file");
    assertNoLeak(run, "invalid key format");
  } finally {
    cleanup(run);
  }
});

// ---------------------------------------------------------------------------
// Local filesystem write / persistence failure injection
// ---------------------------------------------------------------------------

const fsFailureCases = [
  {
    mode: "write-before",
    expected: "",
    description: "write failure before any bytes",
  },
  {
    mode: "write-partial",
    expected: `${API_KEY}\n`.slice(0, 10),
    description: "partial write failure",
  },
  {
    mode: "sync",
    expected: `${API_KEY}\n`,
    description: "sync failure after a complete write",
  },
];

for (const fixture of fsFailureCases) {
  test(`local fs ${fixture.description} exits non-zero, keeps the 0600 file, and leaks nothing`, () => {
    const run = runHelper({ fsFail: fixture.mode });
    try {
      assertChildFailed(run, fixture.description);
      assert.equal(run.fetchCalls.length, 3);
      assertNoUnknownRequests(run, fixture.description);
      assert.match(run.result.stderr, /writing the credential file failed/);
      assert.match(run.result.stderr, /credential file was kept/);
      assert.equal(existsSync(run.outputPath), true);
      assert.equal(statSync(run.outputPath).mode & 0o777, 0o600);
      assert.equal(readFileSync(run.outputPath, "utf8"), fixture.expected);
      assertNoLeak(run, fixture.description);
    } finally {
      cleanup(run);
    }
  });
}

after(() => {
  rmSync(RUN_ROOT, { recursive: true, force: true });
});
