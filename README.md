# Stardew Valley Headless Server Kit

> 星露谷物语无头服务器一键搭建包：基于 Docker、JunimoServer 和 SMAPI Mods，让农场可以长期在线。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-required-2496ED.svg)](https://www.docker.com/)

## 项目定位

星露谷物语没有官方独立专用服务器。这个项目采用社区常见的“无头房主”方案：

1. 通过 Docker 启动常驻容器。
2. 使用你自己的 Steam 账号下载正版游戏文件。
3. 由 JunimoServer / SMAPI 负责无头运行和 Mod 加载。
4. 玩家正常加入这个长期在线的农场。

本项目不分发 Stardew Valley 游戏文件，也不绕过正版校验。使用者必须拥有正版游戏。

## 支持范围

当前版本 **只正式支持 Docker / Docker Compose 部署**。

Windows、Linux 和 macOS 脚本都是围绕 Docker Compose 封装的运维入口；Web 管理面板里的
启动、停服、重启、日志、备份、存档、Mod 和 VNC 辅助功能也依赖 Docker 容器与 Docker
volume。项目暂不提供裸机 / 无 Docker 部署流程，也不承诺原生部署下的功能完整性。

如果你是高级用户，仍然可以参考 JunimoServer、SMAPI 和 SteamCMD 的上游文档自行实验原生部署；
但本仓库的 README、脚本、故障排查和自动化测试都以 Docker 部署为支持边界。

## 功能总览

从当前源码看，本项目主要提供这些能力：

- 一键初始化和开服：Windows 入口是 `setup.ps1`，Linux / macOS 入口是
  `scripts/sdv-server.sh`。脚本会生成 `.env`、初始化 `data/settings` 和
  `data/mods`、生成 VNC / API / 管理令牌、拉取镜像、下载游戏文件并启动服务端。
- Docker 无头服务编排：`docker-compose.yml` 编排 `server`、`steam-auth` 和可选
  `discord-bot`，并持久化 Steam 会话、游戏文件、存档、设置和 SMAPI Mod。
- Steam 下载双链路：优先通过 `steam-auth` 登录和下载；遇到 manifest `403`、
  SteamClient 连接异常等情况时，可自动或手动切换到 SteamCMD 备用流程，并补齐
  Steamworks SDK。
- Web 管理面板：`scripts/admin-panel.js` 提供本地 HTTP 管理面板，使用
  `ADMIN_TOKEN` 登录，包含概览、玩家、存档、模组、配置、日志等页面，并支持
  简体中文 / English 运行时切换。
- 运行状态管理：管理面板和脚本可启动、停止、重启、更新服务端，查看容器健康状态、
  端口映射、资源占用、最近日志、邀请码、局域网候选 IP 和加入信息。
- 安全停服：面板的“停服释放资源”会执行 `docker compose down`，保留 Docker
  volumes、存档、配置和备份；在线玩家存在时会结合最近 `SaveGame.Save` 记录提示
  立即停服、等待下一次保存后自动停服，或由管理员强制确认。
- 开服配置管理：面板可写入 `.env` 和 `data/settings/server-settings.json`，
  管理人数、端口、IP 直连、进服密码、API Key、管理员 Steam64 ID、Nexus API Key、
  小屋策略、钱包模式和详细日志等运行配置。
- 存档管理：面板可列出当前 saves volume 里的可加载存档，设置下次加载的存档，
  创建新地图，编辑存档基础字段，删除单个存档，创建 / 恢复 / 删除备份，并配置自动备份
  间隔和保留数量。
- 小屋与角色修复：创建新地图或修复存档时，源码会按目标小屋数量补建小屋、清理小屋
  落点障碍、修正小屋引用和农场角色 `UniqueMultiplayerID`，执行前会自动备份。
- 玩家管理：面板通过 JunimoServer HTTP API 读取在线玩家、农场角色和登录验证状态，
  可授予管理员、删除离线农场角色。当前服务端镜像没有 HTTP 踢出 / 封禁接口，所以面板
  明确标记这些操作不可用。
- Mod 管理：`data/mods/` 会挂载到容器 `/data/Mods`。面板可读取已安装 Mod 的
  `manifest.json`，搜索 SMAPI 兼容列表，读取 Nexus 文件分组，从 Nexus / URL /
  本地 zip 安装 Mod，删除 Mod，并编辑 `config.json`。
- Mod 安装安全保护：后端只接受 HTTPS 下载，限制来源主机和文件大小，校验 zip 魔数，
  拒绝符号链接，覆盖安装或删除前会把旧 Mod 移到 `backups/mods/`，修改配置前会备份到
  `backups/mod-configs/`。
- VNC / noVNC 辅助：Windows 脚本提供 noVNC 地址和原生 VNC 代理；跨平台脚本提供
  输入检查、交互参数修复、分辨率恢复，以及 `host-auto` / `host-visibility`
  两个 JunimoServer 主机托管命令。
- 自动化自检：仓库包含管理面板语法检查、自测脚本、Mod 服务自测、授权自测和 noVNC
  探针脚本；测试矩阵和长稳验证流程放在 `docs/` 目录。
- 安全边界：源码会对日志中的 Steam 账号、密码、token、VNC 密码、API Key、
  管理令牌和服务器密码做脱敏；`.env` 是本地私密配置，不应提交到 Git，也不建议把
  `ADMIN_PORT` 直接暴露到公网。

## 快速开始

### Windows

```powershell
cd <repo-root>
.\setup.ps1 setup
```

脚本会完成：

- 生成本地 `.env`
- 自动生成 VNC 密码和 API Key
- 拉取 Docker 镜像
- 执行 Steam 授权和游戏文件下载
- 启动无头服务器
- 打印管理面板、noVNC、HTTP API、游戏直连 IP/端口等访问入口
- 询问是否立即启动 Web 管理面板

### Linux / macOS

```bash
cd StardewValleyServerKit
chmod +x ./scripts/sdv-server.sh
./scripts/sdv-server.sh setup
```

## 常用命令

Windows：

```powershell
.\setup.ps1 doctor
.\setup.ps1 check-env
.\setup.ps1 login
.\setup.ps1 download
.\setup.ps1 steamcmd-download
.\setup.ps1 smoke
.\setup.ps1 start
.\setup.ps1 stop
.\setup.ps1 restart
.\setup.ps1 logs
.\setup.ps1 status
.\setup.ps1 update
.\setup.ps1 backup
.\setup.ps1 join-info
.\setup.ps1 admin
.\setup.ps1 admin-public
.\setup.ps1 admin-token-rotate
.\setup.ps1 vnc-url
.\setup.ps1 vnc-proxy
.\setup.ps1 vnc-check
.\setup.ps1 vnc-fix
.\setup.ps1 vnc-resize
.\setup.ps1 host-auto
.\setup.ps1 host-visibility
```

如果 `login` 出现 `The SteamClient instance must be connected`，或 Steam 登录成功后
`download` 在 manifest 下载阶段出现 `403 (Forbidden)`，脚本会在下载阶段自动切换到
SteamCMD 备用流程。也可以手动执行：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

Linux / macOS：

```bash
RETRIES=5 ./scripts/sdv-server.sh steamcmd-download
```

该备用流程使用 Valve 官方 SteamCMD 下载链路，会同时下载 Stardew Valley 本体和
Steamworks SDK。SDK 缺失时，JunimoServer 的 Steam SDR / GameServer 模式可能启动不完整。
如果 SteamCMD 下载中途出现 `state is 0x402 after update job`，重新执行同一命令即可，
已下载到 Docker volume 的部分文件会被复用。

详见 [Steam 下载备用流程](docs/STEAM_DOWNLOAD_FALLBACK.md)。

Linux / macOS：

```bash
./scripts/sdv-server.sh doctor
./scripts/sdv-server.sh check-env
./scripts/sdv-server.sh login
./scripts/sdv-server.sh download
./scripts/sdv-server.sh steamcmd-download
./scripts/sdv-server.sh smoke
./scripts/sdv-server.sh start
./scripts/sdv-server.sh stop
./scripts/sdv-server.sh restart
./scripts/sdv-server.sh logs
./scripts/sdv-server.sh status
./scripts/sdv-server.sh update
./scripts/sdv-server.sh backup
./scripts/sdv-server.sh join-info
./scripts/sdv-server.sh admin
./scripts/sdv-server.sh admin-public
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-start
./scripts/sdv-server.sh admin-service-stop
./scripts/sdv-server.sh admin-service-restart
./scripts/sdv-server.sh admin-service-status
./scripts/sdv-server.sh admin-service-logs
./scripts/sdv-server.sh admin-token-rotate
./scripts/sdv-server.sh vnc-check
./scripts/sdv-server.sh vnc-fix
./scripts/sdv-server.sh vnc-resize
./scripts/sdv-server.sh host-auto
./scripts/sdv-server.sh host-visibility
```

## 访问入口

- Web noVNC：`http://localhost:5800`
- HTTP API：`http://localhost:8080`
- Web 管理面板：本机 `http://127.0.0.1:8088`，公网服务器建议通过 1Panel 域名反代访问
- 游戏 UDP 端口：`24642`
- 查询 UDP 端口：`27015`

执行 `setup`、`smoke`、`start`、`restart`、`update` 后，脚本会自动打印当前
`.env` 对应的访问入口和局域网 IPv4 候选地址。普通启动日志不会打印
`VNC_PASSWORD`、`API_KEY` 或 `ADMIN_TOKEN`。

玩家可以在游戏的合作模式里使用局域网 IP 直连。当前脚本生成的
`data/settings/server-settings.json` 默认设置 `"AllowIpConnections": true`。
Windows 本机测试必须先输入 `127.0.0.1`；同一局域网其他设备输入服务器主机的
WLAN / Ethernet IPv4 地址。如果改过端口，直连时使用 `.env` 里的 `GAME_PORT`。
不确定该填哪个地址时执行：

```powershell
.\setup.ps1 join-info
```

Linux / macOS：

```bash
./scripts/sdv-server.sh join-info
```

## Web 管理面板

如果不想手动编辑 `.env` 和 `data/settings/server-settings.json`，可以启动管理面板：

Windows：

```powershell
.\setup.ps1 admin
```

Linux / macOS：

```bash
./scripts/sdv-server.sh admin
```

`admin` 是前台临时模式，SSH 断开或终端关闭后面板也会停止。公网服务器建议使用
systemd 常驻模式：

```bash
sudo ./scripts/sdv-server.sh admin-service-install
sudo ./scripts/sdv-server.sh admin-service-status
sudo ./scripts/sdv-server.sh admin-service-logs
```

systemd 模式默认监听 `127.0.0.1:8088`，再在 1Panel 里把
`sdv.example.com` 反向代理到 `http://127.0.0.1:8088`。HTTPS 证书配置在
1Panel 网站层，反代目标仍然使用 HTTP。首次启动会在 `.env` 中生成
`ADMIN_TOKEN`，面板登录时从 `.env` 复制该值；终端和 systemd 日志不会打印完整令牌。管理面板可以查看
容器健康状态、加入地址、在线玩家名称、最近日志，保存农场地图、人数、小屋数量、
端口、进服密码、管理员 Steam64 ID 等配置，管理当前 saves volume 里的存档和备份，
并对玩家执行授予管理员、删除离线农场角色等操作。

面板右上角可以切换简体中文 / English。前端文案集中在
`scripts/admin-panel/i18n.js`，新增语言时按现有 key 补齐一份字典即可。

安全默认值会拒绝把 Web 管理面板以明文 HTTP 直接监听到公网地址。推荐保持
`ADMIN_HOST=127.0.0.1`，由 1Panel 或其他 HTTPS 反向代理访问。如果只在可信内网
临时直连 `0.0.0.0`，需要显式设置 `ADMIN_ALLOW_PUBLIC_HTTP=true`。

首次执行 `setup` 结束后，脚本会询问是否立即启动 Web 管理面板。选择 `y`
会保持当前终端用于运行面板；跳过后也可以随时执行上面的 `admin` 命令再打开。
如果 `ADMIN_TOKEN` 已经泄露，执行：

```bash
./scripts/sdv-server.sh admin-token-rotate
sudo ./scripts/sdv-server.sh admin-service-restart
```

保存配置不会热更新游戏进程。端口、人数、IP 直连等运行配置需要重启服务端后生效；农场地图、农场名、初始小屋数量、利润比例只对新建农场生效。要创建新地图，请在“存档管理”里点击“创建地图”，填写独立的新地图表单后确认开服；旧存档不会删除。要切换已有存档，请在“存档管理”里选择下次加载的存档，然后重启服务端。要删除单个可加载存档，请在“存档管理”里点击该存档的“删除”；面板会先自动备份整个 saves volume，再只删除选中的存档目录。恢复备份会覆盖整个 saves volume，面板会在恢复前自动创建一份当前状态备份。公网服务器优先只开放 80/443 给 1Panel；除非你明确需要直连管理端口，否则不要把 `ADMIN_PORT` 暴露到公网。

游戏本身会自动保存到 Docker saves volume；Web 管理面板的“备份”是额外导出的
`backups/saves-*.tar.gz` 压缩包。可以在“存档管理”里开启自动备份，配置备份间隔
和最多保留数量。每次自动或手动创建备份后，面板会按保留数量删除最旧的备份包。

面板里的“停服释放资源”会执行 `docker compose down`，停止游戏、Steam
授权和可选 Discord 容器以释放 CPU/内存，但不会删除 Docker volumes、存档、
配置或备份。Web 管理面板本身仍然运行，后续可以直接点“启动服务端”恢复。
停服前会先判断：在线人数为 0 时允许直接停；在线人数大于 0 且近期检测到
`SaveGame.Save` 完成时提示可以安全停止；在线人数大于 0 且近期没有完成存档时，
面板会建议等待下一次过夜存档，确认后会自动检测到 `SaveGame.Save` 再停服。

玩家管理依赖 JunimoServer 的 HTTP API。当前镜像已经支持读取在线玩家、读取农场角色、
授予管理员以及删除离线角色；但没有暴露 HTTP 踢出/封禁接口，所以面板会把“踢出/封禁”
标记为不可用，避免误以为已经生效。真正踢出或封禁仍需游戏内管理员使用 `!kick` / `!ban`，
或等待服务端镜像提供对应 API。

也可以使用日志中的 invite code 加入；但如果 Steam / Galaxy P2P 不稳定，优先使用局域网 IP。
邀请码和 IP 直连是两个入口：邀请码填邀请码入口，IP 地址填 LAN/IP 入口，不要混用。

如果 noVNC 页面一直显示 `Connecting...` 或看起来像一张静态图片，通常是浏览器端还没完成
VNC 密码认证。可以临时使用带参数的地址打开：

```text
http://127.0.0.1:5800/?shared=true&resize=scale&path=websockify&password=你的VNC密码
```

`你的VNC密码` 来自本地 `.env` 的 `VNC_PASSWORD`。不要把这个完整地址发到 Issue、聊天或截图里。
`resize=scale` 表示浏览器只做本地缩放，不会因为 Codex 内置浏览器窗口较小而压缩远程桌面。
如果远程尺寸已经被 noVNC 或原生 VNC 改乱、出现黑边或空白，执行 `.\setup.ps1 vnc-resize`
会立即按 `.env` 的 `DISPLAY_WIDTH` / `DISPLAY_HEIGHT` 恢复当前 X11/VNC 桌面和 Stardew 窗口。
如果需要浏览器窗口变化时同步改变远程桌面，可临时把 URL 里的 `resize=scale` 改成 `resize=remote`。

如果想用 TigerVNC、RealVNC 等 Windows 原生 VNC 客户端，另开一个终端执行：

```powershell
.\setup.ps1 vnc-proxy
```

保持这个终端打开，然后在 VNC 客户端连接：

```text
127.0.0.1:5900
```

密码使用本地 `.env` 里的 `VNC_PASSWORD`。

RealVNC 如果能看到画面但不能点击，先确认 Viewer 没有开启 `View-only`，
再用 `http://localhost:5800` 对照测试。若 noVNC 可点击而 RealVNC 不可点击，
建议优先使用 noVNC 或 TigerVNC；详细排查见 [故障排查](docs/TROUBLESHOOTING.md)。
如果 noVNC 和所有原生 VNC 客户端都不能点击，按故障排查里的
`XVNC_SERVER_CUSTOM_PARAMS` 和 X11 事件监听步骤处理，也可以直接执行：

```powershell
.\setup.ps1 vnc-fix
.\setup.ps1 vnc-check
```

如果 VNC 里能看到 `Paused`、`Auto Mode On`，但按 `Esc` 不像普通游戏那样弹菜单，
通常是 JunimoServer 自动托管模式正在接管主机。执行 `.\setup.ps1 host-auto`
可等价切换左侧提示里的 F9 自动模式；执行 `.\setup.ps1 host-visibility`
可等价切换 F10 可见性。

基础冒烟通过后，日志通常会显示 invite code。玩家加入前请确认：

- `server` 和 `steam-auth` 容器都是 `healthy`
- `5800` 和 `8080` 端口可达
- 日志中有 `IP connections enabled (AllowIpConnections=true)`
- 日志中有 `SaveGame.Save() completed without exceptions`
- 日志中没有持续刷出的 `Callback dispatcher is not initialized`

如果部署在公网服务器，需要在防火墙和云厂商安全组中放行对应端口。
Web 管理面板建议通过 1Panel 站点反向代理访问，不直接开放 `8088/tcp`；
公网玩家直连游戏时重点放行 `24642/udp` 和 `27015/udp`。

## 配置说明

复制 `.env.example` 后得到的 `.env` 是本地私密配置，不应提交到 Git。

关键配置：

- `STEAM_USERNAME`：拥有星露谷物语的 Steam 账号。
- `STEAM_PASSWORD`：Steam 密码。只保存在本地 `.env`。
- `IMAGE_VERSION`：默认 `preview`，因为部分 JunimoServer sidecar 镜像目前没有 `latest` 标签。
- `VNC_PASSWORD`：Web 管理入口密码。
- `API_KEY`：HTTP API 密钥。
- `ADMIN_TOKEN`：Web 管理面板令牌。
- `ADMIN_HOST` / `ADMIN_PORT`：Web 管理面板监听地址和端口。
- `ADMIN_ALLOW_PUBLIC_HTTP`：是否允许管理面板明文 HTTP 监听非本机地址。默认关闭；公网建议走 HTTPS 反向代理。
- `SERVER_PASSWORD`：玩家进服后的登录密码，留空表示关闭。
- `GAME_PORT` / `QUERY_PORT`：游戏连接和查询端口。
- `AUTO_BACKUP_ENABLED`：是否由 Web 管理面板定时导出 saves volume 备份。
- `SAVE_BACKUP_INTERVAL_MINUTES`：自动备份间隔，范围 15 到 10080 分钟。
- `SAVE_BACKUP_RETENTION`：最多保留多少份 `backups/saves-*.tar.gz` 备份，超出后删除最旧备份。
- `NEXUS_API_KEY`：可选。用于 Web 管理面板读取 Nexus 文件列表和下载链接；不配置时仍可使用 SMAPI 搜索和“从 URL 安装”。

## Mod 管理

本项目预留了本地 Mod 目录：

```text
data/mods/
```

把 SMAPI Mod 解压到这个目录后重启服务器：

```powershell
.\setup.ps1 restart
```

Web 管理面板的“模组”页会读取 `manifest.json`，显示已安装 Mod 的名称、版本、
作者、UniqueID 和 UpdateKeys。页面支持直接搜索 SMAPI 兼容列表，搜索结果包含 Nexus ID
时会尝试通过 `NEXUS_API_KEY` 读取 Nexus 文件列表，按主文件、补丁 / 更新、可选文件和旧版本分组展示，
并优先标出推荐主文件。

不配置 `NEXUS_API_KEY` 也能使用搜索和“从 URL 安装”。从 Nexus、GitHub 或 SMAPI 页面复制公开 zip
下载 URL 后，面板会在后端下载、校验并安装到 `data/mods/`。覆盖安装同名 Mod 时，旧目录会先移动到
`backups/mods/`。当前页面不会把 Steam Workshop 伪装成安装源；Stardew Valley 的主流 SMAPI Mod
通常通过 Nexus Mods、作者页面或社区发布页分发。

如果 Mod 已经生成 `config.json`，模组列表会显示“配置”按钮。面板会校验 JSON，保存前把旧配置备份到
`backups/mod-configs/`，保存后需要重启服务端才会让 SMAPI 和 Mod 重新读取配置。

建议一次只新增一个 Mod，并按照 [测试计划](docs/TEST_PLAN.md) 进行过夜、节日、地震和重启验证。

新增或升级 Mod 前，先执行：

```powershell
.\setup.ps1 backup
```

## 必测场景

无头服务器最容易出问题的不是启动，而是游戏日程推进。尤其要排查：

- 春 5 矿洞开启
- 夏 3 地震 / 铁路开启
- 雷雨、闪电、绿色雨、暴雪和天气 Mod
- 节日当天进入和离开节日地图
- 夜间保存和多人过夜
- 玩家断线、重连、容器重启
- 特殊事件后的备份、重启和再次加载
- 长时间无人在线时的时间推进策略
- 新增、删除或升级 Mod 后的存档兼容

完整排查矩阵见 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

## 日常维护

- 日常操作：[docs/OPERATIONS.md](docs/OPERATIONS.md)
- Steam 下载备用流程：[docs/STEAM_DOWNLOAD_FALLBACK.md](docs/STEAM_DOWNLOAD_FALLBACK.md)
- 故障排查：[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- 自动化测试：[docs/AUTOMATED_TESTING.md](docs/AUTOMATED_TESTING.md)
- 安全说明：[SECURITY.md](SECURITY.md)

## 目录结构

```text
StardewValleyServerKit/
├── docker-compose.yml
├── .env.example
├── setup.ps1
├── scripts/
│   ├── admin-panel.js
│   ├── vnc-proxy.js
│   ├── sdv-server.ps1
│   ├── sdv-server.sh
│   └── admin-panel/
│       ├── api-routes.js
│       ├── i18n.js
│       ├── mods.js
│       ├── page.js
│       ├── players.js
│       ├── save-repair.js
│       └── utils.js
├── docs/
│   ├── AUTOMATED_TESTING.md
│   ├── TEST_PLAN.md
│   ├── OPERATIONS.md
│   ├── STEAM_DOWNLOAD_FALLBACK.md
│   ├── TROUBLESHOOTING.md
│   └── assets/donation/
├── data/
│   ├── mods/
│   └── settings/
├── backups/
├── logs/
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE
```

## 上游项目

- [JunimoServer](https://github.com/stardew-valley-dedicated-server/server)
- [JunimoServer 文档](https://stardew-valley-dedicated-server.github.io/server/)
- [SMAPI](https://smapi.io/)
- [Stardew Valley](https://www.stardewvalley.net/)

## 支持项目

如果这个项目对你有帮助，欢迎通过赞赏支持持续维护。

<table>
  <tr>
    <td align="center">
      <img src="./docs/assets/donation/weixin.png" alt="微信赞赏码" width="220" />
      <br />
      微信赞赏码
    </td>
    <td align="center">
      <img src="./docs/assets/donation/zhifubao.jpg" alt="支付宝收款码" width="220" />
      <br />
      支付宝收款码
    </td>
  </tr>
</table>

## 开源协议

本项目使用 [MIT License](LICENSE)。
