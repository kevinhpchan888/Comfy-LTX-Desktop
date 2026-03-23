# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LTX Desktop is an Electron app for AI video generation using LTX models. Three-layer architecture:

- **Frontend** (`frontend/`): React 18 + TypeScript + Tailwind CSS renderer
- **Electron** (`electron/`): Main process managing app lifecycle, IPC, Python backend process, ffmpeg export
- **Backend** (`backend/`): Python FastAPI server (port 8000) handling ML model orchestration and generation

## Common Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server (Vite + Electron + Python backend) |
| `pnpm dev:debug` | Dev with Electron inspector + Python debugpy |
| `pnpm typecheck` | Run TypeScript (`tsc --noEmit`) and Python (`pyright`) type checks |
| `pnpm typecheck:ts` | TypeScript only |
| `pnpm typecheck:py` | Python pyright only |
| `pnpm backend:test` | Run Python pytest tests |
| `pnpm build:frontend` | Vite frontend build only |
| `pnpm build:mac` / `pnpm build:win` | Full platform builds |
| `pnpm setup:dev:mac` / `pnpm setup:dev:win` | One-time dev environment setup |

Run a single backend test: `cd backend && uv run pytest tests/test_generation.py -v --tb=short`

## CI Checks

PRs must pass: `pnpm typecheck` + `pnpm backend:test` + frontend Vite build.

## Frontend Architecture

- **Path alias**: `@/*` maps to `frontend/*`
- **State management**: React contexts only (`ProjectContext`, `AppSettingsContext`, `KeyboardShortcutsContext`) — no Redux/Zustand
- **Routing**: View-based via `ProjectContext` with views: `home`, `project`, `playground`
- **IPC bridge**: All Electron communication through `window.electronAPI` (defined in `electron/preload.ts`)
- **Backend calls**: Frontend calls `http://localhost:8000` directly
- **Styling**: Tailwind with custom semantic color tokens via CSS variables; utilities from `class-variance-authority` + `clsx` + `tailwind-merge`
- **No frontend tests** currently exist

## Backend Architecture

Request flow: `_routes/* (thin) → AppHandler → handlers/* (logic) → services/* (side effects) + state/* (mutations)`

Key patterns:
- **Routes** (`_routes/`): Thin plumbing only — parse input, call handler, return typed output. No business logic.
- **AppHandler** (`app_handler.py`): Single composition root owning all sub-handlers, state, and lock
- **State** (`state/`): Centralized `AppState` using discriminated union types for state machines (e.g., `GenerationState = GenerationRunning | GenerationComplete | GenerationError | GenerationCancelled`)
- **Services** (`services/`): Protocol interfaces with real implementations and fake test implementations. The test boundary for heavy side effects (GPU, network).
- **Concurrency**: Thread pool with shared `RLock`. Pattern: lock→read/validate→unlock→heavy work→lock→write. Never hold lock during heavy compute/IO.
- **Exception handling**: Boundary-owned traceback policy. Handlers raise `HTTPError` with `from exc` chaining; `app_factory.py` owns logging. Don't `logger.exception()` then rethrow.
- **Naming**: `*Payload` for DTOs/TypedDicts, `*Like` for structural wrappers, `Fake*` for test implementations

### Backend Testing

- Integration-first using Starlette `TestClient` against real FastAPI app
- **No mocks**: `test_no_mock_usage.py` enforces no `unittest.mock`. Swap services via `ServiceBundle` fakes only.
- Fakes live in `tests/fakes/`; `conftest.py` wires fresh `AppHandler` per test
- Pyright strict mode is also enforced as a test (`test_pyright.py`)

### Adding a Backend Feature

1. Define request/response models in `api_types.py`
2. Add endpoint in `_routes/<domain>.py` delegating to handler
3. Implement logic in `handlers/<domain>_handler.py` with lock-aware state transitions
4. If new heavy side effect needed, add service in `services/` with Protocol + real + fake implementations
5. Add integration test in `tests/` using fake services

