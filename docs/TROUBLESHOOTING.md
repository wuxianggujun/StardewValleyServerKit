# 故障排查

## Docker 无法启动

现象：

- `docker version` 报错。
- 脚本提示 Docker 未正常运行。

处理：

1. 启动 Docker Desktop。
2. 确认 WSL2 / 虚拟化正常。
3. 重新执行 `.\setup.ps1 status`。

## Docker Hub 镜像下载超时

现象：

- `setup.sh` 停在 `Pulling Docker images`。
- 日志里出现 `registry-1.docker.io`、`auth.docker.io`、`i/o timeout`、
  `context deadline exceeded` 或 `Command timed out`。
- 阿里云等公网服务器访问 Docker Hub 很慢，导致 `cm2network/steamcmd:latest`
  或项目镜像拉取失败。

Linux 交互式部署时，脚本会先按正常方式拉取镜像。确认 Docker Hub 拉取失败后，
会询问是否临时配置 Docker 镜像加速地址并重启 Docker。只有输入 `yes` 才会继续。
脚本会在下载完成后恢复原来的 `/etc/docker/daemon.json`，并再次重启 Docker。

注意：重启 Docker 会短暂影响同一台机器上的其他 Docker 服务。如果这台服务器还跑着
1Panel、数据库、反向代理或其他业务容器，先确认可以接受短暂停顿。

交互式处理：

```bash
./setup.sh
```

如果脚本提示输入镜像加速地址，可以输入一个或多个地址，多个地址用英文逗号或空格分隔。
随后看到重启 Docker 风险提示时，输入：

```text
yes
```

非交互部署可以提前写入 `.env`：

```env
DOCKER_PULL_TIMEOUT_SECONDS=300
DOCKER_REGISTRY_MIRRORS="https://<your-mirror>"
DOCKER_TEMP_MIRROR_RESTART_DOCKER=true
```

`DOCKER_TEMP_MIRROR_RESTART_DOCKER=true` 是预授权开关，表示允许脚本自动临时修改
Docker daemon 配置并重启 Docker。普通交互部署不需要提前打开它，脚本会现场询问。

## Steam 授权失败

常见原因：

- 账号未拥有 Stardew Valley。
- 密码错误。
- Steam Guard 需要二次验证。
- Steam 登录风控。
- `steam-auth` 的 SteamClient 连接阶段失败。

处理：

1. 确认账号可在 Steam 客户端正常登录。
2. 删除错误的 `.env` 密码后重新填写。
3. 重新执行：

```powershell
.\setup.ps1 login
```

如果账号密码登录和二维码登录都出现：

```text
The SteamClient instance must be connected.
```

通常不是密码错误。它表示 `steam-auth` 还没有连上 SteamClient 链路，就执行了认证。
Steam 网页能 `curl` 通也不代表这条客户端链路可用。当前脚本会在 `download`
阶段失败后自动切换到 SteamCMD 备用流程；也可以手动执行：

Windows：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

Linux / macOS：

```bash
RETRIES=5 ./scripts/sdv-server.sh steamcmd-download
```

如果 SteamCMD 显示：

```text
This computer has not been authenticated for your account using Steam Guard.
Steam Guard code:
```

说明 SteamCMD 已经连上 Steam Public，并且账号已被识别。此时在同一个服务器终端
输入最新的 Steam Guard 验证码并回车。不要把验证码发到聊天、Issue 或截图里。

## Steam 下载 403 或 0x402

现象：

- `.\setup.ps1 login` 已成功。
- `.\setup.ps1 download` 显示账号已登录。
- 日志显示 game license 已校验通过。
- 下载 manifest 时出现 `403 (Forbidden)`。
- SteamCMD 下载到一半后出现 `state is 0x402 after update job`。

这通常不是验证码错误，也不是账号没有游戏，而是 `steam-auth` 下载器在当前
Steam CDN / manifest 链路上被拒绝。

处理：

1. 不要继续反复重试 `download`。
2. 按 [Steam 下载备用流程](STEAM_DOWNLOAD_FALLBACK.md) 使用 SteamCMD：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

脚本会自动重试，并复用已经下载到 `game-data` volume 的部分文件。

继续处理：

3. 如果 SteamCMD 显示 `Steam Guard code:`，在同一个本机终端输入验证码。
4. 如果终端断开但容器还在等待，执行：

