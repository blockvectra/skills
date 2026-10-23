import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const TMP_ROOT = join(REPO_ROOT, '.tmp');
mkdirSync(TMP_ROOT, { recursive: true });
// Each test process owns one unique directory. The outer cleanup removes only this
// directory, so concurrent runs in the same checkout cannot delete each other's temp files.
const RUN_ROOT = mkdtempSync(join(TMP_ROOT, 'skills-siwe-json-tests-'));
const DEFAULT_SKILL_FILE = resolve(HERE, '../blockvectra-signup/SKILL.md');
const SKILL_FILE = resolve(process.env.SIGNUP_SKILL_FILE ?? DEFAULT_SKILL_FILE);
const BASE_URL = 'http://siwe.test.invalid/v1';

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function extractStep3Bash(source) {
  const heading = source.match(/^## Step 3\b[^\n]*$/m);
  assert.ok(heading, 'SKILL.md has a Step 3 heading');

  const sectionStart = heading.index + heading[0].length;
  const tail = source.slice(sectionStart);
  const nextSection = tail.search(/^## /m);
  const section = nextSection === -1 ? tail : tail.slice(0, nextSection);
  const block = section.match(/```bash\r?\n([\s\S]*?)```/);

  assert.ok(block, 'Step 3 contains a fenced bash code block');
  return block[1];
}

const curlStubSource = `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const dataParts = [];
let stdinRead = false;

const readStdin = () => {
  if (!stdinRead) {
    stdinRead = true;
    dataParts.push(fs.readFileSync(0, 'utf8'));
  }
};

const addData = (value) => {
  if (value === '@-') {
    readStdin();
    return;
  }
  if (value.startsWith('@')) {
    dataParts.push(fs.readFileSync(value.slice(1), 'utf8'));
    return;
  }
  dataParts.push(value);
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '-d' || arg === '--data' || arg === '--data-binary' || arg === '--data-raw') {
    if (index + 1 >= args.length) {
      process.stderr.write('curl stub: missing value for ' + arg + '\\n');
      process.exit(2);
    }
    index += 1;
    addData(args[index]);
  } else if (arg.startsWith('--data-binary=') || arg.startsWith('--data=') || arg.startsWith('--data-raw=')) {
    addData(arg.slice(arg.indexOf('=') + 1));
  } else if (arg.startsWith('-d@')) {
    addData(arg.slice(2));
  }
}

const captureFile = process.env.CAPTURE_FILE;
if (!captureFile) {
  process.stderr.write('curl stub: CAPTURE_FILE is required\\n');
  process.exit(3);
}

fs.writeFileSync(captureFile, JSON.stringify({ argv: args, body: dataParts.join('&') }));
process.stdout.write('{"session":{"token":"synthetic"}}\\n');
`;

const nodeWrapperSource = `#!/bin/bash
printf '%s\\0' "$@" >> "$NODE_CAPTURE_FILE"
exec ${shellQuote(process.execPath)} "$@"
`;

const cases = [
  {
    name: 'normal multiline SIWE text',
    message:
      'siwe.test.invalid wants you to sign in with your Ethereum account:\n0x0000000000000000000000000000000000000001\n\nSign in to BlockVectra.',
    signature: '0xsynthetic_signature_normal',
  },
  {
    name: 'quotes',
    message: 'Line with "double quotes", \'single quotes\', and `backticks`.\nSecond line.',
    signature: '0xsynthetic_"quoted"_signature',
  },
  {
    name: 'backslashes and JSON-like text',
    message: 'C:\\Users\\agent\\path\nJSON-like: {"a":"b"}\ttab',
    signature: '0xsynthetic\\signature\\with\\backslashes',
  },
  {
    name: 'CRLF line endings',
    message: 'line one\r\nline two\r\n\r\n',
    signature: '0xsynthetic_crlf_signature\r\nwith-crlf',
  },
  {
    name: 'Unicode and trailing whitespace',
    message: '登录 BlockVectra — 你好 🌍\n trailing spaces   \n\t\n',
    signature: '0xsynthetic_签名_🔑',
  },
];

// These cases cover JSON transport string fidelity only. They do not validate SIWE
// grammar, signature validity, credentials, or any account operation; every value is synthetic.
function runStep3(step3Bash, fixture) {
  const runDir = mkdtempSync(join(RUN_ROOT, 'run-'));

  try {
    const binDir = join(runDir, 'bin');
    const homeDir = join(runDir, 'home');
    const captureFile = join(runDir, 'curl-capture.json');
    const nodeCaptureFile = join(runDir, 'node-args.bin');
    const curlStubFile = join(runDir, 'curl-stub.cjs');
    mkdirSync(binDir);
    mkdirSync(homeDir);

    writeFileSync(
      join(binDir, 'curl'),
      `#!/bin/bash\nexec ${shellQuote(process.execPath)} ${shellQuote(curlStubFile)} "$@"\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(binDir, 'node'), nodeWrapperSource, { mode: 0o755 });
    writeFileSync(curlStubFile, curlStubSource);
    chmodSync(join(binDir, 'curl'), 0o755);
    chmodSync(join(binDir, 'node'), 0o755);

    const result = spawnSync('/bin/bash', ['-c', step3Bash], {
      cwd: runDir,
      env: {
        PATH: binDir,
        HOME: homeDir,
        TMPDIR: runDir,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        BASE: BASE_URL,
        MSG: fixture.message,
        SIG: fixture.signature,
        CAPTURE_FILE: captureFile,
        NODE_CAPTURE_FILE: nodeCaptureFile,
      },
      encoding: 'utf8',
      input: '',
      timeout: 10000,
    });

    assert.equal(result.error, undefined, `Step 3 did not start cleanly: ${result.error}`);
    assert.equal(result.status, 0, `Step 3 exited with ${result.status}: ${result.stderr}`);
    assert.ok(existsSync(captureFile), 'curl stub did not receive a request');

    const capture = JSON.parse(readFileSync(captureFile, 'utf8'));
    const nodeArgs = existsSync(nodeCaptureFile)
      ? readFileSync(nodeCaptureFile, 'utf8').split('\0').filter(Boolean)
      : [];

    return { capture, nodeArgs };
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

const step3Bash = extractStep3Bash(readFileSync(SKILL_FILE, 'utf8'));

for (const fixture of cases) {
  test(`Step 3 preserves ${fixture.name} through JSON transport`, () => {
    const { capture, nodeArgs } = runStep3(step3Bash, fixture);

    let payload;
    try {
      payload = JSON.parse(capture.body);
    } catch (error) {
      assert.fail(`Step 3 did not send valid JSON: ${error.message}\n${capture.body}`);
    }

    assert.deepEqual(payload, {
      message: fixture.message,
      signature: fixture.signature,
    });
    assert.ok(
      capture.argv.includes(`${BASE_URL}/auth/siwe/login`),
      'Step 3 must still call the login endpoint',
    );
    assert.ok(capture.argv.includes('--data-binary') && capture.argv.includes('@-'), 'payload must come from stdin');
    assert.ok(!capture.argv.some((arg) => arg.includes(fixture.message)), 'message leaked into curl argv');
    assert.ok(!capture.argv.some((arg) => arg.includes(fixture.signature)), 'signature leaked into curl argv');
    assert.ok(!nodeArgs.some((arg) => arg.includes(fixture.message)), 'message leaked into node argv');
    assert.ok(!nodeArgs.some((arg) => arg.includes(fixture.signature)), 'signature leaked into node argv');
  });
}

after(() => {
  rmSync(RUN_ROOT, { recursive: true, force: true });
});
