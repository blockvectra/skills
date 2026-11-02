# BlockVectra skills

Agent Skills for [BlockVectra](https://docs.blockvectra.com/en/guides/ai-agents/?ref=skills): multi-chain EVM RPC, the Data API, programmatic sign-up and pricing.

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

One command (uses the [`skills`](https://github.com/vercel-labs/skills) CLI (npm package `skills`); add `-g` for a user-level install, `-a claude-code` to pick the agent, `-y` to skip prompts):

```bash
npx skills add blockvectra/skills
```

Or as a Claude Code plugin, together with the docs MCP server:

```text
/plugin marketplace add blockvectra/mcp
/plugin install blockvectra-docs@blockvectra
```

## Skills

| Skill | Use it for |
| --- | --- |
| [`blockvectra-rpc`](blockvectra-rpc/SKILL.md) | EVM JSON-RPC and Data API calls, per-chain public access and limits, wallet-signature sign-up, error handling, pricing lookup and USDT/USDC top-up |
| [`blockvectra-signup`](blockvectra-signup/SKILL.md) | Obtain a BlockVectra API key without a browser: wallet-signature (SIWE/EIP-191) sign-up, first-login account creation with free CU grant, create and revoke API keys programmatically |

The skill reads chains, limits and prices from live endpoints instead of copying numbers, so it does not go stale.

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

```bash
claude mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp
```

## License

MIT