```powershell
docker ps --filter ancestor=cm2network/steamcmd:latest
docker attach <container-id>
```

接回后直接输入验证码并回车。不要把验证码发到聊天、Issue 或截图里。

## Steam GameServer / SDR 初始化异常

现象：

- 日志持续刷出 `Callback dispatcher is not initialized`。
- 日志出现 `GameServer.Init() failed`。
- 日志提示 `Steam SDK not found`。
- Steam 客户端无法通过 invite code 加入。

处理：

1. 确认游戏文件和 Steamworks SDK 都已下载：

```powershell
docker run --rm `
  -v stardew-valley-server-kit_game-data:/data/game:ro `
  alpine:3.20 sh -c 'test -f /data/game/StardewValley; echo GAME=$?; test -f /data/game/.steam-sdk/linux64/steamclient.so -o -f /data/game/.steam-sdk/steamclient.so; echo SDK=$?'
```

2. 如果 `SDK` 不是 `0`，重新执行：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

3. 重启并观察日志：

```powershell
.\setup.ps1 restart
.\setup.ps1 logs
```

健康日志应出现 `Steam GameServer initialized successfully`，
随后出现 `SteamGameServerNetServer added successfully` 或 invite code。

## XACT / OpenAL 音频警告

现象：

- 无头容器中出现 `Game.Initialize() caught exception initializing XACT`。
- 日志包含 `OpenAL device could not be initialized` 或 ALSA 默认设备错误。

说明：

这是容器无音频硬件时的常见噪声。只要后续日志显示存档已加载、
`SaveGame.Save() completed without exceptions`、API 端口可达，并且没有持续红色异常，
可以先记录为已知风险，不必阻塞基础冒烟。

如果游戏没有继续进入存档，或音频错误后直接退出，再把它作为启动失败处理。

## 端口冲突

现象：

- `Bind for 0.0.0.0:5800 failed`
- `port is already allocated`

处理：

修改 `.env`：

```env
VNC_PORT=5801
API_PORT=8081
GAME_PORT=24643
QUERY_PORT=27016
```

然后重启：

```powershell
.\setup.ps1 restart
```

## VNC 软件无法连接

本项目默认只暴露浏览器 noVNC：

```text
http://localhost:5800
```

不要用浏览器打开 `http://localhost:5900`。`5900` 是原生 VNC 协议端口，
不是 HTTP 页面。

当前上游镜像的 Xvnc 默认只监听容器内部 Unix socket，再由 noVNC 代理到
`5800`。因此 RealVNC、TigerVNC、UltraVNC 等原生 VNC 客户端可能会出现
“服务器已断开连接”或连接后立即退出。优先使用浏览器访问 `5800`。

如果必须使用原生 VNC 客户端，另开一个终端启动本地代理：

```powershell
.\setup.ps1 vnc-proxy
```

保持该终端打开，然后在 VNC 客户端连接：

```text
127.0.0.1:5900
```

这个代理只监听本机 `127.0.0.1`，作用是把 Windows TCP 连接转发到容器内的
`/tmp/vnc.sock`。关闭代理终端后，原生 VNC 客户端会断开；浏览器 noVNC 不受影响。

检查端口：

```powershell
Test-NetConnection 127.0.0.1 -Port 5800
Test-NetConnection 127.0.0.1 -Port 5900
```

VNC 密码使用 `.env` 里的 `VNC_PASSWORD`。不要把密码发到聊天、Issue 或截图里。

## RealVNC 能连接但不能点击

如果 RealVNC Viewer 已经连上并能看到画面，但鼠标点击或键盘输入没有反应，优先按下面顺序排查：

1. 先用浏览器打开 `http://localhost:5800` 测试 noVNC。
   如果 noVNC 可以点击，说明游戏、Xvnc 和容器输入链路正常，问题集中在 RealVNC 客户端或本地代理。
2. 检查 RealVNC Viewer 是否处于只读模式。
   在 RealVNC Viewer 工具栏或 `F8` 菜单中关闭 `View-only`、`View only`、`Disable remote input` 等输入限制。
3. 断开 RealVNC，关闭旧的代理终端，重新启动代理：

```powershell
.\setup.ps1 vnc-proxy
```

