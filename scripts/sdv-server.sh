#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-setup}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"
BACKUP_DIR="$ROOT_DIR/backups"
SYSTEMD_SERVICE_NAME="sdv-admin.service"
STABLE_VNC_PARAMS='-AcceptPointerEvents=1 -AcceptKeyEvents=1 -AcceptSetDesktopSize=1 -AlwaysShared=1 -DisconnectClients=0'

step() {
  printf '\n==> %s\n' "$1"
}

ok() {
  printf 'OK  %s\n' "$1"
}

warn() {
  printf 'WARN %s\n' "$1"
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Command not found: docker. Please install Docker first."
  docker version >/dev/null 2>&1 || die "Docker is not running. Please start Docker and retry."
}

compose() {
  (cd "$ROOT_DIR" && docker compose --env-file "$ENV_FILE" "$@")
}

show_steamcmd_fallback_hint() {
  warn "steam-auth uses the SteamClient/SteamKit login path; SteamCMD uses Valve's official console client path."
  warn "If SteamCMD asks for a Steam Guard code, type the newest code into this terminal and press Enter."
  warn "Do not paste Steam passwords, Steam Guard codes, or tokens into chat, issues, or screenshots."
}

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

require_linux_systemd() {
  [[ "$(uname -s)" == "Linux" ]] || die "systemd admin service is only supported on Linux."
  command -v systemctl >/dev/null 2>&1 || die "Command not found: systemctl. Use './scripts/sdv-server.sh admin' for a foreground admin panel."
  [[ -d /run/systemd/system ]] || die "systemd is not running. Use './scripts/sdv-server.sh admin' for a foreground admin panel."
}

require_linux_systemd_root() {
  require_linux_systemd
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run this command as root, for example: sudo ./scripts/sdv-server.sh admin-service-install"
}

get_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^[[:space:]]*$key[[:space:]]*=" "$ENV_FILE" \
    | tail -n 1 \
    | sed -E 's/^[^=]+=//' \
    | sed -E 's/^["'\'']|["'\'']$//g'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"

  if grep -Eq "^[[:space:]]*#?[[:space:]]*$key[[:space:]]*=" "$ENV_FILE"; then
    sed -i.bak -E "s|^[[:space:]]*#?[[:space:]]*$key[[:space:]]*=.*|$key=\"$escaped\"|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s="%s"\n' "$key" "$escaped" >> "$ENV_FILE"
  fi
}

initialize_server_settings() {
  local settings_path="$ROOT_DIR/data/settings/server-settings.json"
  [[ -f "$settings_path" ]] && return 0

  cat >"$settings_path" <<'JSON'
{
  "Game": {
    "FarmName": "Junimo",
    "FarmType": 0,
    "ProfitMargin": 1.0,
    "StartingCabins": 1,
    "SpawnMonstersAtNight": "auto"
  },
  "Server": {
    "MaxPlayers": 10,
    "CabinStrategy": "CabinStack",
    "SeparateWallets": false,
    "ExistingCabinBehavior": "KeepExisting",
    "VerboseLogging": false,
    "AllowIpConnections": true,
    "LobbyMode": "Shared",
    "ActiveLobbyLayout": "default",
    "AdminSteamIds": []
  }
}
JSON
  ok "Created data/settings/server-settings.json with IP connections enabled"
}

ensure_env_file() {
  ensure_admin_env_file

  if [[ -z "$(get_env_value STEAM_USERNAME)" ]]; then
    read -r -p "Steam username (must own Stardew Valley; leave blank to edit .env later): " steam_username
    [[ -z "$steam_username" ]] || set_env_value STEAM_USERNAME "$steam_username"
  fi

  if [[ -z "$(get_env_value STEAM_PASSWORD)" ]]; then
    printf 'Steam password will be written to local .env. Leave blank if you prefer manual steam-auth setup.\n'
    read -r -s -p "Steam password (hidden input; optional): " steam_password
    printf '\n'
    [[ -z "$steam_password" ]] || set_env_value STEAM_PASSWORD "$steam_password"
  fi
}

ensure_admin_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
    ok "Created .env from .env.example"
  fi

  [[ -n "$(get_env_value VNC_PASSWORD)" ]] || set_env_value VNC_PASSWORD "$(new_secret)"
  [[ -n "$(get_env_value API_KEY)" ]] || set_env_value API_KEY "$(new_secret)"
  [[ -n "$(get_env_value ADMIN_TOKEN)" ]] || set_env_value ADMIN_TOKEN "$(new_secret)"

  mkdir -p "$ROOT_DIR/data/settings" "$ROOT_DIR/data/mods"
  initialize_server_settings
}

