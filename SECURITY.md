# Security Policy

## Supported Versions

Security updates are applied to the current `main` branch deployment.

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository.

When reporting, include:
- Reproduction steps
- Affected URL/path and browser/runtime details
- Impact assessment (confidentiality/integrity/availability)

## Security Controls (Current)

- Strict scene import normalization and size limits
- Runtime DOM rendering avoids untrusted `innerHTML` interpolation
- Dedicated proxy endpoint requirement (`VITE_CORS_PROXY`)
- Cloudflare Worker host/path/origin allowlists
- Method restrictions and optional per-IP rate limiting
- Same-origin vendored `gif.js` runtime assets (no external CDN script fetch at runtime)

## Operational Notes

- Do not expose permissive proxy settings in public environments.
- Keep `VITE_ENABLE_PROXY_DEBUG=false` in production.
- Rotate/adjust proxy allowlists when deployment domains change.
