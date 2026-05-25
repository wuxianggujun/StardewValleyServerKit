# 日常维护

## 启动和停止

Windows：

```powershell
.\setup.ps1 login
.\setup.ps1 download
.\setup.ps1 steamcmd-download
.\setup.ps1 smoke
.\setup.ps1 start
.\setup.ps1 stop
.\setup.ps1 restart
.\setup.ps1 backup
.\setup.ps1 admin
.\setup.ps1 admin-token-rotate
```

Linux / macOS：

```bash
./scripts/sdv-server.sh login
./scripts/sdv-server.sh download
./scripts/sdv-server.sh steamcmd-download
./scripts/sdv-server.sh smoke
./scripts/sdv-server.sh start
./scripts/sdv-server.sh stop
./scripts/sdv-server.sh restart
./scripts/sdv-server.sh backup
./scripts/sdv-server.sh admin
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-status
./scripts/sdv-server.sh admin-service-logs
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

systemd 模式默认监听 `127.0.0.1:8088`。1Panel 反向代理站点应转发到
`http://127.0.0.1:8088`；如果站点启用 HTTPS，证书配置在 1Panel 网站层，反代目标仍然
保持 HTTP。首次执行 `setup` 结束后，脚本会打印管理面板、noVNC、
HTTP API、游戏直连 IP/端口等访问入口，并询问是否立即启动 Web 管理面板。

首次启动面板会在 `.env` 中生成 `ADMIN_TOKEN`，终端也会打印一次。面板可以查看容器健康、加入地址、端口映射、资源占用、在线玩家名称、农场角色和最近日志，也可以保存常用开服配置，管理当前 saves volume 里的存档和备份，并执行授予管理员、删除离线角色等玩家管理操作。
如果令牌已经暴露，执行：

```bash
./scripts/sdv-server.sh admin-token-rotate
sudo ./scripts/sdv-server.sh admin-service-restart
```

执行 `smoke`、`start`、`restart`、`update` 后，脚本也会重新打印当前 `.env` 对应的访问入口和局域网 IPv4 候选地址。普通启动日志不会打印 `VNC_PASSWORD`、`API_KEY` 或 `ADMIN_TOKEN`。

保存配置后通常需要重启服务端。面板里的重启按钮等价于停止并重新启动 Docker Compose，在线玩家会断开。地图、农场名、初始小屋和利润比例只影响新建农场；已有存档不会被这些字段改写。要创建新地图，请在“存档管理”中点击“创建地图”，填写独立的新地图表单后确认开服。旧存档不会删除。要切换旧存档，请在“存档管理”中选择下次加载的存档，然后重启服务端。要删除单个可加载存档，请点击该存档的“删除”；面板会先自动备份整个 saves volume，再只删除选中的存档目录。

面板里的“停服释放资源”用于临时关服腾出机器资源。它会执行
`docker compose down`，停止游戏相关容器，但不会删除 volumes、存档、配置或备份。
Web 管理面板不在 Compose 服务里，因此会继续运行，后续可以点“启动服务端”恢复。

停服按钮会先检查服务端状态：

- 在线人数为 0：允许直接停服。
- 在线人数大于 0，且最近运行日志里有完成的 `SaveGame.Save`：提示“存档已完成，可以安全停止”。
- 在线人数大于 0，且最近没有完成的 `SaveGame.Save`：警告玩家可能有未保存进度；确认后进入等待模式，检测到下一次 `SaveGame.Save` 后自动停服。
- 如果 HTTP API 不可用导致无法确认在线人数，页面会要求输入 `STOP` 才允许立即停服。

公网部署优先只开放 80/443 给 1Panel 站点。除非你明确需要直连管理端口，否则不要把
`ADMIN_PORT` 暴露到公网。

## Steam 授权

首次部署需要完成一次 Steam Guard：

```powershell
.\setup.ps1 login
```

验证码必须输入到运行该命令的本机终端里。不要把验证码、账号密码或 token 发到聊天、Issue 或截图里。

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
- `8080/tcp`：HTTP API。
- `8088/tcp`：Web 管理面板。推荐只监听 `127.0.0.1`，由 1Panel 通过 80/443 反向代理访问。
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
`27015/udp`。Web 管理面板建议只通过 1Panel 站点访问，不直接开放 `8088/tcp`。

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