env_or_default() {
  local key="$1"
  local default_value="$2"
  local value
  value="$(get_env_value "$key" || true)"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

show_access_info() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default local access URLs."
  fi

  local admin_host admin_port admin_url_host vnc_port api_port game_port query_port
  admin_host="$(env_or_default ADMIN_HOST 127.0.0.1)"
  admin_port="$(env_or_default ADMIN_PORT 8088)"
  admin_url_host="$admin_host"
  vnc_port="$(env_or_default VNC_PORT 5800)"
  api_port="$(env_or_default API_PORT 8080)"
  game_port="$(env_or_default GAME_PORT 24642)"
  query_port="$(env_or_default QUERY_PORT 27015)"

  step "Access URLs"
  if [[ "$admin_host" == "0.0.0.0" ]]; then
    printf 'Admin panel (local): http://127.0.0.1:%s\n' "$admin_port"
    printf 'Admin panel (public): http://<server-public-ip>:%s\n' "$admin_port"
  else
    printf 'Admin panel: http://%s:%s\n' "$admin_url_host" "$admin_port"
  fi
  printf 'noVNC:       http://127.0.0.1:%s\n' "$vnc_port"
  printf 'HTTP API:    http://127.0.0.1:%s\n' "$api_port"
  printf 'Game IP:     127.0.0.1\n'
  printf 'Game UDP:    %s\n' "$game_port"
  printf 'Query UDP:   %s\n' "$query_port"
  printf 'Admin command: ./scripts/sdv-server.sh admin\n'

  step "LAN IPv4 candidates"
  if ! list_lan_ipv4_addresses; then
    warn "No LAN IPv4 address found from local network adapters."
  fi
  warn "Players on another LAN device should use the real Ethernet/Wi-Fi IPv4 address."

  if [[ "$admin_host" == "0.0.0.0" ]]; then
    warn "ADMIN_HOST=0.0.0.0 listens on all interfaces. Restrict TCP access with firewall rules."
  fi
  warn "VNC passwords, API keys, and admin tokens are stored in .env and are not printed here."
}

prompt_admin_panel_after_setup() {
  if ! command -v node >/dev/null 2>&1; then
    warn "Node.js was not found. Install Node.js, then run ./scripts/sdv-server.sh admin to start the web admin panel."
    return 0
  fi

  if [[ ! -t 0 || ! -t 1 ]]; then
    warn "Run ./scripts/sdv-server.sh admin later if you want to open the local web admin panel."
    return 0
  fi

  local answer
  step "Optional web admin panel"
  read -r -p "Start the local web admin panel now? This keeps this terminal open. [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      admin_panel
      ;;
    *)
      ok "Skipped admin panel. Run ./scripts/sdv-server.sh admin later when needed."
      ;;
  esac
}

test_tcp_port() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" >/dev/null 2>&1
  elif command -v timeout >/dev/null 2>&1; then
    timeout 3 bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1
  else
    bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1
  fi
}

test_udp_send() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    printf 'sdv-port-probe' | nc -u -w1 "$host" "$port" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(b"sdv-port-probe", (sys.argv[1], int(sys.argv[2])))
sock.close()
PY
  else
    return 1
  fi
}

list_lan_ipv4_addresses() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global up \
      | awk '{ split($4, a, "/"); if (a[1] != "127.0.0.1") print a[1] "  (" $2 ")" }'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig \
      | awk '
        /^[^[:space:]]/ { iface=$1; sub(":", "", iface) }
        /inet / && $2 != "127.0.0.1" { print $2 "  (" iface ")" }
      '
  fi
}