代理终端出现 `VNC client connected` 后再操作 RealVNC。关闭 RealVNC 时应看到 `VNC client disconnected`。

4. 如果 RealVNC 仍然不能点击，优先改用 TigerVNC Viewer 连接：

```text
127.0.0.1:5900
```

当前原生 VNC 支持是通过 Windows TCP 到容器 Unix socket 的本地代理实现的。
不同 VNC 客户端对输入事件和像素格式的处理不完全一致；如果 noVNC 或 TigerVNC 正常，
但 RealVNC 不能点击，可按 RealVNC 客户端兼容性问题记录。

5. 如果 noVNC 也不能点击，再检查游戏是否被菜单、剧情、弹窗或 Mod 窗口阻塞，并查看日志：

```powershell
docker compose --env-file .env logs --tail 220 --no-color server |
  Select-String -Pattern 'SMAPI|error|exception|Xvnc|VNC|save|XML|content'
```

## noVNC 和原生 VNC 都不能点击

如果浏览器 noVNC、RealVNC、TigerVNC 都能看到画面但都不能点击，问题通常不在客户端，
而在容器内 VNC 输入链路。

先执行内置修复命令，把 VNC 切到更稳定的交互配置，并重建 `server` 容器：

```powershell
.\setup.ps1 vnc-fix
```

这个命令会设置：

```env
DISABLE_RENDERING=false
XVNC_SERVER_CUSTOM_PARAMS="-AcceptPointerEvents=1 -AcceptKeyEvents=1 -AcceptSetDesktopSize=1 -AlwaysShared=1 -DisconnectClients=0"
```

它会移除 `-RawKeyboard=1`。该参数在部分 noVNC / 原生 VNC 客户端组合里会让按键映射或按下/释放顺序异常，
不适合作为默认交互配置。修复命令只重建 `server` 容器，不删除 Docker volume 里的游戏文件和存档。

如果只想查看当前运行状态，不修改配置：

```powershell
.\setup.ps1 vnc-check
```

如果 noVNC 页面显示 `Connecting...`，并且状态栏或浏览器日志提示 `Credentials needed` /
`Server asked for credentials`，说明还没有完成 VNC 密码认证。先用带密码参数的地址验证：

```text
http://127.0.0.1:5800/?shared=true&resize=scale&path=websockify&password=你的VNC密码
```

`你的VNC密码` 来自本地 `.env` 的 `VNC_PASSWORD`。这个地址包含敏感信息，只能在本机浏览器使用，
不要发到聊天、Issue 或截图里。认证成功后，状态应变为 `Connected (unencrypted)`。

`resize=scale` 只做本地缩放，不会因为浏览器窗口较小而压缩远程桌面。
如果 noVNC 或原生 VNC 把远程尺寸改乱，导致画面黑边、空白或比例不匹配，
先执行轻量恢复命令：

```powershell
.\setup.ps1 vnc-resize
```

它不会重建容器，也不会改 Docker volume，只会按 `.env` 中的 `DISPLAY_WIDTH` /
`DISPLAY_HEIGHT` 恢复当前 X11/VNC 桌面尺寸，并同步调整 Stardew 窗口。
如果还需要修复输入参数和 Stardew 启动分辨率，再执行 `.\setup.ps1 vnc-fix`。
如果明确需要浏览器窗口变化时同步改变远程桌面，可临时把 URL 里的
`resize=scale` 改成 `resize=remote`。

先确认 Xvnc 启动参数包含输入开关：

```powershell
docker exec sdv-server sh -lc "ps -ef | grep '[X]vnc'"
```

输出中应包含：

```text
-AcceptPointerEvents=1 -AcceptKeyEvents=1 -AcceptSetDesktopSize=1 -AlwaysShared=1 -DisconnectClients=0
```

这些参数由 `.env` 或 `docker-compose.yml` 里的 `XVNC_SERVER_CUSTOM_PARAMS` 注入。
它们的作用是：

- 显式允许鼠标事件。
- 显式允许键盘事件。
- 显式允许支持该能力的 VNC 客户端请求改变远程桌面尺寸。
- 避免多个 VNC 客户端互相踢掉连接。

修改后需要重建 server 容器：

```powershell
docker compose --env-file .env up -d --force-recreate server
```

如果参数已生效但仍怀疑不能点击，可用一个临时 X11 测试窗口确认输入是否进入桌面：

