# Bedrock Beacon

Bedrock Beacon is a local Windows control panel for running multiple isolated Minecraft Bedrock Dedicated Server instances from one web interface.

> [!IMPORTANT]
> Bedrock Beacon is an independent project and is not affiliated with or endorsed by Microsoft or Mojang. Minecraft and Bedrock are trademarks of Microsoft/Mojang. The official Bedrock Dedicated Server is not included in the source repository or portable releases.

## Features

- Public, branded **Quick View** home page with automatically refreshed online/offline state and live player counts for every server, plus a single login/dashboard link.
- Dedicated browser routes for Quick View (`/`), server management (`/manage-server`), administration (`/admin`), users (`/users`), and account security (`/my-account`).
- Self-service password changes for every authenticated account, with current-password verification and automatic sign-out of other sessions.
- Local multi-user access with three permission levels:
  - **Admin** — full access to users, system administration, updates, services, gateways, and servers.
  - **Manager** — can create, import, export, configure, reset, delete, start, and stop servers, but cannot access System Admin or manage users.
  - **User** — can view server status and configuration and start or stop servers, but cannot change settings or create, reset, export, or delete servers.
- Existing single-account installations are migrated automatically; the existing account becomes an Admin.

- Multiple isolated Bedrock server instances with unique port pairs.
- Local account-protected administration portal.
- Server creation, status, console, configuration, reset, import, and export.
- EULA acknowledgement required before a server can start.
- BedrockConnect integration for a single console-discoverable LAN entry.
- Optional Windows service installation.
- Offline-capable portable release packages with bundled Node.js and Java runtimes.
- Validated, staged application updates that preserve local accounts and worlds.

## Run from source

Requirements:

- Windows 10 or newer.
- Node.js 24 LTS or a compatible current LTS release.
- An official Minecraft Bedrock Dedicated Server ZIP supplied by the administrator.

```powershell
npm ci
npm start
```

Open `http://localhost:3210` and create the local administrator account. In **System Admin**, upload the official Bedrock Dedicated Server ZIP before creating the first world.

Runtime data is created under `data/` and `Servers/`. These directories can contain credentials, player identifiers, logs, server software, and world data and must never be committed.

## Portable release

Portable release builds require the following locally installed build inputs, all excluded from Git:

- `runtime/node/node.exe`
- `runtime/java/jdk-21.0.12+8-jre/`
- `service/BedrockHarborService.exe` (the internal service ID is retained for upgrade compatibility)
- `data/bedrockconnect/BedrockConnect-1.69.0.jar`

After supplying those artifacts, run:

```powershell
.\build-portable.ps1
```

The archive is written to `dist/`. Release artifacts must include the license and notices required by each bundled dependency. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The official Minecraft Bedrock Dedicated Server is deliberately excluded from every Bedrock Beacon release. After installing Beacon, the administrator must use the official Minecraft link on the System Admin page, download the **Windows** server ZIP, and upload it to create the local server template.

### Versioning future releases

The first public release is version `1.1.1`. Rebuilding with `build-portable.ps1` preserves the current version. To advance the semantic version and build the next release in one operation, run:

```powershell
.\new-release.ps1          # 1.1.1 -> 1.1.2
.\new-release.ps1 minor    # 1.1.2 -> 1.2.0
.\new-release.ps1 major    # 1.2.0 -> 2.0.0
```

Use the default patch increment for normal application updates. Minor and major increments should be reserved for larger or compatibility-breaking releases.

To build and publish the next version to GitHub Releases, first commit all application changes, authenticate GitHub CLI with `gh auth login`, and run:

```powershell
.\publish-release.ps1
```

The publisher determines the next version from both the application manifest and existing Git tags, builds the portable ZIP, creates a SHA-256 checksum, commits the generated version metadata, creates and pushes an annotated tag, and uploads both files to a GitHub Release. Use `-Increment minor` or `-Increment major` when needed. Add `-Draft` or `-Prerelease` for those GitHub release types. It refuses to run with uncommitted changes or an existing release tag.

## Windows service

Portable releases include the WinSW wrapper. From an elevated PowerShell session:

```powershell
.\install-service.ps1
Start-Service BedrockHarbor
```

