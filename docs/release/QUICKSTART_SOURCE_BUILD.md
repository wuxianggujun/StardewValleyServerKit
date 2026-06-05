# Stardew Valley Server Kit - 源码构建说明

这个发布包给维护者或高级用户使用，用来在目标服务器上本地构建 Docker 镜像。

普通服主不要使用这个包。普通部署请使用 `pull` 发布包，并按照 `docs/BEGINNER_GUIDE.md` 操作。

完整高级流程请看 `docs/DEVELOPER_GUIDE.md`。

## Linux 服务器

```bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# 把 source-build 发布包解压到这个目录
chmod +x ./setup-build.sh
./setup-build.sh doctor
./setup-build.sh
```

如果服务器缺少 Docker，请先安装 Docker Engine 和 Compose v2。Ubuntu / Debian 可执行：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 必须包含的构建输入

```text
server/Dockerfile
steam-service/Dockerfile
discord-bot/Dockerfile
```

如果这些目录不存在，说明当前包不是完整源码构建包，不能执行本地构建。

## 常用命令

```bash
./setup-build.sh status
./setup-build.sh logs
./setup-build.sh restart
./setup-build.sh update
./setup-build.sh join-info
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
```
