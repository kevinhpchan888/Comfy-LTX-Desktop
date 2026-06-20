# Agent Startup Packet

Project: Comfy-LTX-Desktop
Path: C:\Users\Kevin Chan\Documents\GitHub\Comfy-LTX-Desktop
Generated: 2026-06-20T09:39:16.869Z
Intended agent: all

## First Rule

Read this packet before making substantial changes. Treat .ai-memory as the portable source of project context across Claude, Codex, and Hermes.

## Current Memory Health

- Cognee-style semantic index: 260 chunks, 220 entities
- Graphiti-style temporal graph: 450 relations, 1 episodes
- Source hash: a77a84f2f4343f1803ab3bc25c94e402bad4c897da361ce41609e7781b6767b7

## Important Files

- .ai-memory/CONTEXT_INDEX.json: .ai-memory/CONTEXT_INDEX.json
- .ai-memory/DECISIONS.md: Decisions
- .ai-memory/events/2026-06-20.jsonl: .ai-memory/events/2026-06-20.jsonl
- .ai-memory/HANDOFF.md: Handoff
- .ai-memory/PROJECT.md: Comfy-LTX-Desktop
- .ai-memory/RULES.md: Agent Rules
- .ai-memory/STATUS.md: Status
- .ai-memory/TASKS.md: Tasks
- .github/workflows/ci.yml: .github/workflows/ci.yml
- .vscode/launch.json: .vscode/launch.json
- .vscode/tasks.json: .vscode/tasks.json
- AGENTS.md: CLAUDE.md

## Important Entities

- None (concept, 76 mentions)
- True (concept, 54 mentions)
- React (concept, 51 mentions)
- False (concept, 40 mentions)
- Math (concept, 39 mentions)
- ============================================================ (section, 32 mentions)
- Path (concept, 32 mentions)
- Video (concept, 32 mentions)
- ERROR (concept, 31 mentions)
- Failed (concept, 29 mentions)
- Exception (concept, 27 mentions)
- Promise (concept, 27 mentions)
- Image (concept, 25 mentions)
- ComfyUI (concept, 23 mentions)
- TimelineClip (concept, 23 mentions)
- Record (concept, 20 mentions)
- Track (concept, 20 mentions)
- AppState (concept, 19 mentions)

## Decisions And Rules Found

- "role": "always-on coordinator",
- "reveal": "always",
- PRs must pass: `pnpm typecheck` + `pnpm backend:test` + frontend Vite build.
- Concurrency**: Thread pool with shared `RLock`. Pattern: lock→read/validate→unlock→heavy work→lock→write. Never hold lock during heavy compute/IO.
- Preload script must be CommonJS
- All state access/mutation must be done with extra care.** The shared lock exists to prevent race conditions and torn
- Never assume the state stayed the same across `lock → heavy work → lock`.
- If a heavy side effect must be avoided in tests, it should be avoided **only** by introducing (or using) a service.
- Do not mock/patch routes, `AppHandler`, or handlers.
- Must NOT match Depends(...), Form(...), File(...), or bare handler params
- raise ValueError("Settings payload must be a JSON object")
- raise HTTPError(400, "duration must be at least 2 seconds")

## Open Tasks Found

- Add current project tasks.

## API Routes Found

- No API routes indexed yet.

## Packages Found

- No package manifest indexed yet.

## Recent Memory Events

- 2026-06-20T09:39:16.659Z: memory_initialized

## Agent Instructions

- Claude Code: use this packet when resuming the project after a switch or context reset.
- Codex: use this packet as the starting context when Comfy-LTX-Desktop is opened locally.
- Hermes: use this packet for routing, monitoring, and handoff decisions. Do not treat it as a replacement for the repo.
- If the packet is stale or missing, rebuild Semantic Memory from AI Sync Console before starting work.
