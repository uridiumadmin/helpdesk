"""Shared test fixtures and path setup for the audio-worker test suite."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the src directory is importable without a pip install.
_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
