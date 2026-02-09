# Contributing to Castle

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/castlekit/castle.git
cd castle
npm install
npm run dev
```

Requires **Node.js >= 22**.

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Bump the version in `package.json` (CI enforces this)
4. Run `npm run lint && npm test && npm run build` locally
5. Open a PR against `main`

## Tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

Tests use in-memory SQLite databases and don't touch any live services.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