```powershell
.\setup.ps1 vnc-check
```

在另一个终端运行：

```powershell
docker exec -it sdv-server sh -lc "DISPLAY=:0 timeout 30 xev -geometry 260x160+40+40 -event mouse -event keyboard"
```

然后在 noVNC 画面里点击左上角新出现的小 `xev` 窗口，并按 F9/F10。
如果输出包含 `ButtonPress`、`ButtonRelease`、`KeyPress` 或 `KeyRelease`，
说明浏览器/noVNC/Xvnc 输入链路是通的。

不要用 JunimoServer 左侧的 `Auto Mode`、`Visibility` 等状态文字当鼠标点击测试。
它们是状态和热键提示，画面也可能在 `Paused` / `0 Players Online` 状态下显示，
不一定按普通按钮处理鼠标点击。也不要只依赖 `xev -id` 监听星露谷主窗口判断鼠标链路，
游戏窗口或 Mod 叠层可能自己处理输入事件，独立 `xev` 测试窗口更适合验证 VNC 本身。

如果临时 `xev` 窗口能收到 `Escape`、`F9` 或 `F10`，但游戏画面仍显示 `Paused` /
`Auto Mode On`，说明 VNC 输入已经进入 X11，卡点在 JunimoServer 自动托管模式。
可以不用依赖 VNC 热键，直接从本机终端切换：

```powershell
.\setup.ps1 host-auto
.\setup.ps1 host-visibility
```

`host-auto` 等价于左侧提示里的 F9，会切换主机自动模式；`host-visibility`
等价于 F10，会切换主机可见性。关闭自动模式后，画面应恢复普通游戏 HUD，
右上角时间和底部工具栏会重新出现。

如果临时 `xev` 窗口没有任何 `ButtonPress`、`ButtonRelease`、`KeyPress` 或 `KeyRelease`，
说明输入没有进入 X11，属于容器 VNC 输入链路异常。
这种情况下优先继续使用 HTTP API、JunimoServer 自动化能力和玩家客户端测试，不要把它误判为存档损坏。

如果 `xev` 收不到任何事件，但 VNC 画面本身持续刷新，问题大概率落在上游镜像的
websockify/noVNC 与 Xvnc 组合上。此时不要继续反复更换 VNC 客户端；应把 VNC
当作观察入口，并通过 API、日志和真实玩家客户端继续验证服务器功能。

## 玩家无法加入

排查顺序：

1. 先确认入口没有混用：邀请码填邀请码入口，IP 地址填 LAN/IP 入口。
2. 本机客户端先测 `127.0.0.1`。不要先填 WLAN IP 排查本机客户端。
3. 其他局域网设备使用服务器主机的 WLAN / Ethernet IPv4。不要使用 VMware、WSL、Hyper-V、Docker 网卡地址。
4. 查看当前推荐地址、邀请码和端口状态：

```powershell
.\setup.ps1 join-info
```

Linux / macOS：

```bash
./scripts/sdv-server.sh join-info
```

5. 如果要用 IP 直连，确认 `data/settings/server-settings.json`：

```json
"AllowIpConnections": true
```

6. 重启服务器后查看日志是否出现：

```text
IP connections enabled (AllowIpConnections=true)
```

7. 确认 Docker 已映射 UDP 端口：

```powershell
docker port sdv-server
```

应包含：

```text
24642/udp -> 0.0.0.0:24642
27015/udp -> 0.0.0.0:27015
```
8. 加入时同时查看 `.\setup.ps1 logs`。如果日志完全没有连接尝试，优先排查目标 IP、Windows 防火墙、路由器 AP 隔离或云安全组。
9. 确认客户端游戏版本和服务器游戏版本一致。
10. 公网服务器还要检查云厂商安全组，至少放行游戏 UDP 端口。

## 过夜卡住

重点怀疑：

- 无头房主被剧情、菜单或 Mod 弹窗阻塞。
- 某个玩家没有进入睡觉状态。
- Mod 修改了保存流程。

处理：

1. 记录游戏日期和在线玩家。
2. 查看 SMAPI 日志。
3. 临时移除最近新增的 Mod。
4. 用测试存档复现。
5. 对照 `TEST_PLAN.md` 检查特殊日期。

## 过夜时报 `LidgrenServer.playerDisconnected`

现象：

