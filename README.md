# BlockVectra skills

Agent Skills for [BlockVectra](https://docs.blockvectra.com/en/guides/ai-agents/?ref=skills): documentation search, multi-chain EVM RPC, the Data API, programmatic sign-up and pricing.

Keyless RPC availability, methods and limits follow each chain's `public` policy in [`GET /v1/chains`](https://api.blockvectra.com/v1/chains). The Data API requires an API key.

## Try a keyless read first

Before installing a skill or configuring an MCP client, try the [fixed-version TypeScript reader](https://github.com/blockvectra/agent-quickstart/releases/tag/keyless-read-node22-2026.11.02). With Node.js 22 (>=22.18) or Node.js >=24.12, and Git:

```bash
git clone --branch keyless-read-node22-2026.11.02 --depth 1 https://github.com/blockvectra/agent-quickstart.git
cd agent-quickstart
node src/public-read-cli.ts
```

No dependency installation, wallet, account or API key is needed. It checks the live chain directory before verifying Robinhood mainnet's chain ID and reading its latest block number, with at most three HTTP requests including two RPC calls. It stops before RPC if the directory does not advertise the required public endpoint and methods. The Data API still needs an API key.

## Install

For documentation questions, install only the documentation skill:

```bash
npx skills add blockvectra/skills --skill blockvectra-docs
```

Then add the [docs-only MCP connection](#docs-mcp-server); installing the skill does not configure a server.

In Claude Code, you can also connect the two documentation tools with the docs-only MCP plugin:

```text
/plugin marketplace add blockvectra/mcp
/plugin install blockvectra-docs-only@blockvectra
```

To install all three skills, use the [`skills`](https://github.com/vercel-labs/skills) CLI (add `-g` for a user-level install, `-a claude-code` to pick the agent, `-y` to skip prompts):

```bash
npx skills add blockvectra/skills
```

For the RPC skill together with the full MCP server, use the separate Claude Code plugin:

```text
/plugin marketplace add blockvectra/mcp
/plugin install blockvectra-docs@blockvectra
```

## Skills

| Skill | Use it for |
| --- | --- |
| [`blockvectra-docs`](blockvectra-docs/SKILL.md) | Search and read documentation through the hosted docs-only MCP endpoint; no BlockVectra account or API key |
| [`blockvectra-rpc`](blockvectra-rpc/SKILL.md) | EVM JSON-RPC and Data API calls, per-chain public access and limits, wallet-signature sign-up, error handling, pricing lookup and USDT/USDC top-up |
| [`blockvectra-signup`](blockvectra-signup/SKILL.md) | Obtain a BlockVectra API key without a browser: wallet-signature (SIWE/EIP-191) sign-up, first-login account creation with free CU grant, create and revoke API keys programmatically |

For live API tasks, the RPC skill reads chains, limits and prices from live endpoints instead of copying numbers.

## Manual install

Skills are directories with a `SKILL.md` file. Per the [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview):

- **Claude Code**: place the skill directory in `~/.claude/skills/` (personal) or `.claude/skills/` (project). See [Use Skills in Claude Code](https://code.claude.com/docs/en/skills).

  ```bash
  git clone https://github.com/blockvectra/skills.git
  mkdir -p ~/.claude/skills
  cp -r skills/blockvectra-rpc ~/.claude/skills/
  ```

- **claude.ai**: upload the skill as a zip file under Settings > Features (paid plans with code execution enabled; see the overview above for details). Zip the `blockvectra-rpc` folder.
- **Claude API**: upload through the Skills API (`/v1/skills` endpoints). Skills on the API run without network access, so the live lookups in this skill need an environment with network access, such as Claude Code.

Other agents that read `SKILL.md` directories can use the same folder; check that tool's documentation for its skills path.

## Docs MCP server

For documentation search and reading, connect the **docs-only** endpoint. It exposes `search_docs` and `read_doc`, with no BlockVectra account, API key, or local bridge:

```bash
claude mcp add --transport http blockvectra-docs-only https://docs.blockvectra.com/mcp/docs
```

Installing a skill does not add an MCP connection automatically. After connecting, ask the client to search for a task and read a matching page. See the [docs skill](blockvectra-docs/SKILL.md) for the workflow.

For the broader documentation, API discovery, and estimation tools, the existing **full-server** connection remains available:

```bash
claude mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp
```

The `blockvectra-docs@blockvectra` plugin configures the full server; `blockvectra-docs-only@blockvectra` configures the docs-only server. Both connections can coexist under these distinct names.

## License

MIT
