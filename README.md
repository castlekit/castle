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

## Requirements

- Node.js >= 22
- [OpenClaw](https://openclaw.ai) (installed automatically if missing)

## License

MIT