- 日志重复出现 `Error on new day`。
- 同时出现 `KeyNotFoundException: The given key '...' was not present in the dictionary`。
- 堆栈包含 `StardewValley.Network.LidgrenServer.playerDisconnected`、
  `NetSynchronizer.barrier("new day")` 或 `_newDayTask failed`。

这类日志表示游戏本体在新一天多人同步阶段处理某个断线玩家 ID 时崩溃。
它不是 Web 管理面板崩溃，也不等同于某个 Mod 的 `manifest.json` 加载失败。
常见触发因素是过夜时玩家断线、联机状态残留、农场手/小屋引用不一致，
或者新增 Mod 在过夜阶段改变多人/保存流程。

长期预防需要加载系统保护 Mod `SVSK Crash Guard`。它只拦截
`LidgrenServer.playerDisconnected(long)` / `GameServer.playerDisconnected(long)` 中已知的
`KeyNotFoundException` 断线竞态，不会改变 `data/mods` 用户 Mod 目录，也不会遮住镜像内置的
JunimoServer API Mod。

服务器更新步骤：

```bash
cd /opt/stardew/StardewValleyServerKit || exit 1
git pull --ff-only
bash ./scripts/build-crash-guard.sh
docker compose --env-file .env down
docker compose --env-file .env up -d
docker compose --env-file .env ps
docker compose --env-file .env logs --no-color server | grep -E "SVSK Crash Guard|Suppressed missing player disconnect|Loaded [0-9]+ mods" | tail -n 80
sudo systemctl restart sdv-admin.service
```

`bash ./scripts/build-crash-guard.sh` 会用 `game-data` Docker volume 里的已安装 SMAPI
构建 `system-mods/SVSKCrashGuard/dist/SVSKCrashGuard.dll`。如果脚本提示找不到
`StardewModdingAPI.dll`，先完成一次游戏下载/启动，让镜像把 SMAPI 安装进 `game-data` volume，
再重新执行构建脚本。

`docker compose down/up -d` 只会重建游戏容器，保留存档、Mod 和 Docker volume。
`sudo systemctl restart sdv-admin.service` 只重启 Web 管理面板，不能让游戏进程重新加载 SMAPI Mod。

如果重启后能正常进入，先让所有玩家在稳定网络下完成一次过夜保存。

如果每次过夜仍复现：

1. 在 Web 管理面板执行“一键诊断”，确认 `Game crash` 区块识别到
   `newDayDisconnectCrash=true`。
2. 确认没有玩家在线。
3. 在“存档管理”里先创建备份。
4. 打开当前存档的“配置”，按当前目标小屋/角色槽执行“修复小屋”。
   该功能会修正小屋引用、农场角色 `UniqueMultiplayerID` 和缺失的角色槽。
5. 再重启服务端并测试一次过夜。

如果崩溃是在新增或更新 Mod 后才出现，先不要删除真实存档。
把最近新增的 Mod 临时移到 `backups/mods/manual-quarantine-*`，
重启并完成一次过夜验证。确认稳定后，再按一次一个 Mod 的方式恢复。

## 地震或节日后异常

重点记录：

- 触发日期。
- 是否多人在线。
- 是否在过夜期间断线。
- 当天是否新增 Mod。
- 服务器日志中的第一条红色异常。

处理建议：

1. 回滚到事件前备份。
2. 关闭新增 Mod。
3. 单人加入并推进同一天。
4. 如果单人正常，再测试多人。

## 极端天气后卡死

重点怀疑：

- 雷雨、闪电、绿色雨或天气 Mod 触发了地图对象变化。
- 天气事件和节日、剧情、NPC 行程在同一天重叠。
- 无头房主停在需要人工确认的对话、电视、邮件或弹窗。
- Mod 修改了天气、季节、地图加载或时间流速。

处理建议：

1. 先执行 `.\setup.ps1 logs`，记录第一条红色异常。
2. 不要继续推进真实存档，先复制日志并保留当前 `backups/`。
3. 回滚到天气事件前的备份，在测试存档中复现。
4. 临时移除最近新增的天气、季节、地图和时间类 Mod。
5. 单人复现成功后，再测试多人加入、断线和重连。

## 怀疑存档损坏

重点表现：