The stable internal service ID remains `BedrockHarbor` so existing installations can upgrade to Bedrock Beacon without orphaning the old service registration.

To remove only the service registration while preserving data:

```powershell
.\uninstall-service.ps1
```

## Export and import

Stop a server and select **Export Server** from its Configuration page to create a `.bedrock-beacon.zip` backup. It includes configuration, worlds, allow/permission lists, and pack data. Official executables, DLLs, logs, and EULA acceptance are excluded.

Select the dashboard's **+** card and choose **Import Server** to restore it. Legacy `.bedrock-harbor.zip` exports remain supported.

## Application updates

In **System Admin**, select **Check for Updates** to compare the installed version with the latest official GitHub release. Beacon can download and install immediately or retain the validated ZIP in `data/update-cache` for a later installation. GitHub asset size and SHA-256 metadata are checked when available, the complete Beacon package is validated after download, and the cached package is validated again immediately before installation. A successful installation removes the cached media automatically.

You may also provide a complete trusted Bedrock Beacon portable ZIP manually. All managed servers must be stopped. Beacon validates and stages the archive, preserves local data and worlds, installs the application files, and restarts automatically in either interactive or Windows-service mode. Validation, extraction, handoff, installation, and restart activity is recorded in `data/updates/last-update.log`. Completed staging data is removed automatically after restart; failed staging is retained temporarily for diagnosis and removed after seven days.

## Third-party software and credits

Bedrock Beacon is an independent management application. It does not use Multicraft or another commercial game-server panel. Beacon creates an isolated directory and launches a separate official Bedrock Dedicated Server process for each managed world. BedrockConnect provides the optional single console-discoverable entry and routes players to the selected backend server.

| Component                                                                                     | Developer or maintainer                          | How Bedrock Beacon uses it                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Minecraft Bedrock Dedicated Server](https://www.minecraft.net/en-us/download/server/bedrock) | Mojang Studios / Microsoft                       | The official server engine that runs each Minecraft Bedrock world. Administrators must obtain the Windows ZIP from Minecraft and accept Mojang's terms.   |
| [BedrockConnect](https://github.com/Pugmatt/BedrockConnect)                                   | Pugmatt and BedrockConnect contributors          | Supplies the optional LAN-advertised server-selection gateway used by console clients to reach multiple Beacon-managed servers through one visible entry. |
| [WinSW](https://github.com/winsw/winsw)                                                       | WinSW project contributors                       | Runs Bedrock Beacon as a Windows service when service installation is enabled.                                                                            |
| [Node.js](https://nodejs.org/)                                                                | Node.js contributors and the OpenJS Foundation   | Runs the Bedrock Beacon backend and local web portal. The portable distribution includes a Windows Node.js runtime.                                       |
| [Eclipse Temurin](https://adoptium.net/)                                                      | Eclipse Adoptium project contributors            | Provides the Java runtime used to launch BedrockConnect in the portable distribution.                                                                     |
| [Express](https://expressjs.com/)                                                             | Express project contributors / OpenJS Foundation | Provides the local HTTP API and serves the administration portal.                                                                                         |
| [Multer](https://github.com/expressjs/multer)                                                 | Express project contributors                     | Handles Bedrock server, backup, and application-update ZIP uploads.                                                                                       |
| [adm-zip](https://github.com/cthackers/adm-zip)                                               | cthackers and contributors                       | Reads and validates ZIP archives used for imports and updates.                                                                                            |

Minecraft, Minecraft Bedrock, and the Bedrock Dedicated Server are products and trademarks of Microsoft and Mojang. BedrockConnect, WinSW, Node.js, Eclipse Temurin, Express, Multer, and adm-zip are separate projects maintained by their respective developers. Their inclusion does not imply endorsement of Bedrock Beacon. License and bundled-version details are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Security and privacy

- The web portal binds to `127.0.0.1` and is not directly exposed to the LAN.
- Passwords are stored locally as salted hashes, but `data/manager.json` is still sensitive.
- Server and gateway ports are exposed separately for Minecraft clients.
- Treat imported server archives and application updates as untrusted until their source is verified.
- Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). No open-source license has been selected yet; adding a license is required before third parties can confidently reuse or redistribute the source.
