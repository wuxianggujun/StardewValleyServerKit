"use strict";

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stardew Valley Server Kit Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #172033;
      --muted: #687386;
      --blue: #2563eb;
      --green: #16803c;
      --amber: #a15c00;
      --red: #b42318;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .topbar {
      max-width: 1180px;
      margin: 0 auto;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    .brand p {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 20px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 7px 12px;
      cursor: pointer;
    }
    button.primary {
      background: var(--blue);
      border-color: var(--blue);
      color: #fff;
    }
    button.danger {
      border-color: #f0b5ae;
      color: var(--red);
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .section-title h2 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0;
    }
    .hint, .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .status-list, .kv-list, .players {
      display: grid;
      gap: 8px;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid #eef1f5;
      padding-top: 8px;
    }
    .row:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--muted);
      white-space: nowrap;
    }
    .pill.ok { color: var(--green); background: #eefaf1; border-color: #c7ebd2; }
    .pill.warn { color: var(--amber); background: #fff8e8; border-color: #f4ddaa; }
    .pill.bad { color: var(--red); background: #fff1f0; border-color: #f1b8b2; }
    form {
      display: grid;
      gap: 18px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 12px;
    }
    legend {
      grid-column: span 12;
      font-weight: 700;
      margin-bottom: -2px;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }
    label strong {
      color: var(--text);
      font-size: 13px;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: #fff;
      color: var(--text);
    }
    textarea {
      min-height: 86px;
      resize: vertical;
    }
    .field-3 { grid-column: span 3; }
    .field-4 { grid-column: span 4; }
    .field-6 { grid-column: span 6; }
    .field-12 { grid-column: span 12; }
    .checkline {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      color: var(--text);
      font-size: 13px;
    }
    .checkline input {
      width: auto;
    }
    .backup-policy {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 12px;
      align-items: end;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid #eef1f5;
      border-radius: 6px;
      background: #fbfcfe;
    }
    .manage-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-top: 14px;
    }
    .manage-column h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .manage-list {
      display: grid;
      gap: 0;
      border-top: 1px solid #eef1f5;
    }
    .manage-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #eef1f5;
    }
    .manage-item strong {
      display: block;
      overflow-wrap: anywhere;
    }
    .manage-item .hint {
      display: block;
      margin-top: 3px;
    }
    .backup-select-line {
      display: flex;
      grid-template-columns: none;
      align-items: center;
      gap: 8px;
      color: var(--text);
      font-size: 13px;
    }
    .backup-select-line input {
      width: auto;
      flex: 0 0 auto;
    }
    .manage-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }
    .manage-actions button {
      min-height: 30px;
      padding: 5px 9px;
    }
    pre {
      margin: 0;
      min-height: 360px;
      max-height: 65vh;
      overflow: auto;
      white-space: pre-wrap;
      background: #111827;
      color: #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      resize: vertical;
    }
    .notice {
      border-left: 3px solid var(--amber);
      background: #fff9eb;
      padding: 10px 12px;
      color: #604000;
      border-radius: 6px;
    }
    .auth {
      max-width: 480px;
      margin: 60px auto;
    }
    .hidden { display: none !important; }
    .tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 10px 16px;
      color: var(--muted);
      font-size: 14px;
      cursor: pointer;
      min-height: 40px;
      margin-bottom: -1px;
    }
    .tab-btn:hover {
      color: var(--text);
      background: #f1f3f7;
    }
    .tab-btn.active {
      color: var(--blue);
      border-bottom-color: var(--blue);
      font-weight: 600;
    }
    .tab-pane {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }
    .tab-pane.hidden { display: none !important; }
    .message {
      min-height: 22px;
      color: var(--muted);
      white-space: pre-line;
    }
    .message.bad { color: var(--red); }
    .message.ok { color: var(--green); }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.42);
    }
    .modal-panel {
      width: min(620px, 100%);
      display: grid;
      gap: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
      padding: 18px;
    }
    .modal-panel h2 {
      margin: 0;
      font-size: 17px;
    }
    .modal-message {
      margin: 0;
      white-space: pre-line;
      color: var(--text);
    }
    .modal-actions {
      justify-content: flex-end;
    }
    @media (max-width: 860px) {
      .span-4, .span-6, .span-8 { grid-column: span 12; }
      .field-3, .field-4, .field-6 { grid-column: span 12; }
      .backup-policy { grid-template-columns: 1fr; }
      .manage-grid { grid-template-columns: 1fr; }
      .manage-item { grid-template-columns: 1fr; }
      .manage-actions { justify-content: flex-start; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="brand">
        <h1>Stardew Valley Server Kit Admin</h1>
        <p>管理面板，配置保存后通常需要重启服务端。</p>
      </div>
      <div class="toolbar">
        <button id="refreshBtn" type="button">刷新</button>
        <button id="startBtn" class="primary" type="button">启动服务端</button>
        <button id="stopBtn" class="danger" type="button">停服释放资源</button>
        <button id="cancelAutoStopBtn" type="button" disabled>取消自动停服</button>
        <button id="restartBtn" class="danger" type="button">重启服务端</button>
        <span id="serverActionMessage" class="message"></span>
      </div>
    </div>
  </header>

  <main>
    <section id="authPanel" class="panel auth hidden">
      <div class="section-title">
        <h2>管理令牌</h2>
      </div>
      <p class="muted">请输入 .env 里的 ADMIN_TOKEN。令牌只用于本地管理 API，不会展示敏感配置。</p>
      <form id="authForm">
        <label>
          <strong>ADMIN_TOKEN</strong>
          <input id="tokenInput" type="password" autocomplete="current-password" />
        </label>
        <button class="primary" type="submit">进入面板</button>
        <div id="authMessage" class="message"></div>
      </form>
    </section>

    <section id="appPanel" class="hidden">
      <div class="tabs" role="tablist">
        <button class="tab-btn active" type="button" data-tab="overview" role="tab">概览</button>
        <button class="tab-btn" type="button" data-tab="players" role="tab">玩家</button>
        <button class="tab-btn" type="button" data-tab="saves" role="tab">存档</button>
        <button class="tab-btn" type="button" data-tab="mods" role="tab">模组</button>
        <button class="tab-btn" type="button" data-tab="config" role="tab">配置</button>
        <button class="tab-btn" type="button" data-tab="logs" role="tab">日志</button>
      </div>

      <div class="tab-pane" data-pane="overview">
        <div class="panel span-6">
          <div class="section-title">
            <h2>运行状态</h2>
            <span id="generatedAt" class="hint"></span>
          </div>
          <div id="healthList" class="status-list"></div>
        </div>

        <div class="panel span-6">
          <div class="section-title">
            <h2>加入信息</h2>
          </div>
          <div id="joinInfo" class="kv-list"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2>玩家摘要</h2>
          </div>
          <div id="players" class="players"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2>端口映射</h2>
          </div>
          <div id="ports" class="kv-list"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2>资源占用</h2>
          </div>
          <div id="stats" class="kv-list"></div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="players">
        <div id="playerManagerPanel" class="panel span-12">
          <div class="section-title">
            <h2>玩家管理</h2>
            <div class="toolbar">
              <button id="refreshPlayersBtn" type="button">刷新玩家</button>
            </div>
          </div>
          <div class="notice">
            玩家名称来自服务端 HTTP API；当前镜像没有开放面板直接踢出/封禁的接口，相关按钮会明确标记为不可用。
          </div>
          <div id="playersMessage" class="message"></div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3>在线玩家</h3>
              <div id="onlinePlayersList" class="manage-list"></div>
            </div>
            <div class="manage-column">
              <h3>农场角色</h3>
              <div id="farmhandsList" class="manage-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="saves">
        <div id="saveManagerPanel" class="panel span-12">
          <div class="section-title">
            <h2>存档管理</h2>
            <div class="toolbar">
              <button id="refreshSavesBtn" type="button">刷新存档</button>
              <button id="createBackupBtn" type="button">创建备份</button>
              <button id="createNewGameBtn" class="primary" type="button">创建地图</button>
            </div>
          </div>
          <div class="notice">
            选择存档只设置下次重启要加载的存档。创建地图会打开独立表单，保存新农场配置后调用服务端官方 newgame 命令，自动把新存档设为下次加载并重启。删除存档会先自动备份整个 saves 卷，再只移除选中的存档目录。恢复备份会停止服务端，用备份覆盖整个 saves 卷，并在恢复前自动备份当前状态。
          </div>
          <div class="backup-policy">
            <label class="field-3 checkline"><input id="autoBackupEnabled" type="checkbox" />自动备份</label>
            <label class="field-3"><strong>间隔分钟</strong><input id="autoBackupInterval" type="number" min="15" max="10080" /></label>
            <label class="field-3"><strong>最多保留</strong><input id="backupRetention" type="number" min="1" max="100" /></label>
            <div class="field-3 toolbar">
              <button id="saveBackupPolicyBtn" type="button">保存备份策略</button>
            </div>
            <div id="backupPolicyStatus" class="field-12 hint"></div>
          </div>
          <div id="savesMessage" class="message"></div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3>可加载存档</h3>
              <div id="savesList" class="manage-list"></div>
            </div>
            <div class="manage-column">
              <div class="section-title">
                <h3>备份文件</h3>
                <button id="deleteSelectedBackupsBtn" class="danger" type="button">删除选中</button>
              </div>
              <div id="backupsList" class="manage-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="mods">
        <div id="modManagerPanel" class="panel span-12">
          <div class="section-title">
            <h2>模组管理</h2>
            <div class="toolbar">
              <button id="refreshModsBtn" type="button">刷新模组</button>
              <button id="backupBeforeModsBtn" type="button">安装前备份</button>
            </div>
          </div>
          <div class="notice">
            当前项目加载的是 SMAPI Mod：宿主机 data/mods 会挂载到容器 /data/game/Mods。Stardew Valley 的主流模组来源是 Nexus Mods 与 SMAPI 兼容列表，不是 SteamCMD Workshop 订阅；新增、升级或删除模组后请重启服务端。
          </div>
          <div class="backup-policy">
            <label class="field-6"><strong>按名称、UniqueID 或 Nexus ID 搜索</strong><input id="modSearchInput" placeholder="例如 Content Patcher、Pathoschild.ContentPatcher、Nexus:1915" /></label>
            <div class="field-6 toolbar">
              <button id="searchSmapiModsBtn" type="button">查 SMAPI 兼容列表</button>
              <button id="searchNexusModsBtn" type="button">查 Nexus Mods</button>
            </div>
          </div>
          <div id="modsMessage" class="message"></div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3>已安装 Mod</h3>
              <div id="installedModsList" class="manage-list"></div>
            </div>
            <div class="manage-column">
              <h3>安装说明</h3>
              <div id="modGuidanceList" class="manage-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="config">
        <div class="panel span-12">
          <div class="section-title">
            <h2>开服配置</h2>
            <span class="hint">这里只保存服务端运行配置；地图创建在存档管理里单独完成。</span>
          </div>
          <div id="runtimeFarmNotice" class="notice hidden"></div>
          <form id="configForm">
            <fieldset>
              <legend>联机</legend>
              <label class="field-4"><strong>房间总人数</strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
              <label class="field-4"><strong>游戏 UDP 端口</strong><input name="gamePort" type="number" min="1" max="65535" /></label>
              <label class="field-4"><strong>查询 UDP 端口</strong><input name="queryPort" type="number" min="1" max="65535" /></label>
              <label class="field-4"><strong>大厅模式</strong>
                <select name="lobbyMode">
                  <option value="Shared">Shared</option>
                  <option value="Individual">Individual</option>
                </select>
              </label>
              <label class="field-4 checkline"><input name="allowIpConnections" type="checkbox" />允许 IP 直连</label>
              <label class="field-4 checkline"><input name="separateWallets" type="checkbox" />玩家钱包分开</label>
              <label class="field-4 checkline"><input name="verboseLogging" type="checkbox" />详细日志</label>
            </fieldset>

            <fieldset>
              <legend>用户与访问</legend>
              <label class="field-4"><strong>小屋策略</strong>
                <select name="cabinStrategy">
                  <option value="CabinStack">CabinStack</option>
                  <option value="None">None</option>
                </select>
              </label>
              <label class="field-4"><strong>已有小屋处理</strong>
                <select name="existingCabinBehavior">
                  <option value="KeepExisting">KeepExisting</option>
                </select>
              </label>
              <label class="field-4"><strong>进服密码操作</strong>
                <select name="serverPasswordAction">
                  <option value="keep">保持不变</option>
                  <option value="set">设置新密码</option>
                  <option value="clear">清空密码</option>
                </select>
              </label>
              <label class="field-4"><strong>新进服密码</strong><input name="serverPassword" type="password" autocomplete="new-password" /></label>
              <label class="field-4"><strong>VNC 端口</strong><input name="vncPort" type="number" min="1" max="65535" /></label>
              <label class="field-4"><strong>HTTP API 端口</strong><input name="apiPort" type="number" min="1" max="65535" /></label>
              <label class="field-12"><strong>管理员 Steam64 ID</strong><textarea name="adminSteamIds" placeholder="每行一个 Steam64 ID"></textarea></label>
            </fieldset>

            <div class="notice">
              保存只写运行配置。端口、人数、IP 直连、密码和管理员等设置需要重启服务端后生效；农场名称和地图类型请在“存档管理”里点击“创建地图”单独设置。
            </div>
            <div class="toolbar">
              <button class="primary" type="submit">保存配置</button>
              <span id="saveMessage" class="message"></span>
            </div>
          </form>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="logs">
        <div class="panel span-12">
          <div class="section-title">
            <h2>最近日志</h2>
            <div class="toolbar">
              <button id="loadLogsBtn" type="button">刷新更多日志</button>
              <button id="copyLogsBtn" type="button">复制日志</button>
            </div>
          </div>
          <pre id="logs"></pre>
        </div>
      </div>
    </section>
  </main>

  <div id="createMapDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="createMapTitle">
    <form id="createMapForm" class="modal-panel">
      <h2 id="createMapTitle">创建地图</h2>
      <p class="modal-message">填写新农场信息后，面板会保存这些新地图配置，再调用服务端官方 newgame 命令，自动选择新存档并重启。旧存档不会删除。</p>
      <fieldset>
        <label class="field-6"><strong>农场名称</strong><input name="farmName" maxlength="48" /></label>
        <label class="field-6"><strong>地图类型</strong><select name="farmType"></select></label>
        <label class="field-4"><strong>利润比例</strong>
          <select name="profitMargin">
            <option value="1">100%</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
            <option value="0.25">25%</option>
          </select>
        </label>
        <label class="field-4"><strong>房间总人数</strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
        <label class="field-4"><strong>初始小屋/角色槽</strong><input name="startingCabins" type="number" min="0" max="9" /></label>
        <label class="field-4"><strong>夜间怪物</strong>
          <select name="spawnMonstersAtNight">
            <option value="auto">自动</option>
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </label>
        <label class="field-4 checkline"><input name="separateWallets" type="checkbox" />玩家钱包分开</label>
      </fieldset>
      <div id="createMapMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="cancelCreateMapBtn" type="button">取消</button>
        <button class="primary" type="submit">创建地图并开服</button>
      </div>
    </form>
  </div>

  <script>
    const authPanel = document.querySelector("#authPanel");
    const appPanel = document.querySelector("#appPanel");
    const authForm = document.querySelector("#authForm");
    const tokenInput = document.querySelector("#tokenInput");
    const authMessage = document.querySelector("#authMessage");
    const configForm = document.querySelector("#configForm");
    const saveMessage = document.querySelector("#saveMessage");
    const serverActionMessage = document.querySelector("#serverActionMessage");
    const startBtn = document.querySelector("#startBtn");
    const stopBtn = document.querySelector("#stopBtn");
    const restartBtn = document.querySelector("#restartBtn");
    const cancelAutoStopBtn = document.querySelector("#cancelAutoStopBtn");
    const runtimeFarmNotice = document.querySelector("#runtimeFarmNotice");
    const savesMessage = document.querySelector("#savesMessage");
    const savesList = document.querySelector("#savesList");
    const backupsList = document.querySelector("#backupsList");
    const saveManagerPanel = document.querySelector("#saveManagerPanel");
    const modsMessage = document.querySelector("#modsMessage");
    const refreshModsBtn = document.querySelector("#refreshModsBtn");
    const backupBeforeModsBtn = document.querySelector("#backupBeforeModsBtn");
    const modSearchInput = document.querySelector("#modSearchInput");
    const searchSmapiModsBtn = document.querySelector("#searchSmapiModsBtn");
    const searchNexusModsBtn = document.querySelector("#searchNexusModsBtn");
    const installedModsList = document.querySelector("#installedModsList");
    const modGuidanceList = document.querySelector("#modGuidanceList");
    const autoBackupEnabled = document.querySelector("#autoBackupEnabled");
    const autoBackupInterval = document.querySelector("#autoBackupInterval");
    const backupRetention = document.querySelector("#backupRetention");
    const backupPolicyStatus = document.querySelector("#backupPolicyStatus");
    const saveBackupPolicyBtn = document.querySelector("#saveBackupPolicyBtn");
    const deleteSelectedBackupsBtn = document.querySelector("#deleteSelectedBackupsBtn");
    const createNewGameBtn = document.querySelector("#createNewGameBtn");
    const createMapDialog = document.querySelector("#createMapDialog");
    const createMapForm = document.querySelector("#createMapForm");
    const createMapMessage = document.querySelector("#createMapMessage");
    const cancelCreateMapBtn = document.querySelector("#cancelCreateMapBtn");
    const playersMessage = document.querySelector("#playersMessage");
    const onlinePlayersList = document.querySelector("#onlinePlayersList");
    const farmhandsList = document.querySelector("#farmhandsList");
    const playerManagerPanel = document.querySelector("#playerManagerPanel");
    const logsPanel = document.querySelector("#logs");
    const loadLogsBtn = document.querySelector("#loadLogsBtn");
    const copyLogsBtn = document.querySelector("#copyLogsBtn");
    let hasConfig = false;
    let shutdownPollTimer = null;
    let logsMode = "recent";
    let latestModManagement = null;

    document.querySelector(".tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
      document.querySelector('[data-pane="' + btn.dataset.tab + '"]').classList.remove("hidden");
    });

    function setMessage(target, text, type) {
      target.textContent = text || "";
      target.className = "message" + (type ? " " + type : "");
    }

    function setLogsText(text, mode) {
      const shouldStickToBottom =
        logsPanel.scrollHeight - logsPanel.scrollTop - logsPanel.clientHeight < 48;
      logsPanel.textContent = text || "";
      logsMode = mode || logsMode;
      if (shouldStickToBottom || mode === "full") {
        logsPanel.scrollTop = logsPanel.scrollHeight;
      }
    }

    function openCreateMapDialog() {
      setMessage(createMapMessage, "");
      createMapDialog.classList.remove("hidden");
      setTimeout(() => createMapForm.elements.farmName.focus(), 0);
    }

    function closeCreateMapDialog() {
      createMapDialog.classList.add("hidden");
      setMessage(createMapMessage, "");
    }

    function appPath(path) {
      const raw = String(path || "");
      if (!raw) return location.href;
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
      const basePath = location.pathname.replace(/\/index\.html$/i, "/");
      const base = new URL(basePath.endsWith("/") ? basePath : basePath + "/", location.origin);
      return new URL(raw.startsWith("/") ? raw.slice(1) : raw, base).toString();
    }

    async function request(path, options = {}) {
      const response = await fetch(appPath(path), {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      if (response.status === 401) {
        appPanel.classList.add("hidden");
        authPanel.classList.remove("hidden");
        throw new Error("需要管理令牌");
      }
      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = await response.json();
          message = body.error || message;
        } catch (_) {}
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      return response.json();
    }

    function pill(text, kind) {
      return '<span class="pill ' + (kind || "") + '">' + escapeHtml(text) + "</span>";
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch]));
    }

    function row(label, value) {
      return '<div class="row"><span>' + escapeHtml(label) + '</span><strong>' + value + "</strong></div>";
    }

    function formatDateTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "n/a";
      return date.toLocaleString();
    }

    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let size = bytes;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return (unit === 0 ? size.toFixed(0) : size.toFixed(1)) + " " + units[unit];
    }

    function formatGameDate(runtime) {
      if (!runtime || !runtime.year) return "n/a";
      const seasons = { spring: "春", summer: "夏", fall: "秋", winter: "冬" };
      const season = seasons[String(runtime.season || "").toLowerCase()] || runtime.season || "";
      const rawTime = String(runtime.timeOfDay || 0).padStart(4, "0");
      const time = rawTime.slice(0, -2) + ":" + rawTime.slice(-2);
      return "第 " + runtime.year + " 年 " + season + " " + runtime.day + " 日 " + time;
    }

    function renderRuntimeFarmNotice(status, config) {
      const runtime = status.runtime;
      if (!runtime || !runtime.farmName) {
        runtimeFarmNotice.classList.add("hidden");
        runtimeFarmNotice.textContent = "";
        return;
      }

      const configuredName = config.settings.Game.FarmName || "Junimo";
      const nameText = "当前运行中的存档是「" + runtime.farmName + "」，配置里的新农场名称是「" + configuredName + "」。";
      const suffix = runtime.farmName === configuredName
        ? "地图、利润、初始小屋等字段仍以存档内容为准。"
        : "重启会继续加载当前存档，不会把它改名或换地图。";

      runtimeFarmNotice.textContent = nameText + suffix;
      runtimeFarmNotice.classList.remove("hidden");
    }

    function renderBackupPolicy(data) {
      const policy = data.backupPolicy || {};
      const state = data.autoBackup || {};
      autoBackupEnabled.checked = Boolean(policy.enabled);
      autoBackupInterval.value = policy.intervalMinutes || 360;
      backupRetention.value = policy.retention || 10;

      const parts = [];
      parts.push(policy.enabled ? "自动备份已开启" : "自动备份已关闭");
      parts.push("最多保留 " + (policy.retention || 10) + " 份");
      if (policy.enabled && state.nextRunAt) parts.push("下次：" + formatDateTime(state.nextRunAt));
      if (state.running) parts.push("正在备份");
      if (state.lastResult?.ok) {
        parts.push("上次：" + formatDateTime(state.lastRunAt) + "，" + state.lastResult.archive);
        if (state.lastResult.pruned?.length) parts.push("已清理旧备份 " + state.lastResult.pruned.length + " 份");
      } else if (state.lastResult?.error) {
        parts.push("上次失败：" + state.lastResult.error);
      }
      backupPolicyStatus.textContent = parts.join(" · ");
    }

    function renderSaveManagement(data) {
      renderBackupPolicy(data);
      if (!data.volumeExists) {
        savesList.innerHTML = '<p class="muted">还没有 saves Docker volume。先启动服务端一次。</p>';
      } else if (data.saves.length) {
        savesList.innerHTML = data.saves.map((save) => (
          (() => {
            const cabinText = save.usableCabinCount === save.cabinCount
              ? ' · 小屋：' + escapeHtml(save.cabinCount ?? 0)
              : ' · 小屋：' + escapeHtml(save.cabinCount ?? 0) + ' · 可用角色：' + escapeHtml(save.usableCabinCount ?? 0);
            return (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(save.name) + '</strong>' +
              '<span class="hint">农场：' + escapeHtml(save.farmName || "Unknown") +
              ' · 地图：' + escapeHtml(save.farmType ?? "n/a") +
              cabinText +
              ' · 更新：' + escapeHtml(formatDateTime(save.updatedAt)) + '</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="select-save" data-name="' + escapeHtml(save.name) + '">下次加载</button>' +
              '<button data-action="repair-cabins" data-name="' + escapeHtml(save.name) + '">修复小屋</button>' +
              '<button class="danger" data-action="delete-save" data-name="' + escapeHtml(save.name) + '">删除</button>' +
            '</div>' +
          '</div>'
            );
          })()
        )).join("");
      } else {
        savesList.innerHTML = '<p class="muted">未发现可加载存档。</p>';
      }

      backupsList.innerHTML = data.backups.length ? data.backups.map((backup) => (
        '<div class="manage-item">' +
          '<div><label class="backup-select-line">' +
            '<input class="backup-select" type="checkbox" value="' + escapeHtml(backup.archive) + '" />' +
            '<strong>' + escapeHtml(backup.archive) + '</strong>' +
          '</label>' +
            '<span class="hint">' + escapeHtml(formatBytes(backup.sizeBytes)) +
            ' · 创建：' + escapeHtml(formatDateTime(backup.createdAt)) + '</span></div>' +
          '<div class="manage-actions">' +
            '<button data-action="restore-backup" data-archive="' + escapeHtml(backup.archive) + '">恢复</button>' +
            '<button class="danger" data-action="delete-backup" data-archive="' + escapeHtml(backup.archive) + '">删除</button>' +
          '</div>' +
        '</div>'
      )).join("") : '<p class="muted">还没有备份文件。</p>';
      deleteSelectedBackupsBtn.disabled = !data.backups.length;
    }

    function modSourceLinks(source, query) {
      const encoded = encodeURIComponent(query || "");
      const smapi = source?.searchUrls?.smapiCompatibility || "https://smapi.io/mods";
      const nexusBase = source?.searchUrls?.nexusSearch || "https://www.nexusmods.com/stardewvalley/search/";
      const nexus = encoded ? nexusBase + "?gsearchtype=mods&gsearch=" + encoded : nexusBase;
      return {
        smapi,
        nexus,
        guide: source?.searchUrls?.moddingGuide || "https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started",
      };
    }

    function modMatchesSearch(mod, query) {
      if (!query) return true;
      return [
        mod.name,
        mod.directoryName,
        mod.uniqueId,
        mod.version,
        mod.author,
        ...(mod.updateKeys || []),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    }

    function renderModManagement(data) {
      latestModManagement = data;
      const query = modSearchInput.value.trim().toLowerCase();
      const installed = data.installed || [];
      const filtered = installed.filter((mod) => modMatchesSearch(mod, query));
      const sourceLinks = modSourceLinks(data.sources, "");
      setMessage(
        modsMessage,
        query ? "匹配 " + filtered.length + " / " + installed.length + " 个模组。" : "已安装 " + installed.length + " 个模组。",
        "ok",
      );
      installedModsList.innerHTML = filtered.length ? filtered.map((mod) => (
        '<div class="manage-item">' +
          '<div><strong>' + escapeHtml(mod.name) + '</strong>' +
            '<span class="hint">目录：' + escapeHtml(mod.directoryName) +
            ' · UniqueID：' + escapeHtml(mod.uniqueId || "n/a") +
            ' · 版本：' + escapeHtml(mod.version || "n/a") +
            ' · 作者：' + escapeHtml(mod.author || "n/a") + '</span>' +
            '<span class="hint">' + escapeHtml(mod.description || "无描述") + '</span>' +
            '<span class="hint">API：' + escapeHtml(mod.minimumApiVersion || "n/a") +
            ' · DLL：' + escapeHtml(mod.entryDll || "n/a") +
            ' · 更新：' + escapeHtml(formatDateTime(mod.updatedAt)) + '</span>' +
            (mod.updateKeys?.length ? '<span class="hint">UpdateKeys：' + escapeHtml(mod.updateKeys.join("，")) + '</span>' : '') +
            (mod.hasManifest ? '' : '<span class="hint bad">manifest.json 解析失败：' + escapeHtml(mod.manifestError || "未知错误") + '</span>') +
          '</div>' +
          '<div class="manage-actions">' +
            '<button type="button" disabled title="当前版本先只展示已安装模组，安装和启用/禁用会在下一步接入具体来源后再开放。">仅查看</button>' +
          '</div>' +
        '</div>'
      )).join("") : (query ? '<p class="muted">没有匹配当前搜索条件的模组。</p>' : '<p class="muted">还没有安装任何模组。</p>');

      modGuidanceList.innerHTML = [
        '<div class="manage-item"><div><strong>安装前备份</strong><span class="hint">修改 Mod 前先导出一份 saves 备份，避免兼容性问题导致存档损坏。</span></div></div>',
        '<div class="manage-item"><div><strong>重启生效</strong><span class="hint">把 Mod 放进 data/mods 后需要重启服务端，SMAPI 才会重新加载。</span></div></div>',
        '<div class="manage-item"><div><strong>来源说明</strong><span class="hint">SMAPI 兼容模组通常来自 Nexus Mods 或官方/社区发布页，不是 Steam Workshop。</span></div></div>',
        '<div class="manage-item"><div><strong>搜索入口</strong><span class="hint"><a href="' + escapeHtml(sourceLinks.smapi) + '" target="_blank" rel="noreferrer">SMAPI 兼容列表</a> · <a href="' + escapeHtml(sourceLinks.nexus) + '" target="_blank" rel="noreferrer">Nexus 搜索</a> · <a href="' + escapeHtml(sourceLinks.guide) + '" target="_blank" rel="noreferrer">入门文档</a></span></div></div>',
      ].join("");
    }

    function renderPlayerManagement(data) {
      const unsupported = data.unsupportedMessage || "当前服务端镜像未开放该操作。";
      const apiHint = data.apiAvailable
        ? (data.auth?.enabled
          ? "进服密码保护：已启用，已验证 " + data.auth.authenticatedCount + " 人，待验证 " + data.auth.pendingCount + " 人。"
          : "服务端 HTTP API 已连接。")
        : "未连接到服务端 HTTP API。请确认 API_ENABLED=true、容器已启动且 API_KEY 一致。";
      setMessage(playersMessage, apiHint, data.apiAvailable ? "ok" : "bad");

      if (data.onlinePlayers?.length) {
        onlinePlayersList.innerHTML = data.onlinePlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">ID：' + escapeHtml(player.id || "n/a") +
              ' · 状态：在线</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="grant-admin" data-name="' + escapeHtml(player.name) + '">授予管理员</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">踢出</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">封禁</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else if (data.recentPlayers?.length) {
        onlinePlayersList.innerHTML = data.recentPlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">' + escapeHtml(player.address || "最近日志记录") +
              ' · ' + escapeHtml(player.lastEvent || "seen") + '</span></div>' +
            '<div class="manage-actions">' +
              '<button disabled title="需要服务端 HTTP API 在线玩家列表。">授予管理员</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">踢出</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">封禁</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else {
        onlinePlayersList.innerHTML = '<p class="muted">当前没有在线玩家。</p>';
      }

      if (data.farmhands?.length) {
        farmhandsList.innerHTML = data.farmhands.map((farmhand) => {
          const name = farmhand.name || "未命名角色";
          const canDelete = farmhand.name && !farmhand.isOnline;
          const deleteTitle = farmhand.isOnline
            ? "在线角色不能删除。"
            : (farmhand.name ? "删除该离线角色和对应小屋。" : "未命名角色不能按名称删除。");
          return (
            '<div class="manage-item">' +
              '<div><strong>' + escapeHtml(name) + '</strong>' +
                '<span class="hint">ID：' + escapeHtml(farmhand.id || "n/a") +
                ' · ' + escapeHtml(farmhand.isCustomized ? "已创建" : "未创建") +
                ' · ' + escapeHtml(farmhand.isOnline ? "在线" : "离线") + '</span></div>' +
              '<div class="manage-actions">' +
                '<button class="danger" ' +
                  (canDelete ? 'data-action="delete-farmhand" data-name="' + escapeHtml(farmhand.name) + '"' : "disabled") +
                  ' title="' + escapeHtml(deleteTitle) + '">删除离线角色</button>' +
              '</div>' +
            '</div>'
          );
        }).join("");
      } else {
        farmhandsList.innerHTML = '<p class="muted">未读取到农场角色。</p>';
      }
    }

    function fillConfig(data) {
      const settings = data.settings;
      const env = data.env;
      const farmTypeOptions = data.farmTypes.map((item) => (
        '<option value="' + item.value + '">' + escapeHtml(item.label) + "</option>"
      )).join("");
      createMapForm.elements.farmType.innerHTML = farmTypeOptions;

      createMapForm.elements.farmName.value = settings.Game.FarmName || "Junimo";
      createMapForm.elements.farmType.value = settings.Game.FarmType ?? 0;
      createMapForm.elements.profitMargin.value = settings.Game.ProfitMargin ?? 1;
      createMapForm.elements.maxPlayers.value = settings.Server.MaxPlayers ?? 4;
      createMapForm.elements.startingCabins.value = settings.Game.StartingCabins ?? 1;
      createMapForm.elements.spawnMonstersAtNight.value = String(settings.Game.SpawnMonstersAtNight ?? "auto");
      createMapForm.elements.separateWallets.checked = Boolean(settings.Server.SeparateWallets);
      configForm.elements.maxPlayers.value = settings.Server.MaxPlayers ?? 4;
      configForm.elements.gamePort.value = env.gamePort;
      configForm.elements.queryPort.value = env.queryPort;
      configForm.elements.vncPort.value = env.vncPort;
      configForm.elements.apiPort.value = env.apiPort;
      configForm.elements.lobbyMode.value = settings.Server.LobbyMode || "Shared";
      configForm.elements.allowIpConnections.checked = Boolean(settings.Server.AllowIpConnections);
      configForm.elements.separateWallets.checked = Boolean(settings.Server.SeparateWallets);
      configForm.elements.verboseLogging.checked = Boolean(settings.Server.VerboseLogging);
      configForm.elements.cabinStrategy.value = settings.Server.CabinStrategy || "CabinStack";
      configForm.elements.existingCabinBehavior.value = settings.Server.ExistingCabinBehavior || "KeepExisting";
      configForm.elements.adminSteamIds.value = (settings.Server.AdminSteamIds || []).join("\n");
      configForm.elements.serverPasswordAction.value = "keep";
      configForm.elements.serverPassword.value = "";
      hasConfig = true;
    }

    function formPayload() {
      const form = configForm.elements;
      return {
        maxPlayers: form.maxPlayers.value,
        gamePort: form.gamePort.value,
        queryPort: form.queryPort.value,
        vncPort: form.vncPort.value,
        apiPort: form.apiPort.value,
        lobbyMode: form.lobbyMode.value,
        allowIpConnections: form.allowIpConnections.checked,
        separateWallets: form.separateWallets.checked,
        verboseLogging: form.verboseLogging.checked,
        cabinStrategy: form.cabinStrategy.value,
        existingCabinBehavior: form.existingCabinBehavior.value,
        serverPasswordAction: form.serverPasswordAction.value,
        serverPassword: form.serverPassword.value,
        adminSteamIds: form.adminSteamIds.value,
      };
    }

    function createMapPayload() {
      const form = createMapForm.elements;
      return {
        farmName: form.farmName.value,
        farmType: form.farmType.value,
        profitMargin: form.profitMargin.value,
        maxPlayers: form.maxPlayers.value,
        startingCabins: form.startingCabins.value,
        spawnMonstersAtNight: form.spawnMonstersAtNight.value,
        separateWallets: form.separateWallets.checked,
      };
    }

    function selectedBackupArchives() {
      return Array.from(backupsList.querySelectorAll(".backup-select:checked"))
        .map((input) => input.value)
        .filter(Boolean);
    }

    function stackStateText(state) {
      if (!state) return "";
      if (!state.ok && state.error) return "容器状态读取失败：" + state.error;
      if (!state.containers?.length) return "未返回容器状态";
      return state.containers.map((container) => {
        const health = container.health && container.health !== "none" ? "/" + container.health : "";
        const startedAt = container.startedAt ? "，启动：" + formatDateTime(container.startedAt) : "";
        return container.name + "=" + (container.status || "unknown") + health + startedAt;
      }).join("；");
    }

    function operationStepsText(steps) {
      return (steps || [])
        .map((step, index) => (index + 1) + ". " + step.label + (step.detail ? "：" + step.detail : ""))
        .join("\n");
    }

    function patchVerificationText(patch) {
      const verification = patch?.verification;
      return verification
        ? "复验：小屋 " + verification.cabinCount + " 座，可用角色 " + verification.usableCabinCount + " 个。"
        : "";
    }

    function createMapResultText(result) {
      const patch = result.cabinPatch || {};
      const lines = [
        "新地图已创建：" + result.farmName,
        result.newSaveName ? "新存档：" + result.newSaveName : "",
        result.selectedSaveName ? "已自动设为下次加载：" + result.selectedSaveName : "",
        result.preNewGameBackup ? "执行前备份：" + result.preNewGameBackup : "",
        result.restarted
          ? (result.restartVerified ? "服务端重启已确认。" : "已执行重启命令，但未确认到 running 状态。")
          : "服务端未重启。",
      ];
      if (result.cabinPatch) {
        lines.push(
          "小屋补丁：补建 " + (patch.addedCabins || 0) +
            " 座，移动 " + (patch.movedCabins || 0) +
            " 座，清理障碍 " + (patch.clearedFarmObstacles || 0) +
            " 处，新增角色槽 " + (patch.addedFarmhands || 0) +
            " 个，修正引用 " + (patch.fixedCabinReferences || 0) + " 个。",
        );
        lines.push(patchVerificationText(patch));
      }
      const state = stackStateText(result.stackState);
      if (state) lines.push("当前容器：" + state);
      const steps = operationStepsText(result.steps);
      if (steps) lines.push("执行记录：\n" + steps);
      return lines.filter(Boolean).join("\n");
    }

    async function copyTextToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (_) {}
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
      if (!copied) throw new Error("Clipboard copy failed.");
      return true;
    }

    function shutdownLabel(readiness) {
      if (!readiness) return "n/a";
      if (readiness.mode === "safe-empty") return "可停服：在线 0 人";
      if (readiness.mode === "safe-saved") return "可停服：近期已存档";
      if (readiness.mode === "warn-unsaved") return "需谨慎：可能未存档";
      if (readiness.mode === "unknown-saved") return "需确认：人数未知但近期已存档";
      return "需确认：在线人数未知";
    }

    function renderServerActions(data) {
      const running = Boolean(data.stackRunning);
      const job = data.shutdownJob;
      const jobActive = Boolean(job?.active);
      startBtn.disabled = running || jobActive;
      stopBtn.disabled = !running || jobActive;
      restartBtn.disabled = jobActive;
      cancelAutoStopBtn.disabled = !jobActive;
      createNewGameBtn.disabled = jobActive;

      if (jobActive) {
        setMessage(serverActionMessage, job.message || "正在等待自动停服...", "warn");
        if (!shutdownPollTimer) {
          shutdownPollTimer = setTimeout(() => {
            shutdownPollTimer = null;
            loadAll().catch((error) => setMessage(serverActionMessage, error.message, "bad"));
          }, 15000);
        }
      } else if (job?.state === "stopped") {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, job.message || "已自动停服。", "ok");
      } else if (job?.state === "failed" || job?.state === "timed-out") {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, job.message || "自动停服未完成。", "bad");
      } else if (!serverActionMessage.textContent) {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, "");
      }
    }

    function renderStatus(data) {
      document.querySelector("#generatedAt").textContent = new Date(data.generatedAt).toLocaleTimeString();
      renderServerActions(data);
      const health = document.querySelector("#healthList");
      health.innerHTML = data.health.length ? data.health.map((item) => {
        const kind = item.health === "healthy" || item.status === "running" ? "ok" : "bad";
        return row(item.name, pill((item.status || "unknown") + " / " + (item.health || "none"), kind));
      }).join("") : row("Docker", pill(data.dockerAvailable ? "服务端已停止" : "不可用", data.dockerAvailable ? "warn" : "bad"));

      const join = document.querySelector("#joinInfo");
      const lan = data.lanAddresses.filter((item) => item.recommended)[0] || data.lanAddresses[0];
      join.innerHTML = [
        row("服务端", pill(data.stackRunning ? "运行中" : "已停止", data.stackRunning ? "ok" : "warn")),
        row("本机 IP", escapeHtml(data.join.sameMachine)),
        row("局域网 IP", escapeHtml(lan ? lan.address : "n/a")),
        row("游戏端口", escapeHtml(data.join.gamePort)),
        row("IP 直连", pill(data.join.allowIpConnections ? "已开启" : "已关闭", data.join.allowIpConnections ? "ok" : "bad")),
        row("邀请码", escapeHtml(data.join.inviteCode || "n/a")),
        row("当前农场", escapeHtml(data.runtime?.farmName || "n/a")),
        row("游戏日期", escapeHtml(formatGameDate(data.runtime))),
        row("停服判断", escapeHtml(shutdownLabel(data.shutdownReadiness))),
      ].join("");

      document.querySelector("#players").innerHTML = data.players.length ? data.players.map((player) => (
        '<div class="row"><span>' + escapeHtml(player.name) + '<br><span class="hint">' + escapeHtml(player.address || "") + '</span></span>' +
        pill(player.lastEvent || "seen", player.lastEvent === "joined" || player.lastEvent === "online" ? "ok" : "warn") + "</div>"
      )).join("") : '<p class="muted">还没有最近玩家活动。</p>';

      renderPlayerManagement(data.playerManagement || {});

      document.querySelector("#ports").innerHTML = data.publishedPorts.length
        ? data.publishedPorts.map((line, index) => row("映射 " + (index + 1), escapeHtml(line))).join("")
        : '<p class="muted">未读取到端口映射。</p>';

      document.querySelector("#stats").innerHTML = data.stats.length
        ? data.stats.map((item) => row(item.name, escapeHtml((item.cpu || "") + " / " + (item.memory || "")))).join("")
        : '<p class="muted">未读取到资源占用。</p>';

      if (logsMode === "recent") {
        setLogsText(data.recentSignals.join("\n"), "recent");
      }
    }

    async function loadAll() {
      const [status, config, saveManagement, modManagement] = await Promise.all([
        request("/api/status"),
        request("/api/config"),
        request("/api/saves"),
        request("/api/mods"),
      ]);
      renderStatus(status);
      if (!hasConfig) fillConfig(config);
      renderRuntimeFarmNotice(status, config);
      renderSaveManagement(saveManagement);
      renderModManagement(modManagement);
      authPanel.classList.add("hidden");
      appPanel.classList.remove("hidden");
    }

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(authMessage, "验证中...");
      try {
        await request("/api/auth", {
          method: "POST",
          body: JSON.stringify({ token: tokenInput.value.trim() }),
        });
        tokenInput.value = "";
        setMessage(authMessage, "");
        await loadAll();
      } catch (error) {
        setMessage(authMessage, error.message, "bad");
      }
    });

    configForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(saveMessage, "保存中...");
      try {
        await request("/api/config", { method: "POST", body: JSON.stringify(formPayload()) });
        hasConfig = false;
        await loadAll();
        setMessage(saveMessage, "已保存，运行配置重启后生效。", "ok");
      } catch (error) {
        setMessage(saveMessage, error.message, "bad");
      }
    });

    async function reloadSaveManagement() {
      const data = await request("/api/saves");
      renderSaveManagement(data);
      return data;
    }

    async function reloadModManagement() {
      const data = await request("/api/mods");
      renderModManagement(data);
      return data;
    }

    async function reloadPlayerManagement() {
      const data = await request("/api/players");
      renderPlayerManagement(data);
      return data;
    }

    refreshModsBtn.addEventListener("click", async () => {
      setMessage(modsMessage, "刷新中...");
      try {
        await reloadModManagement();
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      }
    });

    backupBeforeModsBtn.addEventListener("click", async () => {
      setMessage(modsMessage, "正在创建安装前备份...");
      try {
        const result = await request("/api/saves/backup", { method: "POST", body: "{}" });
        await reloadSaveManagement();
        setMessage(modsMessage, "安装前备份已创建：" + result.archive, "ok");
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      }
    });

    function openModSearch(target) {
      const query = modSearchInput.value.trim();
      if (!query) {
        setMessage(modsMessage, "请输入模组名称、UniqueID 或 Nexus ID。", "bad");
        return;
      }
      const links = modSourceLinks(null, query);
      const url = target === "nexus" ? links.nexus : links.smapi;
      window.open(url, "_blank", "noopener,noreferrer");
      setMessage(modsMessage, target === "nexus" ? "已打开 Nexus Mods 搜索。" : "已打开 SMAPI 兼容列表。", "ok");
    }

    searchSmapiModsBtn.addEventListener("click", () => openModSearch("smapi"));
    searchNexusModsBtn.addEventListener("click", () => openModSearch("nexus"));
    modSearchInput.addEventListener("input", () => {
      if (latestModManagement) renderModManagement(latestModManagement);
    });
    modSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        openModSearch("smapi");
      }
    });

    document.querySelector("#refreshPlayersBtn").addEventListener("click", async () => {
      setMessage(playersMessage, "刷新中...");
      try {
        await reloadPlayerManagement();
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    playerManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "grant-admin") {
          const name = button.dataset.name;
          if (!confirm("授予玩家管理员权限：" + name + "？")) return;
          setMessage(playersMessage, "正在授予管理员...");
          const result = await request("/api/players/grant-admin", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, result.message || "已授予管理员：" + name, "ok");
          return;
        }

        if (action === "delete-farmhand") {
          const name = button.dataset.name;
          if (!confirm("删除离线角色会移除该角色和对应小屋：" + name + "？")) return;
          setMessage(playersMessage, "正在删除离线角色...");
          const result = await request("/api/farmhands", {
            method: "DELETE",
            body: JSON.stringify({ name }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, result.message || "已删除离线角色：" + name, "ok");
        }
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    saveBackupPolicyBtn.addEventListener("click", async () => {
      setMessage(savesMessage, "正在保存备份策略...");
      try {
        const result = await request("/api/backups/policy", {
          method: "POST",
          body: JSON.stringify({
            enabled: autoBackupEnabled.checked,
            intervalMinutes: autoBackupInterval.value,
            retention: backupRetention.value,
          }),
        });
        const data = await reloadSaveManagement();
        const prunedCount = result.pruned?.length || 0;
        setMessage(
          savesMessage,
          prunedCount ? "备份策略已保存，并清理旧备份 " + prunedCount + " 份。" : "备份策略已保存。",
          "ok",
        );
        renderBackupPolicy(data);
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshSavesBtn").addEventListener("click", async () => {
      setMessage(savesMessage, "刷新中...");
      try {
        await reloadSaveManagement();
        setMessage(savesMessage, "已刷新。", "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#createBackupBtn").addEventListener("click", async () => {
      setMessage(savesMessage, "正在创建备份...");
      try {
        const result = await request("/api/saves/backup", { method: "POST", body: "{}" });
        await reloadSaveManagement();
        setMessage(savesMessage, "备份已创建：" + result.archive, "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    deleteSelectedBackupsBtn.addEventListener("click", async () => {
      const archives = selectedBackupArchives();
      if (!archives.length) {
        setMessage(savesMessage, "请选择要删除的备份。", "bad");
        return;
      }
      setMessage(savesMessage, "正在删除选中的备份...");
      try {
        const result = await request("/api/backups/delete", {
          method: "POST",
          body: JSON.stringify({ archives }),
        });
        await reloadSaveManagement();
        setMessage(savesMessage, "已删除备份：" + (result.deleted || []).join("，"), "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    createNewGameBtn.addEventListener("click", openCreateMapDialog);
    cancelCreateMapBtn.addEventListener("click", closeCreateMapDialog);
    createMapDialog.addEventListener("click", (event) => {
      if (event.target === createMapDialog) closeCreateMapDialog();
    });

    createMapForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = createMapPayload();
      const submitBtn = createMapForm.querySelector('button[type="submit"]');

      async function submit(force) {
        return request("/api/saves/newgame", {
          method: "POST",
          body: JSON.stringify({ ...payload, force }),
        });
      }

      submitBtn.disabled = true;
      setMessage(createMapMessage, "正在执行真实创建流程，完成前不会显示成功。\n正在保存配置、备份、发送 newgame、等待新存档、自动选择新存档并重启服务端...");
      try {
        let result;
        try {
          result = await submit(false);
        } catch (error) {
          if (error.status !== 409) throw error;
          if (!confirm(error.message + "\n\n仍然强制新建地图并重启？")) return;
          setMessage(createMapMessage, "正在强制新建地图并重启服务端...");
          result = await submit(true);
        }

        hasConfig = false;
        await loadAll();
        closeCreateMapDialog();
        setMessage(savesMessage, createMapResultText(result), "ok");
      } catch (error) {
        setMessage(createMapMessage, error.message, "bad");
      } finally {
        submitBtn.disabled = false;
      }
    });

    saveManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "select-save") {
          const saveName = button.dataset.name;
          if (!confirm("设置下次重启加载存档：" + saveName + "？")) return;
          setMessage(savesMessage, "正在设置下次加载的存档...");
          await request("/api/saves/select", {
            method: "POST",
            body: JSON.stringify({ saveName }),
          });
          setMessage(savesMessage, "已设置。重启服务端后会加载：" + saveName, "ok");
          return;
        }

        if (action === "repair-cabins") {
          const saveName = button.dataset.name;

          async function submit(force) {
            return request("/api/saves/repair-cabins", {
              method: "POST",
              body: JSON.stringify({ saveName, force }),
            });
          }

          setMessage(savesMessage, "正在备份并修复小屋...");
          let result;
          try {
            result = await submit(false);
          } catch (error) {
            if (error.status !== 409) throw error;
            if (!confirm(error.message + "\n\n仍然强制修复该存档的小屋？")) return;
            setMessage(savesMessage, "正在强制备份并修复小屋...");
            result = await submit(true);
          }

          hasConfig = false;
          await loadAll();
          const patch = result.cabinPatch || {};
          const restartText = result.restarted ? "；服务端已重启" : "";
          setMessage(
            savesMessage,
            "小屋已修复：" + result.saveName +
              "；补建 " + (patch.addedCabins || 0) +
              " 座；移动 " + (patch.movedCabins || 0) +
              " 座；清理障碍 " + (patch.clearedFarmObstacles || 0) +
              " 处；新增角色槽 " + (patch.addedFarmhands || 0) +
              " 个；修正小屋引用 " + (patch.fixedCabinReferences || 0) +
              " 个；修正角色 ID " + (patch.fixedFarmhandIds || 0) +
              " 个；" + patchVerificationText(patch) +
              "；执行前备份：" + result.preRepairBackup + restartText,
            "ok",
          );
          return;
        }

        if (action === "delete-save") {
          const saveName = button.dataset.name;

          async function submit(force) {
            return request("/api/saves/delete", {
              method: "POST",
              body: JSON.stringify({ saveName, force }),
            });
          }

          setMessage(savesMessage, "正在备份并删除存档...");
          let result;
          try {
            result = await submit(false);
          } catch (error) {
            if (error.status !== 409) throw error;
            if (!confirm(error.message + "\n\n仍然强制删除该存档？")) return;
            setMessage(savesMessage, "正在强制备份并删除存档...");
            result = await submit(true);
          }

          hasConfig = false;
          await loadAll();
          const restartText = result.restarted
            ? "；服务端已重启"
            : (result.stoppedBecauseNoSaves ? "；已无剩余存档，服务端保持停止" : "");
          setMessage(
            savesMessage,
            "已删除存档：" + result.deleted + "；删除前备份：" + result.preDeleteBackup + restartText,
            "ok",
          );
          return;
        }

        if (action === "restore-backup") {
          const archive = button.dataset.archive;
          if (!confirm("恢复会覆盖整个 saves 卷，恢复前会自动备份当前状态。继续恢复：" + archive + "？")) return;
          setMessage(savesMessage, "正在恢复备份...");
          const result = await request("/api/backups/restore", {
            method: "POST",
            body: JSON.stringify({ archive }),
          });
          hasConfig = false;
          await loadAll();
          setMessage(savesMessage, "已恢复：" + result.restored + "；恢复前备份：" + result.preRestoreBackup, "ok");
          return;
        }

        if (action === "delete-backup") {
          const archive = button.dataset.archive;
          setMessage(savesMessage, "正在删除备份...");
          const result = await request("/api/backups/delete", {
            method: "POST",
            body: JSON.stringify({ archives: [archive] }),
          });
          await reloadSaveManagement();
          setMessage(savesMessage, "已删除：" + (result.deleted || [archive]).join("，"), "ok");
        }
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshBtn").addEventListener("click", () => {
      loadAll().catch((error) => setMessage(saveMessage, error.message, "bad"));
    });

    startBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在启动服务端...");
      try {
        await request("/api/start", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, "启动命令已完成。", "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    stopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在检查停服条件...");
      try {
        const status = await request("/api/status");
        renderStatus(status);
        const readiness = status.shutdownReadiness || {};
        const prefix = "停服会执行 docker compose down，停止游戏相关容器以释放 CPU/内存；Docker volume、存档、配置和备份都会保留，Web 管理面板会继续运行。\n\n";

        if (readiness.mode === "safe-empty") {
          if (!confirm(prefix + "在线人数为 0，可以直接停服。")) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, "已停服，Docker 资源已释放，数据已保留。", "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "safe-saved") {
          if (!confirm(prefix + "存档已完成，可以安全停止。\n\n" + (readiness.lastSaveLine || readiness.message))) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, "已停服，Docker 资源已释放，数据已保留。", "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "warn-unsaved") {
          if (!confirm(prefix + readiness.message + "\n\n点“确定”后，面板会等待下一次 SaveGame.Save 完成，再自动停服。")) return;
          const result = await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "after-save" }) });
          setMessage(serverActionMessage, result.job?.message || "已开始等待下一次存档后自动停服。", "warn");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (!confirm(prefix + readiness.message + "\n\n仍然立即停服？")) return;
        await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now", force: true }) });
        setMessage(serverActionMessage, "已按确认立即停服，数据已保留。", "ok");
        setTimeout(() => loadAll().catch(() => {}), 2000);
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    cancelAutoStopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在取消自动停服...");
      try {
        const result = await request("/api/stop/cancel", { method: "POST", body: "{}" });
        setMessage(serverActionMessage, result.job?.message || "已取消自动停服。", "ok");
        await loadAll();
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    restartBtn.addEventListener("click", async () => {
      if (!confirm("重启会断开当前在线玩家，确认继续？")) return;
      setMessage(serverActionMessage, "正在重启服务端...");
      try {
        await request("/api/restart", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, "重启命令已完成。", "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    loadLogsBtn.addEventListener("click", async () => {
      loadLogsBtn.disabled = true;
      try {
        const logs = await request("/api/logs");
        setLogsText(logs.logs, "full");
      } finally {
        loadLogsBtn.disabled = false;
      }
    });

    copyLogsBtn.addEventListener("click", async () => {
      const text = logsPanel.textContent || "";
      if (!text) return;
      try {
        await copyTextToClipboard(text);
        copyLogsBtn.textContent = "已复制";
        setTimeout(() => {
          copyLogsBtn.textContent = "复制日志";
        }, 1600);
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(logsPanel);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copyLogsBtn.textContent = "已选中";
        setTimeout(() => {
          copyLogsBtn.textContent = "复制日志";
        }, 1600);
      }
    });

    let backgroundPollTimer = null;
    let backgroundPollInFlight = false;
    function startBackgroundPolling() {
      if (backgroundPollTimer) return;
      backgroundPollTimer = setInterval(async () => {
        if (document.hidden) return;
        if (backgroundPollInFlight) return;
        if (authPanel && !authPanel.classList.contains("hidden")) return;
        backgroundPollInFlight = true;
        try {
          await loadAll();
        } catch (_) {
          // ignore transient polling errors so the loop keeps going
        } finally {
          backgroundPollInFlight = false;
        }
      }, 8000);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadAll().catch(() => {});
      }
    });

    (async function boot() {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");
      if (token) {
        history.replaceState(null, "", location.pathname);
        try {
          await request("/api/auth", { method: "POST", body: JSON.stringify({ token: token.trim() }) });
        } catch (_) {}
      }
      try {
        await loadAll();
        startBackgroundPolling();
      } catch (_) {
        authPanel.classList.remove("hidden");
      }
    })();
  </script>
</body>
</html>`;

module.exports = { PAGE };
