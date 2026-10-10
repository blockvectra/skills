# BlockVectra skills

Agent Skills for [BlockVectra](https://docs.blockvectra.com/en/guides/ai-agents/?ref=skills): keyless multi-chain RPC, the Data API, programmatic sign-up and pricing.

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
| [`blockvectra-rpc`](blockvectra-rpc/SKILL.md) | EVM JSON-RPC and Data API calls, the keyless public endpoint, wallet-signature sign-up, error handling, pricing lookup and USDT/USDC top-up |

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
