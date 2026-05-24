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
.\setup.ps1 admin-public
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
./scripts/sdv-server.sh admin-public
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

默认监听 `0.0.0.0:8088`，本机可打开 `http://127.0.0.1:8088`，服务器部署时可打开
`http://服务器公网IP:8088`。首次执行 `setup` 结束后，脚本会打印管理面板、noVNC、
HTTP API、游戏直连 IP/端口等访问入口，并询问是否立即启动 Web 管理面板。

首次启动面板会在 `.env` 中生成 `ADMIN_TOKEN`，终端也会打印一次。面板可以查看容器健康、加入地址、端口映射、资源占用、最近玩家活动和最近日志，也可以保存常用开服配置。

执行 `smoke`、`start`、`restart`、`update` 后，脚本也会重新打印当前 `.env` 对应的访问入口和局域网 IPv4 候选地址。普通启动日志不会打印 `VNC_PASSWORD`、`API_KEY` 或 `ADMIN_TOKEN`。

保存配置后通常需要重启服务端。面板里的重启按钮等价于停止并重新启动 Docker Compose，在线玩家会断开。地图、农场名、初始小屋和利润比例主要影响新建农场；已有存档不一定会被这些字段 retroactive 修改。

公网部署时需要在 1Panel 防火墙和云安全组中限制 `ADMIN_PORT` 的来源 IP。
建议只允许自己的公网 IP 访问，不要对全网无限制开放。

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

## 端口说明

- `5800/tcp`：Web VNC 管理入口。
- `8080/tcp`：HTTP API。
- `8088/tcp`：Web 管理面板，公网部署时建议只允许可信 IP 访问。
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

公网部署时，需要同时配置系统防火墙和云厂商安全组。

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
