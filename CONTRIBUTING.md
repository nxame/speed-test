# Contributing

Thanks for taking the time to contribute!

## Code of conduct

By participating, you agree to follow the project's Code of Conduct. If one is not yet published, please be respectful and constructive in all interactions.

## Development setup

- Requires Node.js 18+.
- Clone the repo and install dependencies (there are none currently).

## Run locally

```bash
node ./src/cli.js --help
```

You can also link the CLI for local testing:

```bash
npm link
net-speed --help
```

## Speed test check

Run the smoke checks locally with:

```bash
node ./test/smoke.js
```

Run the full CLI matrix with:

```bash
node ./test/cli-matrix.js
```

Or run both:

```bash
npm test
```

Note: These hit real network endpoints and may take a few seconds.

## Pull requests

- Keep changes focused and well-scoped.
- Include tests or updates to `test/smoke.js` or `test/cli-matrix.js` when behavior changes.
- Describe the motivation and any user-facing impact.

## Reporting issues

Please include:

- Node.js version and OS
- Command used and full output
- Whether the issue reproduces reliably