- 重启后无法加入农场。
- 日志出现持续的 save、XML、content 或 SMAPI 读取异常。
- 最近一天数据丢失、事件重复触发或地图物体消失。
- 过夜时卡住，重启后仍回不到稳定保存点。

处理建议：

1. 立即停止继续写入当前存档。
2. 保存 `.\setup.ps1 logs` 的异常摘要。
3. 记录最后一次可正常进入的游戏日期。
4. 从 `backups/` 找到事件前备份。
5. 先在测试环境验证备份可加载，再考虑恢复真实存档。

恢复存档会覆盖当前数据，属于高风险操作。当前脚本只提供备份命令，
不自动恢复，避免误覆盖。

## 安装 Mod 后一直 restarting / unhealthy

现象：

- 管理面板“运行状态”长期显示 `sdv-server=restarting / unhealthy`。
- 发生在安装、升级或修改 Mod 配置并重启之后。
- 玩家无法加入，邀请代码和当前农场信息可能都是 `n/a`。
- 日志显示 `cp: cannot stat '/data/game/Mods/*': No such file or directory`。

这里有两个不同的 Mod 路径：

- `data/mods`：宿主机目录，会挂载成容器里的 `/data/Mods/user`。这是玩家和管理面板使用的
  SMAPI Mod 目录，Mod 运行后生成的配置会继续写回这里。
- `/data/Mods`：镜像内置和运行时的 SMAPI 加载目录，里面包含 JunimoServer API Mod。不要把宿主机
  `data/mods` 直接挂到 `/data/Mods` 根目录，否则会遮住内置 API Mod，导致 HTTP API 出现 `socket hang up` 或不可用。

如果 `/data/game/Mods` 不存在或完全为空，镜像脚本里的 `cp /data/game/Mods/* ...`
会因为空 glob 失败，导致 `app` 服务退出。新版管理面板会在每次启动/重启前自动创建
`/data/game/Mods/SVSK_PLACEHOLDER.txt`，`docker-compose.yml` 里的 `init-game-mods`
一次性服务也会在每次 `docker compose up` 前创建它。这个普通文本文件会被 SMAPI 忽略。

处理：

1. 先查看最近日志，找到第一条 SMAPI 红色异常或依赖缺失提示。

```bash
cd /opt/stardew/StardewValleyServerKit || exit 1
docker compose --env-file .env logs --tail 300 --no-color server steam-auth
```

2. 如果日志指向刚安装的 Mod，把该 Mod 临时移到备份目录，不要删除。

```bash
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "backups/mods/manual-quarantine-$stamp"
mv "data/mods/最近安装的Mod目录名" "backups/mods/manual-quarantine-$stamp/"
```

3. 重启并等待容器变为 `running / healthy`。

```bash
docker compose --env-file .env down
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

4. 如果移除后恢复，按该 Mod 页面说明补齐前置依赖，并确认它支持当前
   Stardew Valley / SMAPI 版本后再安装。

不要反复点击重启。`unless-stopped` 会让崩溃的容器持续重启，重复操作只会覆盖
最近日志，反而更难定位第一条异常。

管理面板的“模组”页可以直接点“加载检测”。新版诊断会把结果分成：

- `已加载`：SMAPI 日志确认该 Mod 已加载。
- `运行警告`：Mod 已加载，但运行时有警告，例如无头环境里音频资源初始化失败。
  这类警告不等于 Mod 加载失败。
- `异常`：SMAPI 明确提示缺少前置依赖、manifest 错误、被跳过或加载失败。
- `日志未确认`：最近日志没有覆盖启动时的 `Loaded ... mods` 摘要，不能证明该 Mod
  加载失败。通常需要重启游戏容器，让 SMAPI 重新打印启动加载日志。

诊断还会检查宿主机 `data/mods` 是否真的挂载进容器 `/data/Mods/user`。
如果容器内看不到这些 `manifest.json`，游戏里就不会有自定义 Mod 效果。

服务器上可以用下面命令手动复核三层状态：

```bash
cd /opt/stardew/StardewValleyServerKit || exit 1

echo "===== host data/mods ====="
find data/mods -maxdepth 6 -type f -iname manifest.json 2>/dev/null \
  | sed 's#^data/mods/##' \
  | sort

echo
echo "===== container /data/Mods/user ====="
docker exec sdv-server sh -lc '
find /data/Mods/user -maxdepth 6 -type f -iname manifest.json 2>/dev/null |
  sed "s#^/data/Mods/user/##" |
  sort
