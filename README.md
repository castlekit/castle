# Castle

The extensible interface for [OpenClaw](https://openclaw.ai) AI agents.

Castle is a local-first, open-source UI that gives you chat, agent management, and a dashboard for your OpenClaw agents. Everything runs on your machine — no cloud services, no data leakage.

## Quick Install

```bash
curl -fsSL https://castlekit.com/install.sh | bash
```

## Manual Install

```bash
npm install -g @castlekit/castle
castle setup
```

## Development

```bash
git clone https://github.com/castlekit/castle.git
cd castle
npm install
npm run dev
```

Then open [http://localhost:3333](http://localhost:3333).

## Releasing

```bash
# 1. Bump version
npm version patch --no-git-tag-version

# 2. Commit and push
git add -A && git commit -m "Release vX.Y.Z" && git push

# 3. Publish to npm (requires 2FA)
npm publish --access public

# 4. Tag the release
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Requirements

- Node.js >= 22
- [OpenClaw](https://openclaw.ai) (installed automatically if missing)

## License

MIT
