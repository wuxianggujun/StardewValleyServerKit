# 新手使用指南

这份文档面向第一次部署星露谷物语服务器的普通服主。目标是：你不需要理解 Docker Compose、SteamCMD、镜像标签和 systemd，也能按步骤把服务器跑起来。

## 你需要准备什么

部署前先准备：

- 一台 Linux 云服务器，推荐 Ubuntu / Debian。
- 一个拥有 Stardew Valley 的 Steam 账号。
- 服务器的 SSH 登录方式。
- 能打开云厂商安全组 / 防火墙设置的权限。

本项目不会分发 Stardew Valley 游戏文件。服务器必须用你自己的 Steam 账号下载正版游戏文件。

## 最推荐的部署方式

新手优先使用 Linux 服务器和菜单入口：

```bash
./setup.sh
```

菜单会把复杂操作拆成选项。不要一开始就看本地构建、发布镜像、Dockerfile 或维护者脚本。

推荐顺序：

1. 安装 Docker。
2. 获取项目。
3. 运行 `./setup.sh`。
4. 在菜单里填写 Steam 账号密码。
5. 执行一键部署。
6. 按提示完成 Steam Guard。
7. 打开 Web 管理面板。
8. 创建自己的正式农场。
9. 删除默认 / 测试存档。
10. 复制加入信息给玩家。

## 第一步：安装 Docker

新买的服务器通常没有 Docker。Ubuntu / Debian 可以执行：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

确认 Docker 可用：

```bash
docker version
docker compose version
```

如果这里失败，先解决 Docker 安装问题，再继续部署。

## 第二步：获取项目

国内服务器如果访问 GitHub 不稳定，优先使用 Gitee：

```bash
git clone https://gitee.com/wuxianggujun/StardewValleyServerKit.git
cd StardewValleyServerKit
chmod +x ./setup.sh
```

如果你拿到的是发布包：

```bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# 把发布包解压到这个目录
chmod +x ./setup.sh
```

发布包用户不需要 `setup-build`、`release-images` 或 `package-release`。这些是开发者和维护者入口。

## 第三步：打开菜单

执行：

```bash
./setup.sh
```

你会看到类似菜单：

```text
1) One-click setup / deploy / repair
2) Fill or update Steam username/password
3) Run Steam login / Guard verification
4) Download or update game files
5) Start server
6) Restart server
7) Stop server
8) Show status
9) Follow logs
10) Web admin detect / recommendation
11) Web admin wizard / proxy / token
12) Show web admin token
13) Rotate web admin token
14) Show join info
15) Backup saves
16) Update images and restart
0) Exit
```

新手第一次部署只需要关注 1、2、3、8、9、11、12、14。

## 第四步：填写 Steam 账号密码

在菜单里选择：

```text
2) Fill or update Steam username/password
```

脚本会提示你输入 Steam 用户名和密码。输入内容会保存到服务器本地 `.env`。

注意：

- 不要把 Steam 密码发到聊天、Issue、截图或文章里。
- 脚本不会在普通日志里打印密码。
- 如果以后要替换账号，重新选择菜单 2 即可。

## 第五步：执行一键部署

回到菜单后选择：

```text
1) One-click setup / deploy / repair
```

脚本会做这些事情：

1. 检查 `.env`。
2. 生成缺失的 API key、VNC 密码和 Web 管理令牌。
3. 拉取 Docker 镜像。
4. 启动 Steam 授权服务。
5. 登录 Steam。
6. 下载 Stardew Valley 游戏文件。
7. 启动无头服务端。
8. 打印管理面板、noVNC、HTTP API 和游戏端口。

如果 Docker Hub 下载失败，脚本会询问是否临时配置 Docker Hub 镜像加速地址并重启 Docker。只有你输入 `yes` 才会执行。

重启 Docker 会短暂影响同一台服务器上的其他 Docker 容器。如果服务器上还有 1Panel、数据库、反向代理或其他业务容器，先确认可以接受短暂停顿。

## 第六步：处理 Steam Guard

首次在新服务器登录 Steam，通常需要 Steam Guard。

如果脚本提示输入验证码：

1. 打开 Steam 邮箱或 Steam 手机令牌。
2. 把验证码输入到当前 SSH 终端。
3. 不要把验证码发到聊天、Issue 或截图里。

如果 `steam-auth` 链路失败，脚本会回退到 Valve 官方 SteamCMD。SteamCMD 也可能触发 Steam Guard，处理方式一样。

如果你只是想测试服务器网络，不想触发账号登录，可以执行：

```bash
./setup.sh steam-network
```

这个命令只测试 Steam 公共链路，不读取 Steam 账号密码。

## 第七步：确认服务运行

菜单里选择：

```text
8) Show status
```

或执行：

```bash
./setup.sh status
```

重点看：

- `sdv-server` 是否运行。
- `sdv-steam-auth` 是否 healthy。
- 游戏端口是否已经映射。

查看日志：

```bash
./setup.sh logs
```

如果看到 `SaveGame.Save() completed without exceptions`，说明游戏保存链路至少跑通过一次。

## 第八步：打开 Web 管理面板

菜单里选择：

```text
11) Web admin wizard / proxy / token
```

如果是新买的裸服务器，没有 Nginx、1Panel 或反向代理，选择公网直连模式。它等价于：