join_info() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default ports; run setup before starting the real server."
  fi

  local game_port query_port
  game_port="$(env_or_default GAME_PORT 24642)"
  query_port="$(env_or_default QUERY_PORT 27015)"

  step "Player join targets"
  printf 'Same machine: 127.0.0.1\n'
  printf 'Game UDP port: %s\n' "$game_port"
  printf 'Query UDP port: %s\n' "$query_port"
  printf '%s\n' 'In Stardew Valley, use Co-op -> Join LAN Game / Enter IP. Do not paste an invite code into the IP field.'

  step "LAN IPv4 candidates"
  if ! list_lan_ipv4_addresses; then
    warn "No LAN IPv4 address found from local network adapters."
  fi
  warn "For another device on the same LAN, use the real Ethernet/Wi-Fi adapter IP."
  warn "Do not use VM, WSL, Docker, or bridge adapter addresses for normal players."

  step "Docker published ports"
  docker port sdv-server 2>/dev/null || warn "sdv-server container was not found. Start the server before checking published ports."

  step "Local UDP probe"
  if test_udp_send 127.0.0.1 "$game_port"; then
    ok "Sent UDP probe to 127.0.0.1:$game_port"
  else
    warn "Could not send UDP probe to 127.0.0.1:$game_port; install nc or python3 for this probe."
  fi
  warn "UDP is connectionless; this proves the packet can be sent, not that Stardew accepted the game protocol."

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" == "true" ]]; then
    step "Runtime server signals"
    docker exec sdv-server sh -lc "printf 'invite_code='; cat /tmp/invite-code.txt 2>/dev/null || printf 'n/a'; printf '\n'; ss -lunp 2>/dev/null | grep -E '(:24642|:27015)' || true; tail -n 120 /tmp/server-output.log 2>/dev/null | grep -E 'IP connections enabled|Invite code|Connected to game session|Network:|Healthcheck' | tail -n 20 || true" \
      | sed -E 's/\x1B\[[0-9;?]*[ -/]*[@-~]//g' \
      | grep -Ev "Connected to the docker container shell|Exit and run 'make cli'" || true
  else
    warn "sdv-server is not running. Start it before reading invite code and runtime logs."
  fi

  step "What to try next"
  printf '%s\n' '1. If the game client runs on this same machine, enter 127.0.0.1.'
  printf '%s\n' '2. If the game client runs on another LAN device, enter the Ethernet/Wi-Fi IPv4 shown above.'
  printf '%s\n' '3. If LAN IP still fails, run ./scripts/sdv-server.sh logs while joining and check whether a connection attempt appears.'
  printf '%s\n' '4. Invite codes use Steam/Galaxy P2P and can fail independently from IP direct connect.'
}

admin_panel() {
  local public_mode="${1:-0}"
  command -v node >/dev/null 2>&1 || die "Command not found: node. Please install Node.js first."

  local admin_host admin_port
  if [[ "$public_mode" == "1" ]]; then
    set_env_value ADMIN_HOST "0.0.0.0"
    warn "ADMIN_HOST has been set to 0.0.0.0 for server access."
  fi

  admin_host="$(env_or_default ADMIN_HOST 127.0.0.1)"
  admin_port="$(env_or_default ADMIN_PORT 8088)"

  step "Starting admin panel"
  if [[ "$admin_host" == "0.0.0.0" ]]; then
    printf 'Open (local): http://127.0.0.1:%s\n' "$admin_port"
    printf 'Open (public): http://<server-public-ip>:%s\n' "$admin_port"
    warn "Allow TCP $admin_port in both 1Panel firewall and cloud security group."
    warn "Restrict TCP $admin_port to your own public IP whenever possible."
  else
    printf 'Open: http://%s:%s\n' "$admin_host" "$admin_port"
  fi
  warn "Keep this terminal open while using the admin panel."
  warn "ADMIN_TOKEN is printed only in this local terminal and is also stored in .env."
  node "$ROOT_DIR/scripts/admin-panel.js"
}

admin_token_rotate() {
  ensure_admin_env_file

  local token
  token="$(new_secret)"
  set_env_value ADMIN_TOKEN "$token"

  step "Rotated admin token"
  printf 'ADMIN_TOKEN: %s\n' "$token"
  warn "Existing browser sessions must log in again."

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SYSTEMD_SERVICE_NAME" >/dev/null 2>&1; then
    warn "If the admin panel is running as a systemd service, restart it with: systemctl restart $SYSTEMD_SERVICE_NAME"
  fi
}

admin_service_file() {
  cat <<EOF
[Unit]
Description=Stardew Valley Server Kit Admin Panel
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=SDV_ADMIN_ROOT=$ROOT_DIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/env node $ROOT_DIR/scripts/admin-panel.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}

admin_service_install() {
  require_linux_systemd_root
  ensure_admin_env_file
  command -v node >/dev/null 2>&1 || die "Command not found: node. Please install Node.js first."

  set_env_value ADMIN_HOST "127.0.0.1"
  set_env_value ADMIN_PORT "$(env_or_default ADMIN_PORT 8088)"

  step "Installing systemd admin service"
  admin_service_file >"/etc/systemd/system/$SYSTEMD_SERVICE_NAME"
  systemctl daemon-reload
  systemctl enable --now "$SYSTEMD_SERVICE_NAME"

  sleep 2
  admin_service_status
}

admin_service_start() {
  require_linux_systemd_root
  ensure_admin_env_file
  systemctl start "$SYSTEMD_SERVICE_NAME"
  sleep 1
  admin_service_status
}

