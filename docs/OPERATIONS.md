# 日常维护

最简单的入口是直接运行菜单：

```powershell
.\setup.ps1
```

Linux / macOS：

```bash
./setup.sh
```

菜单里可以填写或更新 Steam 账号密码、执行一键部署、登录验证、下载、启动、
重启、查看日志和安装 Web 管理面板。脚本只会把 Steam 凭据保存到本机 `.env`，
不会在终端打印密码或 Steam Guard 验证码。

## 启动和停止

Windows：

```powershell
.\setup.ps1 menu
.\setup.ps1 steam-config
.\setup.ps1 access-info
.\setup.ps1 login
.\setup.ps1 download
.\setup.ps1 steamcmd-download
.\setup.ps1 smoke
.\setup.ps1 start
.\setup.ps1 stop
.\setup.ps1 restart
.\setup.ps1 backup
.\setup.ps1 admin
.\setup.ps1 admin-token-show
.\setup.ps1 admin-token-rotate
```

Linux / macOS：

```bash
./scripts/sdv-server.sh menu
./scripts/sdv-server.sh steam-config
./scripts/sdv-server.sh access-info
./scripts/sdv-server.sh login
./scripts/sdv-server.sh download
./scripts/sdv-server.sh steamcmd-download
./scripts/sdv-server.sh smoke
./scripts/sdv-server.sh start
./scripts/sdv-server.sh stop
./scripts/sdv-server.sh restart
./scripts/sdv-server.sh backup
./scripts/sdv-server.sh admin
./scripts/sdv-server.sh admin-detect
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
./scripts/sdv-server.sh admin-service-status
./scripts/sdv-server.sh admin-service-logs
./scripts/sdv-server.sh admin-token-show
./scripts/sdv-server.sh admin-token-rotate
```

## 查看状态

```powershell
.\setup.ps1 status
.\setup.ps1 logs
```

重点关注：

- `sdv-server` 是否持续运行。
- `sdv-steam-auth` 是否健康。
- SMAPI 是否出现红色异常。
- 玩家加入和退出是否正常记录。

## Web 管理面板

启动管理面板：

```powershell
.\setup.ps1 admin
```

Linux / macOS：

```bash
./scripts/sdv-server.sh admin
```

`admin` 是前台临时模式，终端关闭后面板会停止。Linux 服务器部署建议改用 systemd 常驻：

```bash
sudo ./scripts/sdv-server.sh admin-service-install
sudo ./scripts/sdv-server.sh admin-service-status
sudo ./scripts/sdv-server.sh admin-service-logs
```

systemd 常驻分两种模式：

```bash
# 有 Nginx / 1Panel / HTTPS 反向代理时使用，面板只监听本机
sudo ./scripts/sdv-server.sh admin-service-install

# 新买的裸服务器没有反向代理时使用，面板直接监听公网 8088
sudo ./scripts/sdv-server.sh admin-service-install-public
```

`admin-service-install` 模式监听 `127.0.0.1:8088`。1Panel 或 Nginx 反向代理站点应转发到
`http://127.0.0.1:8088`；如果站点启用 HTTPS，证书配置在反向代理层，反代目标仍然
保持 HTTP。

`admin-service-install-public` 模式监听 `0.0.0.0:8088`，适合没有 Nginx、
没有 1Panel 的新服务器。使用这个模式时，需要在云厂商安全组和服务器防火墙放行
`8088/tcp`，然后访问 `http://<server-public-ip>:8088`。登录页使用 `.env`
里的 `ADMIN_TOKEN`。如果不想手动打开 `.env`，可以在菜单里选择
`Show web admin token`，或执行 `./scripts/sdv-server.sh admin-token-show`，
输入 `SHOW` 后只打印一次令牌。

交互式 Linux root 执行 `setup` 结束后，脚本会检测 `1Panel`、`nginx`、
`openresty`、`caddy`、`traefik`、`nginx-proxy-manager` 等 systemd 服务、
命令、常见目录或 Docker 容器。检测结果只用于推荐：检测到反向代理候选项时默认推荐
`admin-service-install`，否则默认推荐 `admin-service-install-public`。检测到反向代理
不代表已经为本项目配置好站点，所以 Web admin wizard 仍会让用户明确选择
Nginx、1Panel、其他反向代理、裸服务器公网直连、查看令牌或重置令牌。
也可以随时运行 `./scripts/sdv-server.sh admin-detect` 只读查看检测结果和推荐命令。

如果服务器没有 Node.js 18+，Linux 脚本会询问是否下载项目本地 Node.js 到
`.svsk-tools/`。非交互部署可在 `.env` 中设置 `SVSK_AUTO_INSTALL_NODE=true`。

