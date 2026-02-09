"""
Custom detect-secrets plugin for Castle / OpenClaw specific secrets.

Detects:
- OpenClaw reward tokens (rew_ prefix with 32+ hex chars)
- Hardcoded OPENCLAW_GATEWAY_TOKEN values
- Remote WebSocket gateway URLs (non-localhost)
"""

import re

from detect_secrets.plugins.base import RegexBasedDetector


class CastleOpenClawDetector(RegexBasedDetector):
    """Detect Castle and OpenClaw specific secrets."""

    secret_type = "Castle/OpenClaw Secret"

    denylist = [
        # OpenClaw reward tokens — real ones are 32+ hex chars
        re.compile(r"rew_[a-f0-9]{32,}"),
        # Hardcoded gateway token values (not env var references like ${VAR})
        re.compile(r"OPENCLAW_GATEWAY_TOKEN\s*=\s*[\"']?(?!\$\{)[^\s\"']{8,}"),
        # Remote WebSocket URLs (exclude localhost / 127.0.0.1)
        re.compile(
            r"wss?://(?!localhost)(?!127\.0\.0\.1)(?!0\.0\.0\.0)[a-zA-Z0-9][\w.\-:]+"
        ),
    ]
