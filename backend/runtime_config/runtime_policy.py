"""Runtime policy decisions for forced API mode."""

from __future__ import annotations

# Minimum VRAM (GB) required for local generation with FP8 quantization,
# sequential model loading, and tiling.  16 GB cards (e.g. RTX 5080) work at
# 540p/720p; 24 GB+ cards comfortably handle 1080p.
_MIN_VRAM_GB = 10


def decide_force_api_generations(system: str, cuda_available: bool, vram_gb: int | None) -> bool:
    """Return whether API-only generation must be forced for this runtime."""
    if system == "Darwin":
        return True

    if system in ("Windows", "Linux"):
        if not cuda_available:
            return True
        if vram_gb is None:
            return True
        return vram_gb < _MIN_VRAM_GB

    # Fail closed for non-target platforms unless explicitly relaxed.
    return True
