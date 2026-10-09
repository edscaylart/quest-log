# Agents

Read first, in this order:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the app map, the folder and import rules, the decision index and every doc. The rules live there only.
2. [docs/CONTEXT.md](docs/CONTEXT.md): the domain glossary and rules. Use its canonical terms in code, issues and tests, never the RPG labels.
3. [docs/DATABASE.md](docs/DATABASE.md): before touching the schema or `src-tauri/migrations/`.
4. [docs/TESTING.md](docs/TESTING.md): how to test each side and which file covers what.
5. [docs/ENV.md](docs/ENV.md): toolchain and commands.

## Agent skills

- **Issue tracker:** GitHub Issues on `edscaylart/quest-log`, via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- **Domain docs:** single-context, `docs/CONTEXT.md` + `docs/adr/`. See [docs/agents/domain.md](docs/agents/domain.md).

## Pointers

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/CONTEXT.md](docs/CONTEXT.md)
- [docs/TESTING.md](docs/TESTING.md)
- [README.md](README.md)
