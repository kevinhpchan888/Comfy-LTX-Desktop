"""
MCP Server for Claude Code → LTX Desktop communication.

Wraps the LTX Desktop FastAPI backend (localhost:8000) as MCP tools,
enabling Claude Code to autonomously generate video, monitor progress,
inspect results, and self-correct on errors.

Usage:
    cd mcp-server && uv run ltx_mcp_server.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

# ─── Configuration ────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("LTX_BACKEND_URL", "http://localhost:8000")
REQUEST_TIMEOUT = float(os.environ.get("LTX_REQUEST_TIMEOUT", "30"))
GENERATION_TIMEOUT = float(os.environ.get("LTX_GENERATION_TIMEOUT", "600"))

mcp = FastMCP(
    "LTX Desktop",
    instructions=(
        "Control LTX Desktop for AI video generation. "
        "Use these tools to generate videos, monitor progress, inspect results, "
        "and autonomously manage a production pipeline. "
        "When a generation fails, read the error, adjust parameters, and retry."
    ),
)

# ─── HTTP Client ──────────────────────────────────────────────────────────────


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BACKEND_URL, timeout=REQUEST_TIMEOUT)


async def _get(path: str) -> dict[str, Any]:
    async with _client() as client:
        resp = await client.get(path)
        resp.raise_for_status()
        result: dict[str, Any] = resp.json()
        return result


async def _post(path: str, body: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
    async with _client() as client:
        resp = await client.post(path, json=body or {}, timeout=timeout or REQUEST_TIMEOUT)
        resp.raise_for_status()
        result: dict[str, Any] = resp.json()
        return result


# ─── System Tools ─────────────────────────────────────────────────────────────


@mcp.tool()
async def health_check() -> str:
    """Check if LTX Desktop backend is running and responsive.
    Returns backend status, loaded models, GPU info, and SageAttention status.
    Call this first to verify the backend is available before generating."""
    try:
        data = await _get("/health")
        return json.dumps(data, indent=2)
    except httpx.ConnectError:
        return json.dumps({
            "error": "Backend not reachable",
            "hint": "Start LTX Desktop or run the backend manually. The backend runs on port 8000.",
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def get_gpu_info() -> str:
    """Get detailed GPU information: CUDA availability, GPU name, VRAM total/used.
    Use this to determine safe generation parameters (resolution, checkpoint).
    If VRAM is low, use lower resolution or quantized checkpoints."""
    try:
        data = await _get("/api/gpu-info")
        # Enrich with utilization percentage
        gpu = data.get("gpu_info", {})
        vram_total = gpu.get("vram", 0)
        vram_used = gpu.get("vramUsed", 0)
        if vram_total > 0:
            data["vram_utilization_pct"] = round(vram_used / vram_total * 100, 1)
            data["vram_free_mb"] = vram_total - vram_used
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def get_models_status() -> str:
    """Get status of all required model files: which are downloaded, sizes, and paths.
    Check this before generating to ensure models are available."""
    try:
        data = await _get("/api/models/status")
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def get_settings() -> str:
    """Get current LTX Desktop backend settings (checkpoint, sampler, steps, etc).
    Useful for understanding current configuration before generating."""
    try:
        data = await _get("/api/settings")
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def update_settings(settings: dict[str, Any]) -> str:
    """Update LTX Desktop backend settings.

    Args:
        settings: Key-value pairs to update. Common keys:
            - checkpoint: Model checkpoint filename
            - steps: Number of inference steps (8-30)
            - cfg: CFG guidance scale (1.0-7.0, higher = more robotic)
            - sampler: 'euler' or 'euler_ancestral'
    """
    try:
        data = await _post("/api/settings", settings)
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── Generation Tools ─────────────────────────────────────────────────────────


@mcp.tool()
async def generate_video(
    prompt: str,
    duration: str = "5",
    resolution: str = "512p",
    fps: str = "24",
    aspect_ratio: str = "16:9",
    camera_motion: str = "none",
    image_path: str | None = None,
    negative_prompt: str = "",
    model: str = "fast",
) -> str:
    """Generate a video using LTX. This is a BLOCKING call that waits for completion.

    Args:
        prompt: Text description of the video to generate. Be specific and detailed.
        duration: Duration in seconds ('2', '5', '10'). Default '5'.
        resolution: Video resolution ('512p', '720p', '1080p'). Lower = faster + less VRAM.
        fps: Frames per second ('24' standard). Default '24'.
        aspect_ratio: '16:9' (landscape) or '9:16' (portrait). Default '16:9'.
        camera_motion: Camera movement type. Options: 'none', 'dolly_in', 'dolly_out',
            'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'static', 'focus_shift'.
        image_path: Optional path to a conditioning image for image-to-video generation.
        negative_prompt: What to avoid in the generation.
        model: 'fast' (distilled, 8 steps) or 'pro' (dev, 20 steps). Default 'fast'.

    Returns:
        JSON with status, video_path on success, or error details on failure.
        If OOM, retry with lower resolution. If quality is poor, try 'pro' model.
    """
    body: dict[str, Any] = {
        "prompt": prompt,
        "duration": str(duration),
        "resolution": resolution,
        "fps": str(fps),
        "aspectRatio": aspect_ratio,
        "cameraMotion": camera_motion,
        "negativePrompt": negative_prompt,
        "model": model,
    }
    if image_path:
        body["imagePath"] = image_path

    try:
        data = await _post("/api/generate", body, timeout=GENERATION_TIMEOUT)
        return json.dumps(data, indent=2)
    except httpx.ReadTimeout:
        return json.dumps({
            "error": "Generation timed out",
            "hint": f"Timeout was {GENERATION_TIMEOUT}s. Try shorter duration or lower resolution.",
        })
    except Exception as e:
        error_str = str(e)
        result: dict[str, Any] = {"error": error_str}
        if "CUDA out of memory" in error_str or "OutOfMemoryError" in error_str:
            result["hint"] = "OOM: reduce resolution, use shorter duration, or switch to quantized checkpoint."
        return json.dumps(result)


@mcp.tool()
async def generate_image(
    prompt: str,
    width: int = 1024,
    height: int = 1024,
    num_steps: int = 4,
    num_images: int = 1,
) -> str:
    """Generate a still image (e.g., for first-frame conditioning before video generation).

    Args:
        prompt: Text description of the image.
        width: Image width in pixels. Default 1024.
        height: Image height in pixels. Default 1024.
        num_steps: Number of inference steps. Default 4.
        num_images: Number of images to generate. Default 1.

    Returns:
        JSON with status and image_paths list on success.
    """
    body = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "numSteps": num_steps,
        "numImages": num_images,
    }
    try:
        data = await _post("/api/generate-image", body, timeout=GENERATION_TIMEOUT)
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def get_generation_progress() -> str:
    """Poll the current generation progress.
    Returns status ('idle', 'running', 'complete', 'cancelled', 'error'),
    phase, progress percentage, and step counts.
    Call this in a loop while waiting for generation to finish."""
    try:
        data = await _get("/api/generation/progress")
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
async def cancel_generation() -> str:
    """Cancel the currently running generation.
    Use when a generation is taking too long or you want to retry with different params."""
    try:
        data = await _post("/api/generate/cancel")
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── Generation with Progress Polling ─────────────────────────────────────────


@mcp.tool()
async def generate_video_and_wait(
    prompt: str,
    duration: str = "5",
    resolution: str = "512p",
    fps: str = "24",
    aspect_ratio: str = "16:9",
    camera_motion: str = "none",
    image_path: str | None = None,
    negative_prompt: str = "",
    model: str = "fast",
    poll_interval: float = 3.0,
) -> str:
    """Generate a video and poll progress until completion. Best for autonomous workflows.

    Same parameters as generate_video, plus:
    Args:
        poll_interval: Seconds between progress checks. Default 3.0.

    Returns comprehensive result with timing info and final status.
    """
    body: dict[str, Any] = {
        "prompt": prompt,
        "duration": str(duration),
        "resolution": resolution,
        "fps": str(fps),
        "aspectRatio": aspect_ratio,
        "cameraMotion": camera_motion,
        "negativePrompt": negative_prompt,
        "model": model,
    }
    if image_path:
        body["imagePath"] = image_path

    start_time = time.time()

    try:
        # Start generation (non-blocking — backend runs it in background thread)
        gen_result = await _post("/api/generate", body, timeout=GENERATION_TIMEOUT)

        # If the backend returns immediately with a video_path, it completed synchronously
        if gen_result.get("video_path"):
            elapsed = round(time.time() - start_time, 1)
            gen_result["elapsed_seconds"] = elapsed
            return json.dumps(gen_result, indent=2)

        # Poll for progress
        deadline = start_time + GENERATION_TIMEOUT
        last_progress = -1

        while time.time() < deadline:
            await asyncio.sleep(poll_interval)
            try:
                progress = await _get("/api/generation/progress")
            except Exception:
                continue

            status = progress.get("status", "")
            current_progress = progress.get("progress", 0)

            if status == "complete" or status == "idle":
                # Generation finished — the generate call may have returned the path
                elapsed = round(time.time() - start_time, 1)
                return json.dumps({
                    "status": "complete",
                    "elapsed_seconds": elapsed,
                    "final_progress": progress,
                    "generation_result": gen_result,
                }, indent=2)

            if status in ("error", "cancelled"):
                elapsed = round(time.time() - start_time, 1)
                return json.dumps({
                    "status": status,
                    "elapsed_seconds": elapsed,
                    "progress": progress,
                    "generation_result": gen_result,
                }, indent=2)

            last_progress = current_progress

        return json.dumps({
            "error": "Generation timed out during polling",
            "elapsed_seconds": round(time.time() - start_time, 1),
            "last_progress": last_progress,
        })

    except Exception as e:
        error_str = str(e)
        result: dict[str, Any] = {
            "error": error_str,
            "elapsed_seconds": round(time.time() - start_time, 1),
        }
        if "CUDA out of memory" in error_str or "OutOfMemoryError" in error_str:
            result["hint"] = "OOM: reduce resolution, use shorter duration, or switch to quantized checkpoint."
        return json.dumps(result)


# ─── Result Inspection Tools ──────────────────────────────────────────────────


@mcp.tool()
async def inspect_video_file(video_path: str) -> str:
    """Inspect a generated video file: check existence, size, and basic metadata.

    Args:
        video_path: Absolute path to the video file.

    Returns file existence, size in MB, and modification time.
    Useful for verifying a generation actually produced output.
    """
    p = Path(video_path)
    if not p.exists():
        return json.dumps({"error": f"File not found: {video_path}"})

    stat = p.stat()
    return json.dumps({
        "exists": True,
        "path": str(p.resolve()),
        "size_mb": round(stat.st_size / (1024 * 1024), 2),
        "modified": time.ctime(stat.st_mtime),
        "extension": p.suffix,
    }, indent=2)


@mcp.tool()
async def inspect_image_file(image_path: str) -> str:
    """Inspect and return a generated image as base64 for visual review.

    Args:
        image_path: Absolute path to the image file (PNG, JPG, etc).

    Returns image metadata and base64-encoded content for Claude to visually inspect.
    Images larger than 5MB are returned as metadata-only.
    """
    p = Path(image_path)
    if not p.exists():
        return json.dumps({"error": f"File not found: {image_path}"})

    stat = p.stat()
    size_mb = stat.st_size / (1024 * 1024)

    result: dict[str, Any] = {
        "exists": True,
        "path": str(p.resolve()),
        "size_mb": round(size_mb, 2),
        "modified": time.ctime(stat.st_mtime),
        "extension": p.suffix,
    }

    if size_mb <= 5:
        data = p.read_bytes()
        ext = p.suffix.lower()
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}.get(
            ext.lstrip("."), "application/octet-stream"
        )
        result["base64"] = base64.b64encode(data).decode()
        result["mime_type"] = mime
    else:
        result["note"] = "File too large for base64 encoding"

    return json.dumps(result, indent=2)


@mcp.tool()
async def list_output_files(directory: str, pattern: str = "*.mp4") -> str:
    """List generated output files in a directory.

    Args:
        directory: Directory path to scan.
        pattern: Glob pattern for files. Default '*.mp4'. Use '*.png' for images.

    Returns sorted list of matching files with sizes and timestamps.
    """
    p = Path(directory)
    if not p.is_dir():
        return json.dumps({"error": f"Directory not found: {directory}"})

    files = sorted(p.glob(pattern), key=lambda f: f.stat().st_mtime, reverse=True)
    result = []
    for f in files[:50]:  # Cap at 50 files
        stat = f.stat()
        result.append({
            "name": f.name,
            "path": str(f.resolve()),
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "modified": time.ctime(stat.st_mtime),
        })

    return json.dumps({"directory": str(p), "count": len(result), "files": result}, indent=2)


# ─── Factory / Batch Tools ───────────────────────────────────────────────────


@mcp.tool()
async def factory_batch_generate(
    shots: list[dict[str, Any]],
    default_resolution: str = "512p",
    default_duration: str = "5",
    default_model: str = "fast",
    delay_between_shots: float = 2.0,
) -> str:
    """Run a batch of video generations sequentially (factory production mode).

    Args:
        shots: List of shot definitions, each with:
            - id: Shot identifier (e.g. 'A1-01')
            - prompt: Video generation prompt
            - duration: Optional override for duration
            - resolution: Optional override for resolution
            - camera_motion: Optional camera motion
            - image_path: Optional conditioning image
        default_resolution: Fallback resolution for shots without override.
        default_duration: Fallback duration for shots without override.
        default_model: 'fast' or 'pro'. Default 'fast'.
        delay_between_shots: Seconds to wait between generations (GPU cooldown).

    Returns a results array with per-shot status, paths, timings, and any errors.
    On error, includes diagnostic hints so you can fix and retry individual shots.
    """
    results: list[dict[str, Any]] = []
    total_start = time.time()

    for i, shot in enumerate(shots):
        shot_id = shot.get("id", f"shot-{i}")
        shot_prompt = shot.get("prompt", "")
        if not shot_prompt:
            results.append({"id": shot_id, "status": "skipped", "reason": "empty prompt"})
            continue

        shot_start = time.time()
        body: dict[str, Any] = {
            "prompt": shot_prompt,
            "duration": str(shot.get("duration", default_duration)),
            "resolution": shot.get("resolution", default_resolution),
            "fps": str(shot.get("fps", "24")),
            "aspectRatio": shot.get("aspect_ratio", "16:9"),
            "cameraMotion": shot.get("camera_motion", "none"),
            "negativePrompt": shot.get("negative_prompt", ""),
            "model": shot.get("model", default_model),
        }
        if shot.get("image_path"):
            body["imagePath"] = shot["image_path"]

        try:
            data = await _post("/api/generate", body, timeout=GENERATION_TIMEOUT)
            elapsed = round(time.time() - shot_start, 1)

            if data.get("video_path"):
                results.append({
                    "id": shot_id,
                    "status": "complete",
                    "video_path": data["video_path"],
                    "elapsed_seconds": elapsed,
                })
            else:
                # Generation started but returned immediately — poll for completion
                deadline = time.time() + GENERATION_TIMEOUT
                while time.time() < deadline:
                    await asyncio.sleep(3.0)
                    try:
                        progress = await _get("/api/generation/progress")
                    except Exception:
                        continue

                    if progress.get("status") in ("complete", "idle"):
                        elapsed = round(time.time() - shot_start, 1)
                        results.append({
                            "id": shot_id,
                            "status": "complete",
                            "elapsed_seconds": elapsed,
                            "generation_result": data,
                        })
                        break
                    elif progress.get("status") in ("error", "cancelled"):
                        elapsed = round(time.time() - shot_start, 1)
                        results.append({
                            "id": shot_id,
                            "status": progress["status"],
                            "elapsed_seconds": elapsed,
                            "error": progress.get("phase", "unknown error"),
                        })
                        break
                else:
                    results.append({
                        "id": shot_id,
                        "status": "timeout",
                        "elapsed_seconds": round(time.time() - shot_start, 1),
                    })

        except Exception as e:
            elapsed = round(time.time() - shot_start, 1)
            error_str = str(e)
            entry: dict[str, Any] = {
                "id": shot_id,
                "status": "error",
                "error": error_str,
                "elapsed_seconds": elapsed,
            }
            if "CUDA out of memory" in error_str:
                entry["hint"] = "OOM: reduce resolution or duration for this shot"
            results.append(entry)

        # Delay between shots for GPU cooldown
        if i < len(shots) - 1 and delay_between_shots > 0:
            await asyncio.sleep(delay_between_shots)

    total_elapsed = round(time.time() - total_start, 1)
    completed = sum(1 for r in results if r["status"] == "complete")
    failed = sum(1 for r in results if r["status"] in ("error", "timeout"))

    return json.dumps({
        "summary": {
            "total": len(shots),
            "completed": completed,
            "failed": failed,
            "skipped": len(shots) - completed - failed,
            "total_elapsed_seconds": total_elapsed,
        },
        "results": results,
    }, indent=2)


@mcp.tool()
async def retry_failed_shot(
    prompt: str,
    original_error: str,
    resolution: str = "512p",
    duration: str = "5",
    model: str = "fast",
    camera_motion: str = "none",
    image_path: str | None = None,
) -> str:
    """Retry a single failed shot with automatic parameter adjustment based on the error.

    Args:
        prompt: The original or revised prompt.
        original_error: The error message from the previous attempt.
        resolution: Resolution to use (may be auto-lowered on OOM).
        duration: Duration to use (may be auto-shortened on OOM).
        model: 'fast' or 'pro'.
        camera_motion: Camera motion type.
        image_path: Optional conditioning image path.

    Automatically adjusts parameters based on error type:
    - OOM → reduces resolution and duration
    - Timeout → switches to 'fast' model
    """
    # Auto-adjust based on error
    adjusted_resolution = resolution
    adjusted_duration = duration
    adjusted_model = model
    adjustments: list[str] = []

    if "out of memory" in original_error.lower() or "oom" in original_error.lower():
        res_downgrade = {"1080p": "720p", "720p": "512p", "512p": "480p"}
        if resolution in res_downgrade:
            adjusted_resolution = res_downgrade[resolution]
            adjustments.append(f"resolution {resolution} → {adjusted_resolution}")
        dur_downgrade = {"10": "5", "5": "2"}
        if duration in dur_downgrade:
            adjusted_duration = dur_downgrade[duration]
            adjustments.append(f"duration {duration}s → {adjusted_duration}s")

    if "timeout" in original_error.lower():
        if model == "pro":
            adjusted_model = "fast"
            adjustments.append("model pro → fast")

    body: dict[str, Any] = {
        "prompt": prompt,
        "duration": adjusted_duration,
        "resolution": adjusted_resolution,
        "fps": "24",
        "aspectRatio": "16:9",
        "cameraMotion": camera_motion,
        "negativePrompt": "",
        "model": adjusted_model,
    }
    if image_path:
        body["imagePath"] = image_path

    try:
        data = await _post("/api/generate", body, timeout=GENERATION_TIMEOUT)
        data["adjustments"] = adjustments
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({
            "error": str(e),
            "adjustments_attempted": adjustments,
            "hint": "Consider further reducing parameters or checking GPU health.",
        })


# ─── IC-LoRA Tools ────────────────────────────────────────────────────────────


@mcp.tool()
async def list_ic_lora_models() -> str:
    """List available IC-LoRA (Image Conditioning LoRA) models.
    These allow style/structure transfer from reference images."""
    try:
        data = await _get("/api/ic-lora/list-models")
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── Prompt Enhancement ──────────────────────────────────────────────────────


@mcp.tool()
async def suggest_gap_prompt(
    before_prompt: str = "",
    after_prompt: str = "",
    gap_duration: float = 5.0,
) -> str:
    """Get an AI-suggested prompt for a transition between two shots.

    Args:
        before_prompt: Prompt/description of the preceding shot.
        after_prompt: Prompt/description of the following shot.
        gap_duration: Duration of the gap to fill, in seconds.

    Returns a suggested prompt for smooth visual continuity between shots.
    """
    body = {
        "beforePrompt": before_prompt,
        "afterPrompt": after_prompt,
        "gapDuration": gap_duration,
        "mode": "t2v",
    }
    try:
        data = await _post("/api/suggest-gap-prompt", body)
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── Factory Error Monitoring ────────────────────────────────────────────────


@mcp.tool()
async def get_factory_status(project_path: str) -> str:
    """Read the current Shot Factory status including any errors.

    The frontend writes a .factory-status.json file to the project's factory
    directory whenever shot states change. This tool reads that file to give
    you real-time visibility into the factory pipeline.

    Args:
        project_path: Absolute path to the project directory (the folder
            containing the factory/ subfolder). You can find this from the
            LTX Desktop window title or settings.

    Returns:
        JSON with shot counts by status (idle, generating, frame-ready,
        rendering, video-ready, approved, errors) and detailed error info
        for any failed shots including shot ID, scene, error message, and prompt.

    Use this proactively to check for errors after batch operations.
    When errors are found, use diagnose_factory_errors to get fix suggestions.
    """
    status_path = Path(project_path) / "factory" / ".factory-status.json"
    if not status_path.exists():
        return json.dumps({
            "error": "No factory status file found",
            "hint": f"Expected at {status_path}. Ensure the Shot Factory is open in LTX Desktop and has at least one shot.",
        })

    try:
        data = json.loads(status_path.read_text())
        return json.dumps(data, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Failed to read status file: {e}"})


@mcp.tool()
async def diagnose_factory_errors(project_path: str) -> str:
    """Analyze factory errors and provide actionable fix suggestions.

    Reads the factory status, categorizes errors, and returns specific
    remediation steps for each type of failure.

    Args:
        project_path: Absolute path to the project directory.

    Returns:
        JSON with categorized errors and suggested actions:
        - OOM errors → reduce resolution/duration
        - Connection errors → check ComfyUI is running
        - Timeout errors → switch to fast model
        - IPC errors → restart the app
        - Missing node errors → restart ComfyUI
    """
    status_path = Path(project_path) / "factory" / ".factory-status.json"
    if not status_path.exists():
        return json.dumps({"status": "ok", "message": "No factory status file — no errors detected"})

    try:
        data = json.loads(status_path.read_text())
    except Exception as e:
        return json.dumps({"error": f"Failed to read status: {e}"})

    errors = data.get("errors", [])
    if not errors:
        return json.dumps({
            "status": "ok",
            "message": "No errors found in factory",
            "summary": {
                "total_shots": data.get("totalShots", 0),
                "idle": data.get("idle", 0),
                "frame_ready": data.get("frameReady", 0),
                "video_ready": data.get("videoReady", 0),
                "approved": data.get("approved", 0),
            },
        })

    # Categorize errors
    categories: dict[str, list[dict[str, Any]]] = {
        "oom": [],
        "connection": [],
        "timeout": [],
        "ipc": [],
        "missing_node": [],
        "other": [],
    }

    for err in errors:
        msg = (err.get("error") or "").lower()
        entry = {
            "shot_id": err.get("shotId"),
            "scene": err.get("scene"),
            "error": err.get("error"),
        }

        if "out of memory" in msg or "oom" in msg or "cuda" in msg:
            categories["oom"].append(entry)
        elif "econnrefused" in msg or "fetch failed" in msg or "connection" in msg:
            categories["connection"].append(entry)
        elif "timeout" in msg or "timed out" in msg:
            categories["timeout"].append(entry)
        elif "reply was never sent" in msg or "invoking remote method" in msg:
            categories["ipc"].append(entry)
        elif "not found" in msg and "node" in msg:
            categories["missing_node"].append(entry)
        else:
            categories["other"].append(entry)

    # Build recommendations
    recommendations: list[dict[str, Any]] = []

    if categories["oom"]:
        recommendations.append({
            "category": "Out of Memory",
            "count": len(categories["oom"]),
            "shot_ids": [e["shot_id"] for e in categories["oom"]],
            "action": "Reduce resolution from 1080p to 720p or 512p, or shorten duration. Use update_settings to lower resolution.",
            "auto_fixable": True,
        })

    if categories["connection"]:
        recommendations.append({
            "category": "Connection Error",
            "count": len(categories["connection"]),
            "shot_ids": [e["shot_id"] for e in categories["connection"]],
            "action": "ComfyUI backend is not responding. Ask user to check if ComfyUI is running. May need to restart LTX Desktop.",
            "auto_fixable": False,
        })

    if categories["timeout"]:
        recommendations.append({
            "category": "Timeout",
            "count": len(categories["timeout"]),
            "shot_ids": [e["shot_id"] for e in categories["timeout"]],
            "action": "Generation took too long. Try switching to 'fast' model or reducing resolution/duration.",
            "auto_fixable": True,
        })

    if categories["ipc"]:
        recommendations.append({
            "category": "IPC Error (reply never sent)",
            "count": len(categories["ipc"]),
            "shot_ids": [e["shot_id"] for e in categories["ipc"]],
            "action": "The ComfyUI WebSocket connection dropped during generation. This is usually transient. Retry the failed shots. If persistent, restart LTX Desktop.",
            "auto_fixable": True,
        })

    if categories["missing_node"]:
        recommendations.append({
            "category": "Missing ComfyUI Node",
            "count": len(categories["missing_node"]),
            "shot_ids": [e["shot_id"] for e in categories["missing_node"]],
            "action": "ComfyUI is missing required custom nodes. Restart ComfyUI so it can load newly installed nodes.",
            "auto_fixable": False,
        })

    if categories["other"]:
        recommendations.append({
            "category": "Other Errors",
            "count": len(categories["other"]),
            "shots": categories["other"],
            "action": "Review error messages individually. May need manual intervention.",
            "auto_fixable": False,
        })

    return json.dumps({
        "status": "errors_found",
        "total_errors": len(errors),
        "recommendations": recommendations,
        "raw_errors": errors,
    }, indent=2)


@mcp.tool()
async def watch_factory_errors(project_path: str, poll_interval: float = 10.0, max_polls: int = 30) -> str:
    """Poll factory status for errors over time. Use this during batch operations
    to detect and respond to failures as they happen.

    Args:
        project_path: Absolute path to the project directory.
        poll_interval: Seconds between status checks. Default 10.
        max_polls: Maximum number of polls before returning. Default 30 (5 minutes at 10s).

    Returns the first status update that contains errors, or a summary after max_polls.
    """
    status_path = Path(project_path) / "factory" / ".factory-status.json"
    last_error_count = 0

    for i in range(max_polls):
        if status_path.exists():
            try:
                data = json.loads(status_path.read_text())
                errors = data.get("errors", [])
                generating = data.get("generatingFrame", 0) + data.get("renderingVideo", 0)

                # If new errors appeared, report immediately
                if len(errors) > last_error_count:
                    new_errors = errors[last_error_count:]
                    return json.dumps({
                        "status": "new_errors_detected",
                        "poll_number": i + 1,
                        "new_errors": new_errors,
                        "total_errors": len(errors),
                        "factory_state": {
                            "idle": data.get("idle", 0),
                            "generating": generating,
                            "frame_ready": data.get("frameReady", 0),
                            "video_ready": data.get("videoReady", 0),
                            "approved": data.get("approved", 0),
                        },
                        "hint": "Use diagnose_factory_errors to get fix suggestions",
                    }, indent=2)

                last_error_count = len(errors)

                # If nothing is generating and no errors, pipeline may be done
                if generating == 0 and len(errors) == 0 and i > 0:
                    return json.dumps({
                        "status": "pipeline_idle",
                        "poll_number": i + 1,
                        "message": "No active generations and no errors",
                        "factory_state": {
                            "idle": data.get("idle", 0),
                            "frame_ready": data.get("frameReady", 0),
                            "video_ready": data.get("videoReady", 0),
                            "approved": data.get("approved", 0),
                        },
                    }, indent=2)

            except Exception:
                pass  # File may be mid-write

        await asyncio.sleep(poll_interval)

    return json.dumps({
        "status": "max_polls_reached",
        "polls": max_polls,
        "message": f"Monitored for {max_polls * poll_interval}s with no new errors",
    })


# ─── Remotion Motion Graphics ────────────────────────────────────────────────


@mcp.tool()
async def get_remotion_requests(project_path: str) -> str:
    """Read pending Remotion motion graphics requests from the Shot Factory.

    Users can request Remotion-generated motion graphics (title cards, transitions,
    animated elements) from the Factory UI. These requests are saved to a JSON file
    that Claude Code should poll and fulfill.

    Args:
        project_path: Absolute path to the project directory.

    Returns:
        JSON array of pending requests, each with:
        - shotId: Which shot needs the frame
        - description: What motion graphic to create
        - scene: Which scene the shot belongs to
        - status: 'pending' or 'complete'
        - timestamp: When the request was made

    Workflow:
    1. Call this tool to check for pending requests
    2. For each pending request, write a Remotion composition matching the description
    3. Render the composition with `npx remotion render`
    4. Use the rendered frame as the shot's image (upload via the Factory UI)
    5. Mark the request as complete using complete_remotion_request
    """
    requests_path = Path(project_path) / "factory" / ".remotion-requests.json"
    if not requests_path.exists():
        return json.dumps({"requests": [], "message": "No Remotion requests found"})

    try:
        data = json.loads(requests_path.read_text())
        pending = [r for r in data if r.get("status") == "pending"]
        return json.dumps({
            "total": len(data),
            "pending": len(pending),
            "requests": data,
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Failed to read requests: {e}"})


@mcp.tool()
async def complete_remotion_request(
    project_path: str,
    shot_id: str,
    rendered_path: str,
) -> str:
    """Mark a Remotion request as complete after rendering.

    Args:
        project_path: Absolute path to the project directory.
        shot_id: The shot ID that was rendered.
        rendered_path: Absolute path to the rendered frame/image.

    Updates the request status to 'complete' and records the output path.
    """
    requests_path = Path(project_path) / "factory" / ".remotion-requests.json"
    if not requests_path.exists():
        return json.dumps({"error": "No requests file found"})

    try:
        data = json.loads(requests_path.read_text())
        found = False
        for req in data:
            if req.get("shotId") == shot_id:
                req["status"] = "complete"
                req["renderedPath"] = rendered_path
                req["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                found = True
                break

        if not found:
            return json.dumps({"error": f"No request found for shot {shot_id}"})

        requests_path.write_text(json.dumps(data, indent=2))
        return json.dumps({
            "status": "ok",
            "shot_id": shot_id,
            "rendered_path": rendered_path,
            "message": f"Request for {shot_id} marked as complete. User can now import the rendered frame via Upload in the Factory UI.",
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to update request: {e}"})


# ─── Run Server ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
