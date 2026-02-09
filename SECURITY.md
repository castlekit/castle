# Security Policy

## Reporting a Vulnerability

If you believe you've found a security vulnerability in Castle, please open a [GitHub issue](https://github.com/castlekit/castle/issues).

We make no guarantees about response times or fixes. This software is provided as-is under the [MIT License](LICENSE).

## Out of Scope

The following are **not** considered vulnerabilities:

- Public internet exposure — Castle's web interface is not designed for public access
- Prompt injection attacks
- Using Castle in ways the documentation recommends against
- Vulnerabilities in dependencies that don't affect Castle's usage

## Web Interface Safety

Castle's web interface is intended for **local use only**. Do not bind it to the public internet; it is not hardened for public exposure.

## Runtime Requirements

### Node.js Version

Castle requires **Node.js 22.12.0 or later** (LTS). This version includes important security patches:

- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

Verify your Node.js version:

```bash
node --version  # Should be v22.12.0 or later
```

### Docker Security

When running Castle in Docker:

1. Run as a non-root user for reduced attack surface
2. Use `--read-only` flag when possible for filesystem protection
3. Limit container capabilities with `--cap-drop=ALL`

Example secure Docker run:

```bash
docker run --read-only --cap-drop=ALL \
  -v castle-data:/app/data \
  -p 3333:3333 \
  castle:latest
```

## Security Scanning

This project uses [`detect-secrets`](https://github.com/Yelp/detect-secrets) for automated secret detection in CI and pre-commit hooks, with a custom plugin for Castle/OpenClaw-specific patterns.

Run locally:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline --custom-plugins .detect-secrets-plugins/
```

See `.detect-secrets.cfg` for configuration and `.secrets.baseline` for the baseline.

### Pre-commit hooks

Install [pre-commit](https://pre-commit.com) for local secret scanning, GitHub Actions linting, and file hygiene checks:

```bash
pip install pre-commit
pre-commit install
```

Hooks run automatically on every commit. Run manually with:

```bash
pre-commit run --all-files
```