admin_service_stop() {
  require_linux_systemd_root
  systemctl stop "$SYSTEMD_SERVICE_NAME"
  ok "Stopped $SYSTEMD_SERVICE_NAME"
}

admin_service_restart() {
  require_linux_systemd_root
  ensure_admin_env_file
  systemctl restart "$SYSTEMD_SERVICE_NAME"
  sleep 1
  admin_service_status
}

admin_service_status() {
  require_linux_systemd
  local admin_port
  admin_port="$(env_or_default ADMIN_PORT 8088)"

  step "Admin service status"
  systemctl status "$SYSTEMD_SERVICE_NAME" --no-pager || true

  step "Local admin probe"
  if test_tcp_port 127.0.0.1 "$admin_port"; then
    ok "Admin panel is listening on 127.0.0.1:$admin_port"
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "http://127.0.0.1:$admin_port/" | head -5 || true
    fi
  else
    warn "Admin panel is not reachable on 127.0.0.1:$admin_port"
    warn "Read logs with: journalctl -u $SYSTEMD_SERVICE_NAME -n 100 --no-pager"
  fi

  warn "For 1Panel reverse proxy, proxy to http://127.0.0.1:$admin_port"
}

admin_service_logs() {
  require_linux_systemd
  journalctl -u "$SYSTEMD_SERVICE_NAME" -n 120 --no-pager
}

smoke_test() {
  ensure_env_file
  step "Starting server stack"
  compose up --detach
  step "Waiting for containers"
  sleep 15
  compose ps

  vnc_port="$(env_or_default VNC_PORT 5800)"
  api_port="$(env_or_default API_PORT 8080)"
  step "Checking local TCP ports"
  if test_tcp_port 127.0.0.1 "$vnc_port"; then
    ok "VNC port reachable: $vnc_port"
  else
    printf 'WARN VNC port not reachable yet: %s\n' "$vnc_port"
  fi
  if test_tcp_port 127.0.0.1 "$api_port"; then
    ok "API port reachable: $api_port"
  else
    printf 'WARN API port not reachable yet: %s\n' "$api_port"
  fi

  step "Recent logs"
  compose logs --tail 120 --no-color server steam-auth || true
  show_access_info
}

vnc_input_check() {
  step "Checking VNC input configuration"

  local disable_rendering vnc_params
  disable_rendering="$(env_or_default DISABLE_RENDERING false)"
  vnc_params="$(env_or_default XVNC_SERVER_CUSTOM_PARAMS "$STABLE_VNC_PARAMS")"

  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default VNC settings; run setup or vnc-fix to write local configuration."
  fi

  printf 'DISABLE_RENDERING=%s\n' "$disable_rendering"
  printf 'XVNC_SERVER_CUSTOM_PARAMS=%s\n' "$vnc_params"

  if [[ "$disable_rendering" == "true" ]]; then
    warn "DISABLE_RENDERING=true is not recommended when you need interactive VNC controls."
  fi

  if [[ "$vnc_params" == *"-RawKeyboard=1"* ]]; then
    warn "RawKeyboard is enabled. Some VNC clients can mis-handle keyboard input in this mode."
  fi

  if [[ "$vnc_params" != *"-AcceptSetDesktopSize=1"* ]]; then
    warn "AcceptSetDesktopSize is not explicit. Run vnc-fix so VNC clients that support remote resize can request desktop-size changes."
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    warn "sdv-server is not running. Start it before testing live VNC input."
    return 0
  fi

  step "Runtime Xvnc process"
  docker exec sdv-server sh -lc "ps -ef | grep '[X]vnc' | sed -E 's/-rfbauth=[^ ]+/-rfbauth=<path>/'"

  step "Active X11 window"
  docker exec sdv-server sh -lc "DISPLAY=:0 xprop -root _NET_ACTIVE_WINDOW 2>/dev/null; DISPLAY=:0 wmctrl -l -p -G 2>/dev/null || true"

  step "VNC desktop size"
  docker exec sdv-server sh -lc 'printf "target=%sx%s\n" "$DISPLAY_WIDTH" "$DISPLAY_HEIGHT"; DISPLAY=:0 xrandr 2>/dev/null | sed -n "1,4p" || true'

  step "Manual mouse/keyboard probe"
  printf '%s\n' 'Use a temporary xev window to test the VNC input path:'
  printf '%s\n' 'docker exec -it sdv-server sh -lc "DISPLAY=:0 timeout 30 xev -geometry 260x160+40+40 -event mouse -event keyboard"'
  printf '%s\n' 'Then click inside the small xev window in noVNC and press F9/F10.'
  printf '%s\n' 'Expected output contains ButtonPress/ButtonRelease and KeyPress/KeyRelease.'
  printf '%s\n' 'Do not use the JunimoServer overlay labels as a click test; they are status/hotkey hints.'
}