'

echo
echo "===== recent SMAPI load evidence ====="
docker compose --env-file .env logs --tail 5000 --no-color server |
  grep -E "Loaded [0-9]+ mods|Skipped mods|ERROR SMAPI|WARN SMAPI|/data/Mods/user|Mods/user" |
  tail -n 220
```

如果前两段列表一致，但第三段没有 `Loaded ... mods`，一般只是最近日志没覆盖启动阶段。
此时重启游戏服务端后再检测：

```bash
docker compose --env-file .env down
docker compose --env-file .env up -d
sleep 45
docker compose --env-file .env ps
docker compose --env-file .env logs --tail 5000 --no-color server |
  grep -E "Loaded [0-9]+ mods|Skipped mods|ERROR SMAPI|WARN SMAPI|SVSK Crash Guard|/data/Mods/user|Mods/user" |
  tail -n 220
```

注意：`sudo systemctl restart sdv-admin.service` 只重启 Web 管理面板，
不会让 SMAPI 重新扫描或加载 Mod。

如果诊断里显示 `Steam Auth 尚未登录`，先在服务器项目目录执行：

```bash
cd /opt/stardew/StardewValleyServerKit || exit 1
./scripts/sdv-server.sh login
```

底层等价命令是：

```bash
docker compose --env-file .env run --rm -it steam-auth login
```

如果同时看到 `Steam Guard`，验证码必须输入到运行登录命令的服务器终端，
不要发到聊天、Issue 或截图里。若诊断提示 manifest/CDN `403 Forbidden`，
改用 SteamCMD 备用下载：

```bash
./scripts/sdv-server.sh steamcmd-download
```

## Mod 依赖缺失

现象：

- SMAPI 日志提示 `missing dependency`。
- Mod 加载失败。

处理：

1. 阅读该 Mod 的说明。
2. 补齐前置依赖。
3. 确认 Mod 支持当前 Stardew Valley 和 SMAPI 版本。
4. 重启服务器。

## 管理面板显示 Mod 无配置

现象：

- “模组”页能看到 Mod，但配置按钮显示“无配置”。
- 你已经安装了 Generic Mod Config Menu，但网页里仍然没有可编辑配置。

说明：

管理面板只编辑 Mod 目录下已经存在的 `config.json`。`manifest.json` 只能说明目录是一个
SMAPI Mod，不代表它已经生成配置文件。很多 Mod 需要 SMAPI 成功加载并运行一次后才会生成
`config.json`，也有些 Mod 根本没有可编辑配置。

先确认服务器上有没有配置文件：

```bash
cd /opt/stardew/StardewValleyServerKit || exit 1

echo "===== host mods ====="
find data/mods -maxdepth 6 -type f \( -iname manifest.json -o -iname config.json \) 2>/dev/null \
  | sed 's#^data/mods/##' \
  | sort

echo
echo "HOST_MANIFEST_COUNT=$(find data/mods -type f -iname manifest.json 2>/dev/null | wc -l)"
echo "HOST_CONFIG_COUNT=$(find data/mods -type f -iname config.json 2>/dev/null | wc -l)"
```

如果 `HOST_CONFIG_COUNT=0`，网页显示“无配置”是正常结果。此时应重启游戏服务端，
让 SMAPI 和 Mod 有机会生成配置：

```bash
docker compose --env-file .env restart server
sleep 30
find data/mods -maxdepth 6 -type f -iname config.json | sort
```

如果仍然没有 `config.json`，继续看 SMAPI 是否真的加载了这些 Mod：

```bash
docker exec sdv-server sh -lc '
grep -E "Loaded [0-9]+ mods|Skipped mods|ERROR SMAPI|from Mods/" /tmp/server-output.log 2>/dev/null | tail -n 180
'
```

注意：`sudo systemctl restart sdv-admin.service` 只重启 Web 管理面板，不会让 SMAPI
重新加载 Mod，也不会生成 Mod 配置。

## 更新后无法启动

处理：

1. 查看 `.env` 中的 `IMAGE_VERSION`。
2. 改回上一个可用版本。
3. 执行：

```powershell
.\setup.ps1 restart
```

建议每次更新前记录当前版本和 Mod 列表。