```bash
sudo ./scripts/sdv-server.sh admin-service-install-public
```

然后在云厂商安全组和服务器防火墙放行：

```text
8088/tcp
```

浏览器访问：

```text
http://<服务器公网IP>:8088
```

如果服务器已经有 Nginx、1Panel 或 HTTPS 反向代理，推荐使用本地监听模式：

```bash
sudo ./scripts/sdv-server.sh admin-service-install
```

然后把反向代理目标设置为：

```text
http://127.0.0.1:8088
```

## 第九步：获取网页登录令牌

Web 管理面板登录使用 `ADMIN_TOKEN`。

菜单里选择：

```text
12) Show web admin token
```

或执行：

```bash
./setup.sh admin-token-show
```

脚本会提示：

```text
Type SHOW to print ADMIN_TOKEN, or press Enter to cancel
```

输入：

```text
SHOW
```

脚本会只打印一次 Web 管理面板令牌。复制它到网页登录页即可。

不要把这个令牌发到聊天、Issue、截图或公开文章里。

如果令牌泄露，菜单里选择：

```text
13) Rotate web admin token
```

然后重启 Web 管理面板服务：

```bash
sudo ./scripts/sdv-server.sh admin-service-restart
```

## 第十步：创建自己的正式农场

部署成功后，默认 / 测试存档只是 saves volume 里的一个普通存档。不要 SSH 进 Docker volume 手动删除。

在 Web 管理面板里：

1. 进入“存档管理”。
2. 点击“创建地图”。
3. 填写农场名。
4. 选择地图类型。
5. 设置小屋数量和玩家人数。
6. 设置利润比例。
7. 确认创建。

农场地图、农场名、初始小屋数量和利润比例只影响新建农场，不会改写已有存档。

## 第十一步：切换存档

如果已经有多个存档：

1. 打开“存档管理”。
2. 找到要加载的存档。
3. 选择“下次加载”或页面提供的切换按钮。
4. 重启游戏服务端。

只重启 `sdv-admin.service` 不会切换游戏存档。它只会重启网页面板后端。

## 第十二步：删除默认 / 测试存档

删除前先确认：

- 玩家已经下线。
- 当前真实农场已经能正常加载。
- 已经有一份最近备份。

然后：

1. 打开“存档管理”。
2. 找到默认 / 测试存档。
3. 点击“删除”。
4. 按页面要求输入完整存档名。
5. 确认删除。

面板会先备份整个 saves volume，然后只删除选中的存档目录。游戏文件、Mod、其他存档不会被删除。

恢复备份会覆盖整个 saves volume，不是只恢复单个存档。执行恢复前必须确认在线玩家已经下线。

## 第十三步：复制加入信息给玩家

菜单里选择：

```text
14) Show join info
```

或执行：

```bash
./setup.sh join-info
```

如果 Steam / Galaxy P2P 不稳定，优先使用 IP 直连方式。公网服务器需要在云安全组和防火墙放行：

```text
24642/udp
27015/udp
```

邀请码和 IP 直连是两个入口。邀请码填邀请码入口，IP 地址填 LAN/IP 入口，不要混用。

## 日常维护常用命令

```bash
./setup.sh
./setup.sh status
./setup.sh logs
./setup.sh restart
./setup.sh backup
./setup.sh join-info
./setup.sh admin-token-show
```

含义：

- `status`：看服务是否运行。
- `logs`：看服务端日志。
- `restart`：重启游戏服务端。
- `backup`：备份 saves volume。
- `join-info`：查看玩家加入信息。
- `admin-token-show`：查看 Web 管理面板令牌。

## 常见误区

### 打开 8080 看到 Unauthorized

正常。`8080` 是服务端 HTTP API，不是网页管理面板。

网页登录页通常是：

```text
http://<服务器公网IP>:8088
```

### 修改农场地图后旧存档没变化

正常。农场地图、农场名、初始小屋数量和利润比例只影响新建农场。

要换地图，请在“存档管理”里创建新地图。

### 重启 Web 面板后游戏配置没生效

`sdv-admin.service` 只是网页面板。游戏配置、Mod、端口、人数、存档切换通常需要重启游戏服务端。

### 想离线上传镜像

正常流程应该让服务器自己下载镜像，这样更接近真实用户部署。只有服务器完全无法访问 Docker Hub、GHCR 或任何可用镜像源时，才考虑离线上传。

### 担心 Docker Hub 无法访问

脚本会先正常拉取。失败后才询问是否临时配置镜像源并重启 Docker。没有输入 `yes` 时不会擅自重启 Docker。

## 安全清单

不要公开：

- `.env`
- Steam 密码
- Steam Guard 验证码
- `ADMIN_TOKEN`
- `API_KEY`
- `VNC_PASSWORD`
- 带账号密码的代理地址

建议：

- 只在自己的终端输入验证码。
- 文章、截图、Issue 里不要出现 `.env` 明文。
- 删除存档前先备份。
- 有反向代理时优先只开放 80/443。
- 裸服务器直连管理面板时，至少保护好 `ADMIN_TOKEN`，并限制云安全组来源 IP。

## 下一步阅读

- [日常维护](OPERATIONS.md)
- [故障排查](TROUBLESHOOTING.md)
- [Steam 下载备用流程](STEAM_DOWNLOAD_FALLBACK.md)
- [测试计划](TEST_PLAN.md)