update_stardew_vnc_resolution() {
  ensure_env_file

  local display_width display_height volume_name
  display_width="$(env_or_default DISPLAY_WIDTH 1920)"
  display_height="$(env_or_default DISPLAY_HEIGHT 1080)"
  volume_name="stardew-valley-server-kit_saves"

  step "Aligning Stardew Valley resolution with VNC desktop"
  warn "This updates the game's saved startup preferences inside the game volume. Saves are preserved."

  if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
    warn "Save/config volume not found: $volume_name. Start the server once, then run vnc-fix again."
    return 0
  fi

  docker run --rm \
    -e "DISPLAY_WIDTH=$display_width" \
    -e "DISPLAY_HEIGHT=$display_height" \
    -v "$volume_name:/config" \
    alpine:3.20 sh -lc '
set -eu
stamp="$(date +%Y%m%d-%H%M%S)"
for file in /config/startup_preferences /config/default_options; do
  if [ ! -f "$file" ]; then
    echo "WARN missing $file"
    continue
  fi
  cp "$file" "$file.bak-$stamp"
  sed -i -E \
    -e "s|<fullscreenResolutionX>[^<]*</fullscreenResolutionX>|<fullscreenResolutionX>${DISPLAY_WIDTH}</fullscreenResolutionX>|g" \
    -e "s|<fullscreenResolutionY>[^<]*</fullscreenResolutionY>|<fullscreenResolutionY>${DISPLAY_HEIGHT}</fullscreenResolutionY>|g" \
    -e "s|<preferredResolutionX>[^<]*</preferredResolutionX>|<preferredResolutionX>${DISPLAY_WIDTH}</preferredResolutionX>|g" \
    -e "s|<preferredResolutionY>[^<]*</preferredResolutionY>|<preferredResolutionY>${DISPLAY_HEIGHT}</preferredResolutionY>|g" \
    -e "s|<uiScale>[^<]*</uiScale>|<uiScale>1</uiScale>|g" \
    "$file"
  echo "OK updated $file"
done
'
}

vnc_runtime_resize() {
  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    warn "sdv-server is not running. Skipping live X11 resize."
    return 0
  fi

  step "Forcing live VNC desktop size"
  warn "If noVNC is open with resize=remote, it can shrink the remote desktop again. Use resize=scale for a fixed .env size."
  docker exec sdv-server sh -lc '
set -eu
width="${DISPLAY_WIDTH:-1920}"
height="${DISPLAY_HEIGHT:-1080}"
mode="${width}x${height}"
if DISPLAY=:0 xrandr | awk "{print \$1}" | grep -Fxq "$mode"; then
  DISPLAY=:0 xrandr --output VNC-0 --mode "$mode" || DISPLAY=:0 xrandr -s "$mode" || true
else
  DISPLAY=:0 xrandr --fb "$mode" || true
fi
win="$(DISPLAY=:0 wmctrl -l | awk '\''/Stardew Valley/ {print $1; exit}'\'')"
if [ -n "$win" ]; then
  DISPLAY=:0 wmctrl -ir "$win" -b remove,maximized_vert,maximized_horz || true
  DISPLAY=:0 wmctrl -ir "$win" -e "0,0,0,$width,$height" || true
  DISPLAY=:0 wmctrl -ir "$win" -b add,maximized_vert,maximized_horz || true
fi
DISPLAY=:0 xrandr | sed -n "1,4p"
DISPLAY=:0 wmctrl -lG | grep -i "Stardew" || true
'
}

vnc_input_fix() {
  ensure_env_file
  step "Applying VNC interactive settings"
  set_env_value DISABLE_RENDERING false
  set_env_value XVNC_SERVER_CUSTOM_PARAMS "$STABLE_VNC_PARAMS"
  ok "Set DISABLE_RENDERING=false"
  ok "Enabled pointer, keyboard, and remote desktop resize events"
  ok "Removed RawKeyboard from XVNC_SERVER_CUSTOM_PARAMS"

  step "Stopping server before updating game resolution"
  warn "Only the server container is stopped. Docker volumes containing game files and saves are preserved."
  compose stop server

  update_stardew_vnc_resolution

  step "Starting server container"
  compose up -d --force-recreate server

  step "Waiting for VNC to come back"
  sleep 12
  vnc_runtime_resize
  vnc_input_check
}

