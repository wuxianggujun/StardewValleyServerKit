# Stardew Valley Server Kit - 新手部署说明

这个发布包给普通服主使用。它会拉取已经发布好的 Docker 镜像，不需要源码，也不需要本地构建。

## 项目地址

- GitHub: https://github.com/wuxianggujun/StardewValleyServerKit
- Gitee:  https://gitee.com/wuxianggujun/StardewValleyServerKit

国内服务器访问 GitHub 不稳定时，优先使用 Gitee。

## 当前镜像

- __IMAGE_NAMESPACE__/server:__IMAGE_VERSION__
- __IMAGE_NAMESPACE__/steam-service:__IMAGE_VERSION__
- __IMAGE_NAMESPACE__/discord-bot:__IMAGE_VERSION__

## 第一步：进入目录

```bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# 把发布包解压到这个目录
chmod +x ./setup.sh
```

## 第二步：安装 Docker

Ubuntu / Debian 可执行：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker version
docker compose version
```

## 第三步：打开菜单

```bash
./setup.sh
```

第一次部署按菜单顺序执行：

1. `Fill or update Steam username/password`
2. `One-click setup / deploy / repair`
3. `Run Steam login / Guard verification`
4. `Web admin wizard / proxy / token`
5. `Show web admin token`
6. `Show join info`

Steam 密码只保存在服务器本地 `.env`，不会在普通日志里打印。Steam Guard 验证码只输入到当前终端，不要发到聊天、Issue 或截图里。

## Docker Hub 下载失败

`./setup.sh` 会先正常拉取镜像。确认 Docker Hub 或镜像仓库不可达后，脚本会询问是否临时配置 Docker 镜像源并重启 Docker。

只有输入 `yes` 才会执行。下载完成后脚本会恢复原来的 `/etc/docker/daemon.json` 并再次重启 Docker。

重启 Docker 会短暂影响同一台服务器上的其他 Docker 容器。如果服务器上还有 1Panel、数据库、反向代理或其他服务，先确认可以接受短暂停顿。

## Web 管理面板

新买的裸服务器没有 Nginx / 1Panel 时，在菜单 11 里选择公网直连模式。然后在云安全组和服务器防火墙放行：

```text
8088/tcp
```

浏览器访问：

```text
http://<服务器公网IP>:8088
```

网页登录令牌：

```bash
./setup.sh admin-token-show
```

按提示输入 `SHOW` 后复制 `ADMIN_TOKEN` 到网页登录页。

注意：`8080` 是服务端 HTTP API，不是网页登录页。直接打开 `8080` 看到 `Unauthorized` 是正常现象。

## 创建自己的农场

部署完成后，默认 / 测试存档只是 saves volume 里的普通存档。不要 SSH 到 Docker volume 里手动删。

在 Web 管理面板里：

1. 进入“存档管理”。
2. 点击“创建地图”。
3. 填写农场名、地图类型、小屋数量、人数和利润比例。
4. 确认创建正式农场。
5. 如果要删除默认 / 测试存档，先确认玩家离线，再点击该存档的“删除”。
6. 删除时输入完整存档名确认。

删除前面板会自动备份整个 saves volume，然后只删除被选中的存档目录。恢复备份会覆盖整个 saves volume，不是只恢复单个存档。

## 常用命令

```bash
./setup.sh
./setup.sh status
./setup.sh logs
./setup.sh restart
./setup.sh backup
./setup.sh join-info
./setup.sh admin-token-show
```

更新入口分三种：

```bash
./setup.sh update       # 只更新 Docker 镜像并重启
./setup.sh self-update  # 只更新项目脚本 / 网页管理面板
./setup.sh full-update  # 先更新脚本，再更新镜像并重启
```

`self-update` 和 `full-update` 只适用于 Git 部署目录。它们会先备份 `.env`，
并使用当前分支上游做快进更新；如果检测到受 Git 管理的文件有本地修改，会停止而不是强制覆盖。

不要在这个普通用户发布包里执行 `setup-build`。本地构建和镜像发布请看源码仓库里的 docs/DEVELOPER_GUIDE.md。