## TypeScript Config

- Strict mode with `noUnusedLocals`, `noUnusedParameters`
- Frontend: ES2020 target, React JSX
- Electron main process: ESNext, compiled to `dist-electron/`
- Preload script must be CommonJS

## Python Config

- Python 3.13+ (per `.python-version`), managed with `uv`
- Pyright strict mode (`backend/pyrightconfig.json`)
- Dependencies in `backend/pyproject.toml`

## MCP Server — Claude Code ↔ LTX Desktop

An MCP server (`mcp-server/`) bridges Claude Code to the LTX Desktop backend, enabling autonomous video production.

### Setup

The server is auto-registered in `.claude/settings.json`. Requirements:
1. LTX Desktop must be running (`pnpm dev`) so the backend is on port 8000
2. Install MCP deps: `cd mcp-server && uv sync`

### Available MCP Tools

| Tool | Purpose |
|---|---|
| `health_check` | Verify backend is running |
| `get_gpu_info` | GPU name, VRAM total/used/free |
| `get_models_status` | Check model downloads |
| `get_settings` / `update_settings` | Read/write backend config |
| `generate_video` | Trigger video generation (blocking) |
| `generate_video_and_wait` | Generate + poll progress until done |
| `generate_image` | Generate still image (for first-frame conditioning) |
| `get_generation_progress` | Poll generation progress |
| `cancel_generation` | Cancel current generation |
| `factory_batch_generate` | Run multiple shots sequentially |
| `retry_failed_shot` | Auto-adjust params and retry on failure |
| `inspect_video_file` | Check output file exists + metadata |
| `inspect_image_file` | Read image as base64 for visual review |
| `list_output_files` | List generated files in a directory |
| `suggest_gap_prompt` | AI-suggested transition prompts |
| `list_ic_lora_models` | Available IC-LoRA style models |
| `get_factory_status` | Read factory pipeline status + errors |
| `diagnose_factory_errors` | Categorize errors and suggest fixes |
| `watch_factory_errors` | Poll for new errors during batch ops |
| `get_remotion_requests` | Read pending Remotion motion graphic requests |
| `complete_remotion_request` | Mark a Remotion request as done after rendering |

### Autonomous Production Workflow

When asked to produce a video sequence, follow this loop:
1. `health_check` → verify backend is up
2. `get_gpu_info` → determine safe resolution/duration
3. `factory_batch_generate` → run all shots
4. For failures: read the error, use `retry_failed_shot` (auto-adjusts params)
5. `inspect_video_file` → verify outputs exist
6. `list_output_files` → inventory final deliverables

### Proactive Error Monitoring

The frontend writes `.factory-status.json` to `<project>/factory/` whenever shot states change.
Use the MCP monitoring tools to detect and fix errors automatically:

1. `get_factory_status` → read current shot counts and any errors
2. `diagnose_factory_errors` → categorize errors (OOM, connection, timeout, IPC) and get fix suggestions
3. `watch_factory_errors` → poll during batch operations, returns immediately when new errors appear

**Self-healing rules:**
- OOM → reduce resolution or duration, retry
- Timeout → switch to 'fast' model, retry
- IPC "reply never sent" → transient WebSocket drop, retry the shot
- Connection refused → inform user to restart LTX Desktop
- Missing node → inform user to restart ComfyUI

**Self-healing rules:**
- OOM → reduce resolution or duration, retry
- Timeout → switch to 'fast' model, retry
- Backend down → inform user to start LTX Desktop

## Key File Locations

- Backend architecture doc: `backend/architecture.md`
- Default app settings schema: `settings.json`
- Electron builder config: `electron-builder.yml`
- Video editor (largest frontend file): `frontend/views/VideoEditor.tsx`
- Project types: `frontend/types/project.ts`
- MCP server: `mcp-server/ltx_mcp_server.py`