smapi_command() {
  local command="$1"
  local description="$2"

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    die "sdv-server is not running. Start it before sending JunimoServer commands."
  fi

  step "$description"
  warn "This sends a SMAPI console command to the running server. It does not restart the container or edit saves."

  docker exec sdv-server sh -lc "
set -eu
test -p /tmp/smapi-input || { echo 'SMAPI input pipe not found'; exit 1; }
printf '%s\n' '$command' > /tmp/smapi-input
sleep 1
tail -n 40 /tmp/server-output.log | grep -E 'Host automation|Host visibility|host-auto|host-visibility' | tail -n 10 || true
"
}

backup_saves() {
  ensure_env_file
  local volume_name="stardew-valley-server-kit_saves"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local archive_name="saves-$timestamp.tar.gz"
  local metadata_name="saves-$timestamp.meta.txt"

  step "Backing up saves volume"
  printf 'WARN Best practice: run backup after an overnight save, or while the server is stopped.\n'

  docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || die "Save volume not found: $volume_name. Start the server once before backing up."

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" == "true" ]]; then
    printf 'WARN sdv-server is running. Avoid backing up during the overnight save animation.\n'
  fi

  mkdir -p "$BACKUP_DIR"
  docker run --rm \
    -v "$volume_name:/saves:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine:3.20 sh -c "tar -czf /backup/$archive_name -C /saves ."

  {
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'volume=%s\n' "$volume_name"
    printf 'archive=%s\n' "$archive_name"
    printf 'note=%s\n' 'This file intentionally contains no Steam credentials, API keys, or VNC passwords.'
    printf 'restore_hint=%s\n' 'Stop the server, then restore this archive into the saves Docker volume.'
  } > "$BACKUP_DIR/$metadata_name"

  ok "Backup written: backups/$archive_name"
  ok "Metadata written: backups/$metadata_name"
}

prepare_steamcmd_volumes() {
  local image="$1"
  local game_volume="$2"
  local steamcmd_volume="$3"

  step "Preparing SteamCMD volumes"
  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    -v "$steamcmd_volume:/home/steam/Steam" \
    --entrypoint bash \
    "$image" -lc 'mkdir -p /data/game /home/steam/Steam && chown -R steam:steam /data/game /home/steam/Steam'
}

game_data_installed() {
  local game_volume="$1"
  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'test -f /data/game/StardewValley -o -f /data/game/StardewValley.exe' \
    >/dev/null 2>&1
}

copy_steamcmd_cache_to_game_data() {
  local game_volume="$1"
  local steamcmd_volume="$2"

  step "Checking SteamCMD cache fallback"
  docker run --rm --user 0:0 \
    -v "$steamcmd_volume:/home/steam/Steam:ro" \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c '
set -eu
if [ ! -f "/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley" ] && [ ! -f "/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley.exe" ]; then
  echo "SteamCMD cache does not contain Stardew Valley game files."
  exit 1
fi
rm -rf /data/game/.steam_tmp_copy
mkdir -p /data/game/.steam_tmp_copy
cp -a "/home/steam/Steam/steamapps/common/Stardew Valley/." /data/game/.steam_tmp_copy/
find /data/game -mindepth 1 -maxdepth 1 ! -name ".steam_tmp_copy" -exec rm -rf {} +
cp -a /data/game/.steam_tmp_copy/. /data/game/
rm -rf /data/game/.steam_tmp_copy
chown -R 1000:1000 /data/game
'
}

assert_game_data_installed() {
  local game_volume="$1"
  local steamcmd_volume="$2"

  if ! game_data_installed "$game_volume"; then
    copy_steamcmd_cache_to_game_data "$game_volume" "$steamcmd_volume" \
      || die "SteamCMD reported success, but game files were not found in game-data or cache volumes."
  fi

  game_data_installed "$game_volume" \
    || die "Game files are still missing from the game-data volume after fallback copy."

  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'printf "game-data files="; find /data/game -type f | wc -l; du -sh /data/game | awk "{print \$1}"'

  ok "Game files are available in the game-data volume"
}

prepare_steamworks_sdk_dir() {
  local game_volume="$1"

  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c 'mkdir -p /data/game/.steam-sdk && chown -R 0:0 /data/game/.steam-sdk && chmod -R 777 /data/game/.steam-sdk'
}

