# 星露谷物语服务器一键部署：Docker 下载失败也能继续处理

这篇文章记录我把 Stardew Valley 服务器工具整理成一键部署脚本的过程。目标很简单：
普通用户不需要理解 Docker Compose、SteamCMD、镜像标签这些细节，拿到发布包后运行一个
脚本就能部署。

## 一键部署入口

Linux 服务器上进入项目目录后执行：

```bash
chmod +x ./setup.sh
./setup.sh
```

脚本会自动完成这些事情：

- 生成或检查 `.env` 配置文件。
- 拉取服务端、Steam 服务和可选 Discord Bot 镜像。
- 尝试完成 Steam 登录和游戏文件下载。
- 启动或验证服务器基础状态。
- 给出管理面板、noVNC、HTTP API 和游戏端口信息。

Steam 账号、密码、验证码都只应该输入到自己的终端里，不要发到聊天、评论区、Issue
或截图里。

## 没有 Nginx / 1Panel 怎么打开网页面板

新买的裸服务器可以直接安装公网常驻管理面板：

```bash
sudo ./scripts/sdv-server.sh admin-service-install-public
```

然后在云厂商安全组和服务器防火墙放行 `8088/tcp`，浏览器访问：

```text
http://<服务器公网IP>:8088
```

登录使用服务器 `.env` 里的 `ADMIN_TOKEN`。`8080` 是服务端 HTTP API，不是网页登录页；
直接用浏览器打开 `8080` 看到 `Unauthorized` 属于正常现象。

如果服务器没有 Node.js 18+，脚本会询问是否下载项目本地 Node.js 到 `.svsk-tools/`。
这不是全局安装，不会污染系统 Node 环境。

如果已经有 Nginx、1Panel 或 HTTPS 反向代理，则使用更安全的本地监听模式：

```bash
sudo ./scripts/sdv-server.sh admin-service-install
```

再把域名反向代理到 `http://127.0.0.1:8088`。

## Docker Hub 下载失败怎么办

国内云服务器经常会遇到 Docker Hub 下载很慢或超时，尤其是阿里云、腾讯云等公网环境。
这时脚本不会要求用户手动去改一堆 Docker 配置，而是按下面的流程处理：

1. 先正常执行 Docker 镜像拉取。
2. 如果确认 Docker Hub 或镜像仓库不可达，脚本提示输入 Docker Hub 镜像加速地址。
3. 脚本明确提示：临时修改 `/etc/docker/daemon.json` 会重启 Docker。
4. 只有输入 `yes` 后，脚本才会临时配置镜像源并重启 Docker。
5. 下载完成后，脚本恢复原来的 Docker 配置并再次重启 Docker。

如果服务器上还有 1Panel、数据库、反向代理或其他 Docker 服务，请先确认可以接受短暂
中断。没有输入 `yes` 时，脚本不会擅自重启 Docker。

## 为什么不是离线上传镜像

正常流程应该是服务器自己下载镜像，这样最符合真实用户部署。离线上传只适合极端情况：
服务器完全无法访问 Docker Hub、GHCR 或任何可用镜像源。

现在脚本优先让服务器自己下载；只有下载失败时，才提供临时镜像源兜底。

## Steam 账号为什么还需要

Stardew Valley 游戏文件不能随项目一起分发。部署时仍然需要一个拥有 Stardew Valley 的
Steam 账号，用来下载正版游戏文件。

如果 `steam-auth` 链路失败，脚本会回退到 Valve 官方 SteamCMD 客户端。SteamCMD 也可能
要求 Steam Guard 验证码；脚本会在运行脚本的终端提示输入，输入隐藏，且只通过 stdin
传给 SteamCMD。

## 常用命令

```bash
./setup.sh doctor
./setup.sh status
./setup.sh logs
./setup.sh restart
./setup.sh backup
```

如果要重新走 SteamCMD 下载：

```bash
RETRIES=5 ./scripts/sdv-server.sh steamcmd-download
```

## 安全提醒

- 不要提交 `.env`。
- 不要把 Steam 密码、Steam Guard 验证码、API Key 或管理令牌发给任何人。
- 有 Nginx/1Panel 时，管理面板建议通过反向代理走 HTTPS。
- 没有反向代理的裸服务器，可以用 `admin-service-install-public` 直连 `8088`，但必须保护好 `ADMIN_TOKEN`。
- 公网只放行必要端口，游戏端口按需求开放。
- 修改 Mod 或升级镜像前先备份。

## 赞赏二维码

如果这个工具帮你省了时间，可以扫下面的二维码支持一下。

![微信赞赏码](assets/donation/weixin.png)

![支付宝收款码](assets/donation/zhifubao.jpg)
