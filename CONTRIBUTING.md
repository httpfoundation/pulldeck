# Contributing to Pulldeck

Thank you for your interest in contributing!

## Reporting Bugs

Open a [GitHub Issue](https://github.com/httpfoundation/pulldeck/issues) and include:

- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Your OS, Docker version, and Pulldeck version

For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead — do **not** open a public issue.

## Suggesting Features

Open a GitHub Issue with the `enhancement` label. Describe the use case and why existing behavior doesn't cover it.

## Submitting a Pull Request

1. Fork the repository and create a branch from `main`.
2. Make your changes. Keep commits focused and atomic.
3. Ensure the project builds: `pnpm build`
4. Open a pull request against `main` with a clear description of what changed and why.

Small, focused PRs are much easier to review than large ones.

## Development Setup

```bash
pnpm install
pnpm dev        # starts the server with hot reload via tsx
pnpm build      # compiles TypeScript to dist/
```

Copy `.env.example` to `.env` and fill in your values before running locally.