install_steamworks_sdk() {
  local image="$1"
  local game_volume="$2"
  local steamcmd_volume="$3"

  step "Installing Steamworks SDK redistributable"
  prepare_steamworks_sdk_dir "$game_volume"

  docker run --rm \
    -v "$game_volume:/data/game" \
    -v "$steamcmd_volume:/home/steam/Steam" \
    "$image" \
    bash -lc '/home/steam/steamcmd/steamcmd.sh +force_install_dir /data/game/.steam-sdk +login anonymous +app_update 1007 validate +quit'

  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'test -f /data/game/.steam-sdk/linux64/steamclient.so -o -f /data/game/.steam-sdk/steamclient.so' \
    || die "Steamworks SDK download finished, but steamclient.so was not found."

  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c 'chown -R 1000:1000 /data/game/.steam-sdk'

  ok "Steamworks SDK is available in game-data"
}

steamcmd_download() {
  ensure_env_file

  local steam_user
  local steam_pass
  steam_user="$(get_env_value STEAM_USERNAME || true)"
  steam_pass="$(get_env_value STEAM_PASSWORD || true)"
  [[ -n "$steam_user" && -n "$steam_pass" ]] || die "STEAM_USERNAME or STEAM_PASSWORD is missing in .env."

  local max_attempts="${RETRIES:-5}"
  local attempt=1
  local delay
  local image="cm2network/steamcmd:latest"
  local game_volume="stardew-valley-server-kit_game-data"
  local steamcmd_volume="stardew-valley-server-kit_steamcmd"
  local download_command='/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /data/game +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +app_update 413150 validate +quit'

  step "Downloading game files with SteamCMD"
  printf 'WARN Steam Guard codes must be typed into this terminal. Do not paste codes into chat or issues.\n'
  printf 'WARN If SteamCMD shows "Steam Guard code:", type the newest code here and press Enter.\n'
  prepare_steamcmd_volumes "$image" "$game_volume" "$steamcmd_volume"

  while (( attempt <= max_attempts )); do
    step "SteamCMD attempt $attempt of $max_attempts"
    if docker run --rm -it \
      -v "$game_volume:/data/game" \
      -v "$steamcmd_volume:/home/steam/Steam" \
      -e "STEAM_USERNAME=$steam_user" \
      -e "STEAM_PASSWORD=$steam_pass" \
      "$image" \
      bash -lc "$download_command"; then
      assert_game_data_installed "$game_volume" "$steamcmd_volume"
      install_steamworks_sdk "$image" "$game_volume" "$steamcmd_volume"
      ok "SteamCMD download completed"
      return 0
    fi

    printf 'WARN SteamCMD failed on attempt %s\n' "$attempt"
    if (( attempt < max_attempts )); then
      delay=$(( attempt * 10 ))
      (( delay > 60 )) && delay=60
      printf 'WARN Retrying in %s seconds. Partial files in the game volume will be reused.\n' "$delay"
      sleep "$delay"
    fi
    attempt=$(( attempt + 1 ))
  done

  die "SteamCMD download failed after $max_attempts attempts. See docs/STEAM_DOWNLOAD_FALLBACK.md."
}

run_steam_auth_login() {
  if compose run --rm -it steam-auth login; then
    return 0
  fi

  warn "steam-auth login failed. If the log says \"The SteamClient instance must be connected\", this is usually not a password error."
  show_steamcmd_fallback_hint
  return 1
}

run_steam_auth_download_or_fallback() {
  if compose run --rm steam-auth download; then
    return 0
  fi

  warn "steam-auth download failed. Falling back to SteamCMD."
  show_steamcmd_fallback_hint
  steamcmd_download
}

start_server() {
  if [[ "${ENABLE_DISCORD:-0}" == "1" ]]; then
    compose --profile discord up -d
  else
    compose up -d
  fi
}

case "$ACTION" in
  admin|admin-public|admin-token-rotate|admin-service-install|admin-service-start|admin-service-stop|admin-service-restart|admin-service-status|admin-service-logs)
    ;;
  *)
    step "Checking Docker"
    require_docker
    ;;
esac