首次执行 `setup` 结束后，脚本会打印管理面板、noVNC、HTTP API、游戏直连 IP/端口等
访问入口。交互式终端会询问是否打开 Web admin wizard；Linux root 服务器可以在向导里
选择反向代理模式、裸服务器公网直连、查看令牌或重置令牌，其他环境可以以前台临时模式
启动 Web 管理面板。

首次启动面板会在 `.env` 中生成 `ADMIN_TOKEN`。登录时可以从 `.env` 复制该值，也可以
通过菜单 12 或 `./scripts/sdv-server.sh admin-token-show` 查看；该命令必须手动输入
`SHOW`，不会默认打印令牌。面板可以查看容器健康、加入地址、端口映射、资源占用、在线玩家名称、农场角色和最近日志，也可以保存常用开服配置，管理当前 saves volume 里的存档和备份，并执行授予管理员、删除离线角色等玩家管理操作。运行配置、存档配置和 Mod 配置弹窗都提供“保存并重启”按钮，用于保存后立即重启游戏服务端。
面板右上角支持简体中文 / English 切换；前端文案集中在
`scripts/admin-panel/i18n.js`，新增语言时按现有 key 补齐字典。

安全默认值会拒绝把 Web 管理面板以明文 HTTP 直接监听到公网地址。推荐有条件时保持
`ADMIN_HOST=127.0.0.1`，由 1Panel、Nginx 或其他 HTTPS 反向代理访问。裸服务器没有
反向代理时，使用 `admin-service-install-public` 显式切换到公网直连模式。

如果令牌已经暴露，执行：

```bash
./scripts/sdv-server.sh admin-token-rotate
sudo ./scripts/sdv-server.sh admin-service-restart
```

执行 `smoke`、`start`、`restart`、`update` 后，脚本也会重新打印当前 `.env` 对应的访问入口和局域网 IPv4 候选地址。普通启动日志不会打印 `VNC_PASSWORD`、`API_KEY` 或 `ADMIN_TOKEN`。

保存配置后通常需要重启游戏服务端。面板里的重启按钮等价于停止并重新启动 Docker Compose，在线玩家会断开。`sdv-admin.service` 只是 Web 管理面板服务；重启它只会刷新网页后端，不会让 SMAPI 重新加载 Mod 或配置。地图、农场名、初始小屋和利润比例只影响新建农场；已有存档不会被这些字段改写。要创建新地图，请在“存档管理”中点击“创建地图”，填写独立的新地图表单后确认开服。旧存档不会删除。要切换旧存档，请在“存档管理”中选择下次加载的存档，然后重启服务端。要删除单个可加载存档，请点击该存档的“删除”；面板会先自动备份整个 saves volume，再只删除选中的存档目录。

面板里的“停服释放资源”用于临时关服腾出机器资源。它会执行
`docker compose down`，停止游戏相关容器，但不会删除 volumes、存档、配置或备份。
Web 管理面板不在 Compose 服务里，因此会继续运行，后续可以点“启动服务端”恢复。

停服按钮会先检查服务端状态：

- 在线人数为 0：允许直接停服。
- 在线人数大于 0，且最近运行日志里有完成的 `SaveGame.Save`：提示“存档已完成，可以安全停止”。
- 在线人数大于 0，且最近没有完成的 `SaveGame.Save`：警告玩家可能有未保存进度；确认后进入等待模式，检测到下一次 `SaveGame.Save` 后自动停服。
- 如果 HTTP API 不可用导致无法确认在线人数，页面会要求输入 `STOP` 才允许立即停服。

有反向代理时公网服务器优先只开放 80/443 给反向代理站点。裸服务器直连模式需要开放
`ADMIN_PORT`，并使用 `.env` 的 `ADMIN_TOKEN` 登录。

## Steam 授权

首次部署前可以先通过菜单的 `Fill or update Steam username/password` 填写账号密码，
也可以直接执行：

```powershell
.\setup.ps1 steam-config
```

Linux / macOS：

```bash
./setup.sh steam-config
```

随后需要完成一次 Steam Guard：

```powershell
.\setup.ps1 login
```

验证码必须输入到运行该命令的本机终端里。SteamCMD 备用流程检测到 Guard 后会用隐藏输入
读取验证码，并只通过 stdin 传给 SteamCMD；不会写入 `.env` 或日志。不要把验证码、
账号密码或 token 发到聊天、Issue 或截图里。

授权成功后再执行：

```powershell
.\setup.ps1 download
.\setup.ps1 smoke
```

如果 `download` 已经通过账号授权和 license 校验，但 manifest 下载返回
`403 (Forbidden)`，按 [Steam 下载备用流程](STEAM_DOWNLOAD_FALLBACK.md)
使用 SteamCMD 下载游戏文件：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

