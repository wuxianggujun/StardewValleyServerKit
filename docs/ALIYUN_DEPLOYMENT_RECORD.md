# 阿里云部署记录

本文记录 StardewValleyServerKit 在阿里云服务器上的部署方式和验证步骤。
敏感信息只保存在服务器 `/opt/stardew-valley-server-kit/.env`，文档和日志不记录
Steam 账号、密码、验证码、API Key 或管理令牌。

## 服务器信息

- 目标服务器：`root@139.196.225.211`
- 部署目录：`/opt/stardew-valley-server-kit`
- 发布包目录：`/opt/stardew-valley-server-kit-releases`
- 部署入口：`./setup.sh`

## 当前部署策略

普通用户只需要运行一键脚本：

```bash
cd /opt/stardew-valley-server-kit
./setup.sh
```

脚本会先按正常流程让服务器自己下载 Docker 镜像。只有 Docker Hub 或镜像仓库访问失败时，
才会进入网络兜底流程：

1. 提示输入 Docker Hub 镜像加速地址。
2. 提示临时修改 `/etc/docker/daemon.json` 并重启 Docker 的风险。
3. 只有用户输入 `yes` 后才会临时配置镜像源并重启 Docker。
4. 镜像下载完成后，脚本恢复原来的 Docker daemon 配置并再次重启 Docker。

如果用户不输入 `yes`，脚本不会重启 Docker，也不会自动修改 Docker daemon 配置。

## Docker 重启影响

重启 Docker 会短暂影响同一台服务器上的其他 Docker 容器，例如 1Panel、数据库、
反向代理或其他业务服务。因此脚本默认不自动重启 Docker，必须由交互式终端确认。

非交互部署如确实需要预授权，可以在 `.env` 中设置：

```env
DOCKER_REGISTRY_MIRRORS="https://<your-mirror>"
DOCKER_TEMP_MIRROR_RESTART_DOCKER=true
```

普通用户部署不需要提前设置，脚本会在 Docker Hub 下载失败后现场询问。

## 非破坏性验证

同步脚本后，可以先执行以下检查。这些命令不会重启 Docker，也不会打印 `.env` 明文：

```bash
cd /opt/stardew-valley-server-kit
chmod +x setup.sh scripts/sdv-server.sh
./setup.sh doctor
./setup.sh steam-network
docker compose --env-file .env config --quiet
```

如果需要检查 Steam 配置是否存在，只使用状态检查：

```bash
./setup.sh check-env
```

输出只显示 `set` 或 `missing`，不会显示账号密码内容。

## Steam 与 SteamCMD

首次部署仍然需要 Steam 账号拥有 Stardew Valley。账号密码放在 `.env` 中，由服务器上的
脚本传给 `steam-auth` 或 SteamCMD 容器使用。

如果 `steam-auth` 报：

```text
The SteamClient instance must be connected
```

这通常不是密码错误，而是 SteamClient 链路没有连接成功。脚本会回退到 SteamCMD。
SteamCMD 的镜像 `cm2network/steamcmd:latest` 也会走同一套 Docker Hub 失败兜底逻辑。

2026-06-05 分层排查时确认：服务器不是完全不能访问 Steam。`store.steampowered.com`
可以访问但有抖动；`steamcommunity.com:443` 连续超时；Steam CM 的 `443` 端口部分可通，
`27017-27020` 大多不通；`steam-auth` 仍报 `The SteamClient instance must be connected`。
同时，`cm2network/steamcmd:latest` 里的 SteamCMD 匿名登录已经成功连到 Steam Public。
这说明当前卡点是 `steam-auth` 使用的 SteamKit / SteamClient 通道，而不是账号名拼写问题，
也不是 Docker Hub 镜像源问题。

如果目标服务器直连 Steam API/CM 不稳定，可以在服务器 `.env` 中补充：

```env
HTTP_PROXY=""
HTTPS_PROXY=""
ALL_PROXY=""
NO_PROXY="localhost,127.0.0.1,steam-auth,server"
```

代理值如果包含账号密码，只保存在服务器 `.env`，不要写入文档。同步代码后可以执行
`./setup.sh steam-network` 做无账号诊断。这个命令只测试 DNS、Steam Web、Steam Directory API、
CM 端口和 SteamCMD 匿名登录，不读取 Steam 账号密码，也不会触发 Steam Guard。

## 现场验证记录

2026-06-05 在阿里云服务器上做过一次完整验证：

- 已通过 SSH 重启 Docker，确认该动作会让当前项目栈短暂重建。
- 已执行 `./setup.sh start`，`sdv-server` 和 `sdv-steam-auth` 能正常拉起。
- 已执行 `./setup.sh login`，当前报错点是 `The SteamClient instance must be connected`。
- 已执行 `./setup.sh steamcmd-download`，SteamCMD 能连接 Steam Public，并停在 Steam Guard
  验证码输入阶段；非交互 SSH 无法输入验证码，所以脚本会停止重试。
- 已补充部署脚本：Steam Directory API 预检、Steam 代理变量透传、SteamCMD 代理透传、
  `steam-network` 无账号公共链路诊断。

这次验证说明：Docker、Compose、脚本入口和 SteamCMD 回退链路都能跑通；当前剩下的是
从带 TTY 的 SSH 终端输入 Steam Guard 验证码，让服务器这台设备完成 SteamCMD 授权。

## 哔站文章二维码

文章可引用仓库里的赞赏二维码：

![微信赞赏码](assets/donation/weixin.png)

![支付宝收款码](assets/donation/zhifubao.jpg)
