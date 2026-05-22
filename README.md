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

## 快速开始

### Windows

```powershell
cd C:\Users\wuxianggujun\CodeSpace\StardewValleyServerKit
.\setup.ps1 setup
```

脚本会完成：

- 生成本地 `.env`
- 自动生成 VNC 密码和 API Key
- 拉取 Docker 镜像
- 执行 Steam 授权和游戏文件下载
- 启动无头服务器
- 打印管理面板、noVNC、HTTP API、游戏直连 IP/端口等访问入口
- 询问是否立即启动本地 Web 管理面板

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
.\setup.ps1 vnc-check
.\setup.ps1 vnc-fix
.\setup.ps1 vnc-resize
.\setup.ps1 host-auto
.\setup.ps1 host-visibility
```

如果 Steam 登录成功，但 `download` 在 manifest 下载阶段出现 `403 (Forbidden)`，
或 SteamCMD 出现 `state is 0x402 after update job`，请改用：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

该备用流程会同时下载 Stardew Valley 本体和 Steamworks SDK。SDK 缺失时，
JunimoServer 的 Steam SDR / GameServer 模式可能启动不完整。

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
./scripts/sdv-server.sh vnc-check
./scripts/sdv-server.sh vnc-fix
./scripts/sdv-server.sh vnc-resize
./scripts/sdv-server.sh host-auto
./scripts/sdv-server.sh host-visibility
```

## 访问入口

- Web noVNC：`http://localhost:5800`
- HTTP API：`http://localhost:8080`
- 本地 Web 管理面板：`http://localhost:8088`
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

如果不想手动编辑 `.env` 和 `data/settings/server-settings.json`，可以启动本地管理面板：

Windows：

```powershell
.\setup.ps1 admin
```

Linux / macOS：

```bash
./scripts/sdv-server.sh admin
```

默认地址是 `http://127.0.0.1:8088`。首次启动会在 `.env` 中生成 `ADMIN_TOKEN`，终端也会打印一次。管理面板可以查看容器健康状态、加入地址、最近玩家活动、最近日志，并保存农场地图、人数、小屋数量、端口、进服密码、管理员 Steam64 ID 等配置。

首次执行 `setup` 结束后，脚本会询问是否立即启动本地 Web 管理面板。选择 `y`
会保持当前终端用于运行面板；跳过后也可以随时执行上面的 `admin` 命令再打开。

保存配置不会热更新游戏进程。端口、人数、IP 直连等配置需要重启服务端后生效；农场地图、农场名、初始小屋数量、利润比例通常只对新建农场生效。管理面板默认只监听 `127.0.0.1`，公网服务器不要直接暴露 `ADMIN_HOST=0.0.0.0`，除非已经放在可信防火墙或反向代理之后。

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

## 配置说明

复制 `.env.example` 后得到的 `.env` 是本地私密配置，不应提交到 Git。

关键配置：

- `STEAM_USERNAME`：拥有星露谷物语的 Steam 账号。
- `STEAM_PASSWORD`：Steam 密码。只保存在本地 `.env`。
- `IMAGE_VERSION`：默认 `preview`，因为部分 JunimoServer sidecar 镜像目前没有 `latest` 标签。
- `VNC_PASSWORD`：Web 管理入口密码。
- `API_KEY`：HTTP API 密钥。
- `ADMIN_TOKEN`：本地 Web 管理面板令牌。
- `ADMIN_HOST` / `ADMIN_PORT`：本地 Web 管理面板监听地址和端口。
- `SERVER_PASSWORD`：玩家进服后的登录密码，留空表示关闭。
- `GAME_PORT` / `QUERY_PORT`：游戏连接和查询端口。

## Mod 管理

本项目预留了本地 Mod 目录：

```text
data/mods/
```

把 SMAPI Mod 解压到这个目录后重启服务器：

```powershell
.\setup.ps1 restart
```

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
│   ├── sdv-server.ps1
│   └── sdv-server.sh
├── docs/
│   ├── TEST_PLAN.md
│   ├── OPERATIONS.md
│   ├── TROUBLESHOOTING.md
│   └── assets/donation/
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