如果 SteamCMD 下载过程中出现 `state is 0x402 after update job`，
脚本会自动重试，并复用已经下载到 `game-data` volume 的部分文件。

SteamCMD 备用流程也可能触发 Steam Guard。验证码必须输入到运行
SteamCMD 或 `docker attach` 的本机终端里，不要发送到聊天、Issue 或截图。

## 更新镜像

```powershell
.\setup.ps1 update
```

更新前建议：

1. 停止玩家操作。
2. 完成一次过夜保存。
3. 执行 `.\setup.ps1 backup` 备份存档。
4. 记录当前 `IMAGE_VERSION`。

如果更新后异常，回退 `.env` 中的 `IMAGE_VERSION` 后重启。

## 添加 Mod

1. 停止服务器。
2. 将 Mod 解压到 `data/mods/`。
3. 启动服务器。
4. 查看日志确认依赖完整。
5. 按 `TEST_PLAN.md` 做过夜和事件测试。

```powershell
.\setup.ps1 stop
.\setup.ps1 start
.\setup.ps1 logs
```

## 备份建议

建议至少备份：

- Docker volume：`stardew-valley-server-kit_saves`
- 本地目录：`data/settings`
- 本地目录：`data/mods`
- 私密配置：`.env`

不要把 `.env` 上传到公开仓库。

当前脚本提供只追加、不删除旧文件的存档备份命令：

```powershell
.\setup.ps1 backup
```

前置条件：

- 至少启动过一次服务器。
- Docker volume `stardew-valley-server-kit_saves` 已创建。
- 最好已经完成一次过夜保存。

备份会导出 Docker volume：

```text
stardew-valley-server-kit_saves
```

输出文件位于：

```text
backups/saves-YYYYMMDD-HHMMSS.tar.gz
backups/saves-YYYYMMDD-HHMMSS.meta.txt
```

建议在以下时机备份：

- 完成一次过夜保存后。
- 测试雷雨、绿色雨、地震、节日前。
- 新增、删除或升级 Mod 前。
- 更新 Docker 镜像前。
- 迁移真实存档前。

不要在过夜保存动画、节日结算、剧情切场时强制停止容器或备份。

Web 管理面板的“存档管理”还能执行：

- 列出当前 saves volume 中可加载的存档。
- 设置下次重启要加载的存档。
- 打开独立的新地图表单，创建新地图并重启服务端；执行前会尽量自动备份当前 saves volume，旧存档保留。
- 删除单个可加载存档；执行前会自动备份整个 saves volume，并要求输入完整存档名确认。
- 立即创建一份 `backups/saves-*.tar.gz` 备份。
- 开启自动备份，并设置备份间隔与最多保留数量。
- 从备份恢复整个 saves volume；恢复前会自动先备份当前状态。
- 删除指定备份文件；页面会要求输入完整备份文件名确认。

游戏自动保存和面板备份不是一回事。游戏会把当前进度写入 saves volume；
自动备份会由常驻 Web 管理面板定时把整个 saves volume 导出到 `backups/`。
每次自动或手动创建备份后，面板会按照 `SAVE_BACKUP_RETENTION` 清理最旧的
`saves-*.tar.gz`，避免磁盘被无限占满。

恢复备份不是单个存档导入，而是整份 saves volume 回滚。执行前确认在线玩家已经下线，且当前状态已经过夜保存或可以丢弃。

## Mod 管理

Web 管理面板的“模组”页会扫描宿主机 `data/mods`，也就是容器内的
`/data/Mods/user`。这是 SMAPI 加载目录里的用户 Mod 子目录，
同时会保留镜像内置的 JunimoServer API Mod，Mod 运行后生成的配置也会继续写回宿主机。页面会递归读取 `manifest.json`，显示名称、版本、作者、UniqueID、
MinimumApiVersion、EntryDll 和 UpdateKeys；递归扫描用于兼容
`data/mods/smapi/ModName/` 这类嵌套目录。

安装建议：

- 新增或升级 Mod 前，先在“模组”页点击“安装前备份”，或执行 `.\setup.ps1 backup`。
- 优先在 SMAPI 兼容列表确认 Mod 是否支持当前游戏和 SMAPI 版本。
- 可以在模组页直接搜索 SMAPI 兼容列表；搜索结果包含 Nexus ID 时，面板会尝试用
  `NEXUS_API_KEY` 读取 Nexus 文件列表并安装所选文件。
- `NEXUS_API_KEY` 可在“配置”页的 Nexus Mods 区块设置或清空；面板不会回显已保存的 Key。
- Nexus 文件会按主文件、补丁 / 更新、可选文件、旧版本分组展示；面板会优先推荐主文件，
  补丁和可选文件仍需按 Nexus 页面说明确认依赖与安装顺序。