case "$ACTION" in
  doctor)
    step "Checking Docker Compose"
    docker compose version
    ok "Docker Compose available"
    step "Validating docker-compose.yml"
    (cd "$ROOT_DIR" && docker compose --env-file "$ENV_EXAMPLE_FILE" config --quiet)
    ok "Compose config OK"
    step "Checking Docker images"
    image_version="preview"
    if [[ -f "$ENV_FILE" ]]; then
      configured_version="$(get_env_value IMAGE_VERSION || true)"
      [[ -z "$configured_version" ]] || image_version="$configured_version"
    fi
    for image in "sdvd/server:$image_version" "sdvd/steam-service:$image_version" "sdvd/discord-bot:$image_version"; do
      if docker image inspect "$image" >/dev/null 2>&1; then
        ok "Image available: $image"
      else
        printf 'WARN Image not found locally: %s\n' "$image"
        printf '     Run: docker pull %s\n' "$image"
      fi
    done
    step "Checking local directories"
    mkdir -p "$ROOT_DIR/data/settings" "$ROOT_DIR/data/mods"
    ok "data/settings and data/mods ready"
    if [[ -f "$ENV_FILE" ]]; then
      ok ".env exists; sensitive values are not printed"
    else
      printf 'WARN .env does not exist yet; run setup or copy .env.example before real Steam auth\n'
    fi
    ;;
  check-env)
    step "Checking Steam credential visibility"
    printf 'environment STEAM_USERNAME: %s\n' "$([[ -n "${STEAM_USERNAME:-${STEAM_USER:-${STEAM_ACCOUNT:-${STEAM_LOGIN:-}}}}" ]] && printf set || printf missing)"
    printf 'environment STEAM_PASSWORD: %s\n' "$([[ -n "${STEAM_PASSWORD:-${STEAM_PASS:-}}" ]] && printf set || printf missing)"
    printf 'environment STEAM_REFRESH_TOKEN: %s\n' "$([[ -n "${STEAM_REFRESH_TOKEN:-}" ]] && printf set || printf missing)"
    if [[ -f "$ENV_FILE" ]]; then
      printf '.env STEAM_USERNAME: %s\n' "$([[ -n "$(get_env_value STEAM_USERNAME)" ]] && printf set || printf missing)"
      printf '.env STEAM_PASSWORD: %s\n' "$([[ -n "$(get_env_value STEAM_PASSWORD)" ]] && printf set || printf missing)"
      printf '.env STEAM_REFRESH_TOKEN: %s\n' "$([[ -n "$(get_env_value STEAM_REFRESH_TOKEN)" ]] && printf set || printf missing)"
    else
      printf 'WARN .env does not exist\n'
    fi
    ;;
  setup)
    step "Preparing .env"
    ensure_env_file
    step "Pulling Docker images"
    compose pull
    step "Running Steam login"
    run_steam_auth_login || true
    step "Downloading or updating game files"
    run_steam_auth_download_or_fallback
    smoke_test
    prompt_admin_panel_after_setup
    ;;
  login)
    ensure_env_file
    step "Running Steam login"
    run_steam_auth_login
    ;;
  download)
    ensure_env_file
    step "Downloading or updating game files"
    run_steam_auth_download_or_fallback
    ;;
  steamcmd-download)
    steamcmd_download
    ;;
  smoke)
    smoke_test
    ;;
  start)
    ensure_env_file
    step "Starting server"
    start_server
    show_access_info
    ;;
  stop)
    step "Stopping server"
    compose down
    ;;
  restart)
    ensure_env_file
    step "Restarting server"
    compose down
    start_server
    show_access_info
    ;;
  logs)
    ensure_env_file
    step "Following logs; press Ctrl+C to exit"
    compose logs -f
    ;;
  status)
    ensure_env_file
    step "Showing container status"
    compose ps
    ;;
  update)
    ensure_env_file
    step "Updating images and restarting"
    compose pull
    compose down
    start_server
    show_access_info
    ;;
  vnc-check)
    vnc_input_check
    ;;
  vnc-fix)
    vnc_input_fix
    ;;
  vnc-resize)
    vnc_runtime_resize
    ;;
  host-auto)
    smapi_command "host-auto" "Toggling JunimoServer host auto mode"
    ;;
  host-visibility)
    smapi_command "host-visibility" "Toggling JunimoServer host visibility"
    ;;
  backup)
    backup_saves
    ;;
  join-info)
    join_info
    ;;
  admin)
    admin_panel
    ;;
  admin-public)
    admin_panel 1
    ;;
  admin-token-rotate)
    admin_token_rotate
    ;;
  admin-service-install)
    admin_service_install
    ;;
  admin-service-start)
    admin_service_start
    ;;
  admin-service-stop)
    admin_service_stop
    ;;
  admin-service-restart)
    admin_service_restart
    ;;
  admin-service-status)
    admin_service_status
    ;;
  admin-service-logs)
    admin_service_logs
    ;;
  *)
    die "Unknown command: $ACTION. Available: doctor/check-env/login/download/steamcmd-download/smoke/setup/start/stop/restart/logs/status/update/backup/join-info/admin/admin-public/admin-token-rotate/admin-service-install/admin-service-start/admin-service-stop/admin-service-restart/admin-service-status/admin-service-logs/vnc-check/vnc-fix/vnc-resize/host-auto/host-visibility"
    ;;
esac
