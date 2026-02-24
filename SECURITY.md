# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

If you discover a security issue, report it privately via [GitHub's private vulnerability reporting](https://github.com/httpfoundation/pulldeck/security/advisories/new).

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations

You can expect an acknowledgment within 48 hours and a resolution or status update within 14 days.

## Scope

This policy covers the Pulldeck server itself. Issues in third-party dependencies should be reported to their respective maintainers, though you are welcome to notify us as well so we can track the impact.

## Security Considerations for Operators

Pulldeck has access to the host's Docker socket, which grants root-equivalent privileges on the host. Before deploying:

- Use a strong, randomly generated `AUTH_TOKEN` (e.g., `openssl rand -hex 32`).
- Expose Pulldeck only over HTTPS, ideally behind a reverse proxy.
- Do not expose the port publicly unless necessary — prefer restricting access by IP or VPN.
- Mount host directories as read-only (`:ro`) wherever possible.