- Nexus API 返回 429 限流时，面板会按 `Retry-After` 或短退避自动重试；如果 Nexus 要求等待较久，
  面板会进入本地冷却并提示建议等待时间，不会长时间卡住弹窗。成功读取到的文件列表会短时间缓存，
  再次打开同一 Mod 时会标明“使用缓存”，避免持续触发限流。
- 不配置 `NEXUS_API_KEY` 也能使用搜索和“从 URL 安装”；从 Nexus、GitHub 或 SMAPI 页面
  复制公开 zip 下载 URL 后，面板会下载、校验并解压到 `data/mods`。
- 覆盖安装同名 Mod 时，旧目录会先移动到 `backups/mods`，避免留在 `data/mods` 中被 SMAPI
  重复加载。
- 如果 Mod 已生成 `config.json`，模组列表会显示“配置”按钮；保存前会校验 JSON，并把旧配置备份到
  `backups/mod-configs`。列表显示“无配置”表示当前 Mod 目录下没有 `config.json`；很多 Mod
  只有在 SMAPI 成功加载并运行一次后才会生成，也有些 Mod 根本没有可编辑配置。
- 修改 Mod 或 Mod 配置后重启游戏服务端；运行中的 SMAPI 不会稳定热加载已替换的 Mod 文件。
- 一次只新增或升级一个 Mod，完成过夜保存、重启和再次加载验证后再继续。

Stardew Valley 的主流 SMAPI Mod 不通过 SteamCMD 下载。SteamCMD 在本项目中只用于
下载或更新游戏本体。Nexus 文件列表和下载链接依赖用户自己的 Nexus API Key；Nexus 账号权限、
下载限速、429 限流或 Premium 限制可能导致自动下载失败，此时仍可使用“从 URL 安装”兜底。

## 玩家管理

Web 管理面板会通过 JunimoServer HTTP API 读取在线玩家和农场角色：

- 在线玩家列表显示玩家名称、ID 和在线状态。
- “授予管理员”会调用 `POST /roles/admin?name=...`。
- “删除离线角色”会调用 `DELETE /farmhands?name=...`，页面要求输入完整角色名称确认；在线角色不能删除。
- 当前 `sdvd/server` 镜像没有暴露 HTTP 踢出/封禁接口，面板会把“踢出/封禁”标记为不可用，不会伪装执行成功。

如果需要真正从面板踢出或封禁玩家，需要升级到暴露对应 API 的服务端镜像，或改造 JunimoServer。
在当前镜像下，真正踢出和封禁仍由游戏内管理员使用 `!kick` / `!ban` 执行。

## 端口说明

- `5800/tcp`：Web VNC 管理入口。
- `8080/tcp`：HTTP API。直接用浏览器打开会因为缺少 `Authorization: Bearer <api-key>` 返回 401；它不是网页登录页。
- `8088/tcp`：Web 管理面板。反向代理模式只监听 `127.0.0.1`；裸服务器直连模式监听 `0.0.0.0`，需要 `ADMIN_ALLOW_PUBLIC_HTTP=true` 和 `ADMIN_TOKEN` 登录。
- `24642/udp`：游戏连接端口。
- `27015/udp`：查询端口。

局域网直连需要 `data/settings/server-settings.json` 中的
`Server.AllowIpConnections` 为 `true`。脚本新建配置时会默认启用。
同一台 Windows 主机测试先在游戏里输入 `127.0.0.1`；其他局域网设备输入服务器主机
WLAN / Ethernet IPv4。不要使用 VMware、VirtualBox、WSL、Hyper-V 或 Docker 网卡地址。

查看当前加入信息和端口状态：

```powershell
.\setup.ps1 join-info
```

Linux / macOS：

```bash
./scripts/sdv-server.sh join-info
```

公网玩家直连游戏时，需要同时在系统防火墙和云厂商安全组放行 `24642/udp` 与
`27015/udp`。裸服务器直连管理面板时还需要放行 `8088/tcp`；有反向代理时优先只开放
`80/tcp` 和 `443/tcp`。

## Discord Bot

默认不启动 Discord Bot。

启用方式：

```powershell
.\setup.ps1 start -EnableDiscord
```

需要在 `.env` 中配置：

```env
DISCORD_BOT_TOKEN=""
DISCORD_CHAT_CHANNEL_ID=""
```

## 真实存档迁移

建议流程：

1. 先用全新测试存档跑完基础冒烟测试。
2. 停止服务器。
3. 执行 `.\setup.ps1 backup` 备份当前 saves volume。
4. 导入真实存档。
5. 启动服务器。
6. 完成一次加入、过夜、重启验证。

真实存档迁移前，不要一次性新增大量 Mod。
