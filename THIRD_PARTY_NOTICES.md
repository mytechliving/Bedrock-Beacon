# Third-party software

## BedrockConnect

Bedrock Beacon can launch BedrockConnect as a separate gateway process for console server selection.

- Project: https://github.com/Pugmatt/BedrockConnect
- Installed release: 1.69.0
- License: GNU General Public License v3.0
- Runtime artifact: `data/bedrockconnect/BedrockConnect-1.69.0.jar`

BedrockConnect is developed independently by Pugmatt and its contributors. Minecraft and Bedrock are trademarks of Microsoft/Mojang.

## WinSW

Bedrock Beacon uses WinSW as a separate service wrapper when Windows service installation is requested.

- Project: https://github.com/winsw/winsw
- Installed release: 2.12.0
- License: MIT
- Runtime artifact: `service/BedrockHarborService.exe`

## Node.js

The portable distribution includes the Node.js Windows runtime.

- Project: https://nodejs.org/
- Bundled release: 24.19.0 LTS
- License: MIT and bundled third-party notices
- Runtime artifact: `runtime/node/node.exe`

## Eclipse Temurin

The portable distribution includes an Eclipse Temurin Java runtime for BedrockConnect.

- Project: https://adoptium.net/
- Bundled release: JRE 21.0.12+8 LTS
- License: GPLv2 with Classpath Exception and bundled third-party notices
- Runtime location: `runtime/java/jdk-21.0.12+8-jre`

## Express

Bedrock Beacon uses Express for its local HTTP API and web portal.

- Project: https://expressjs.com/
- Installed release: 5.1.0
- Developer: Express project contributors / OpenJS Foundation
- License: MIT

## Multer

Bedrock Beacon uses Multer to receive server, backup, and application-update ZIP uploads.

- Project: https://github.com/expressjs/multer
- Installed release: 2.0.2
- Developer: Express project contributors
- License: MIT

## adm-zip

Bedrock Beacon uses adm-zip to inspect and validate ZIP archives.

- Project: https://github.com/cthackers/adm-zip
- Installed release: 0.6.0
- Developer: cthackers and contributors
- License: MIT
