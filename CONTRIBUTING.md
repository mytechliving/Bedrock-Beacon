# Contributing to Bedrock Beacon

Thank you for helping improve Bedrock Beacon.

## Development setup

1. Install Node.js 24 LTS or a compatible current LTS release.
2. Run `npm ci`.
3. Run `npm start`.
4. Open `http://localhost:3210`.

Do not commit anything under `data/`, `Servers/`, `runtime/`, `dist/`, or `node_modules/`. Use a disposable local administrator account and test worlds.

## Before opening a pull request

```powershell
node --check server.js
node --check public/app.js
npm audit --omit=dev
git diff --check
```

Keep changes focused, document behavior changes, and describe manual verification. Do not attach official Minecraft server files, world data, player identifiers, credentials, access tokens, or generated portable distributions to pull requests.

## Reporting bugs

Include the Bedrock Beacon version, Windows version, relevant sanitized logs, and reproduction steps. Remove usernames, IP addresses, Xbox identifiers, world names, and secrets before posting logs publicly.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

