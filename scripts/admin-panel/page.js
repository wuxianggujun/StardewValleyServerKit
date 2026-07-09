"use strict";

const { I18N } = require("./i18n");

const I18N_JSON = JSON.stringify(I18N).replace(/[<>&\u2028\u2029]/g, (ch) => ({
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
}[ch]));

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stardew Valley Server Kit Admin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07110e;
      --panel: rgba(17, 35, 28, 0.9);
      --panel-solid: #11231c;
      --panel-raised: #183027;
      --line: rgba(186, 220, 194, 0.14);
      --line-strong: rgba(186, 220, 194, 0.26);
      --text: #f4f0dc;
      --muted: #9eb0a5;
      --blue: #82c8ff;
      --green: #79d68b;
      --amber: #f6c65b;
      --red: #ff8d7e;
      --accent: #e8b657;
      --accent-strong: #ffd67d;
      --shadow: 0 20px 48px rgba(0, 0, 0, 0.24);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 14% -8%, rgba(77, 151, 101, 0.24), transparent 34rem),
        radial-gradient(circle at 88% 12%, rgba(212, 157, 74, 0.14), transparent 30rem),
        linear-gradient(180deg, #091611 0%, var(--bg) 42%, #050b09 100%);
      color: var(--text);
      font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.55;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      opacity: 0.22;
      background-image:
        linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(to bottom, black, transparent 88%);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--line);
      background: rgba(7, 17, 14, 0.82);
      backdrop-filter: blur(18px) saturate(140%);
    }
    .topbar {
      max-width: 1440px;
      margin: 0 auto;
      padding: 16px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brand-mark {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid rgba(255, 214, 125, 0.34);
      border-radius: 14px;
      background: linear-gradient(145deg, rgba(255, 214, 125, 0.2), rgba(88, 151, 104, 0.18));
      box-shadow: inset 0 1px rgba(255,255,255,0.12), 0 10px 24px rgba(0,0,0,0.18);
      font-size: 24px;
    }
    .brand-copy { min-width: 0; }
    .brand h1 {
      margin: 0;
      color: var(--accent-strong);
      font-family: Georgia, "Times New Roman", "Songti SC", serif;
      font-size: 20px;
      line-height: 1.15;
      letter-spacing: 0.015em;
    }
    .brand p {
      margin: 3px 0 0;
      color: #a9b9ae;
      font-size: 12px;
    }
    main {
      position: relative;
      max-width: 1440px;
      margin: 0 auto;
      padding: 26px 28px 48px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .language-select {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
    }
    .language-select select {
      width: auto;
      min-width: 116px;
      min-height: 38px;
      padding: 7px 9px;
    }
    button, input, select, textarea { font: inherit; }
    button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.045);
      color: var(--text);
      padding: 8px 13px;
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease, box-shadow 160ms ease;
    }
    button:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: var(--line-strong);
      background: rgba(255, 255, 255, 0.085);
      box-shadow: 0 8px 18px rgba(0,0,0,0.14);
    }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .icon-link:focus-visible {
      outline: 2px solid rgba(255, 214, 125, 0.76);
      outline-offset: 2px;
    }
    button.primary {
      background: linear-gradient(135deg, #dba648, #f1c86c);
      border-color: #f3cf80;
      color: #1e2117;
      font-weight: 750;
      box-shadow: 0 8px 22px rgba(218, 166, 72, 0.18);
    }
    button.primary:hover:not(:disabled) { background: linear-gradient(135deg, #e8b657, #ffd67d); }
    button.danger {
      border-color: rgba(255, 141, 126, 0.32);
      background: rgba(255, 104, 87, 0.075);
      color: var(--red);
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .icon-link {
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.045);
      color: var(--text);
      text-decoration: none;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease;
    }
    .icon-link:hover {
      transform: translateY(-1px);
      border-color: rgba(255, 214, 125, 0.42);
      background: rgba(255, 214, 125, 0.08);
      color: var(--accent-strong);
    }
    .icon-link svg { width: 18px; height: 18px; display: block; fill: currentColor; }
    .grid, .tab-pane {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 18px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 20px;
      backdrop-filter: blur(14px);
      overflow: hidden;
      transition: border-color 180ms ease, box-shadow 180ms ease;
    }
    .panel:hover { border-color: rgba(186, 220, 194, 0.22); box-shadow: 0 24px 58px rgba(0,0,0,0.28); }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .section-title h2, .section-title h3 { margin: 0; color: #fff8dc; font-size: 16px; letter-spacing: 0.01em; }
    .hint, .muted { color: var(--muted); font-size: 12px; }
    .hint.warn { color: var(--amber); }
    .hint.bad { color: var(--red); }
    .status-list, .kv-list, .players { display: grid; gap: 9px; }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }
    .row:first-child { border-top: 0; padding-top: 0; }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      border-radius: 999px;
      padding: 3px 9px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.045);
      color: var(--muted);
      white-space: nowrap;
    }
    .pill.ok { color: #a4ecae; background: rgba(81, 183, 105, 0.12); border-color: rgba(121, 214, 139, 0.28); }
    .pill.warn { color: #ffd980; background: rgba(246, 198, 91, 0.12); border-color: rgba(246, 198, 91, 0.3); }
    .pill.bad { color: #ffaaa0; background: rgba(255, 104, 87, 0.12); border-color: rgba(255, 141, 126, 0.28); }
    form { display: grid; gap: 18px; }
    fieldset {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 12px;
      background: rgba(5, 14, 10, 0.26);
    }
    legend { grid-column: span 12; padding: 0 7px; color: var(--accent-strong); font-weight: 750; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    label strong { color: var(--text); font-size: 13px; }
    input, select, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 9px 11px;
      background: rgba(4, 12, 9, 0.54);
      color: var(--text);
      transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }
    input:hover, select:hover, textarea:hover { border-color: var(--line-strong); }
    input:focus, select:focus, textarea:focus {
      border-color: rgba(255, 214, 125, 0.45);
      background: rgba(6, 16, 12, 0.78);
      box-shadow: 0 0 0 3px rgba(232, 182, 87, 0.08);
    }
    textarea { min-height: 96px; resize: vertical; }
    #modConfigText { min-height: min(52vh, 520px); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.45; }
    .field-3 { grid-column: span 3; }
    .field-4 { grid-column: span 4; }
    .field-6 { grid-column: span 6; }
    .field-8 { grid-column: span 8; }
    .field-12 { grid-column: span 12; }
    .checkline { display: flex; align-items: center; gap: 8px; min-height: 40px; color: var(--text); font-size: 13px; }
    .checkline input { width: auto; accent-color: var(--accent); }
    .backup-policy {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 12px;
      align-items: end;
      margin-top: 14px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(5, 14, 10, 0.28);
    }
    .manage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 16px; min-height: 0; }
    .management-panel { display: flex; flex-direction: column; max-height: calc(100vh - 184px); overflow: hidden; }
    .management-panel > .section-title, .management-panel > .notice, .management-panel > .backup-policy, .management-panel > .message { flex: 0 0 auto; }
    .management-panel > .manage-grid { flex: 1 1 auto; }
    .manage-column { min-width: 0; min-height: 0; }
    #modSearchPanel { display: flex; flex: 0 1 auto; flex-direction: column; margin-top: 14px; max-height: min(34vh, 360px); overflow: hidden; }
    .management-panel .manage-column { display: flex; flex-direction: column; }
    .manage-column h3 { flex: 0 0 auto; margin: 0 0 9px; color: #e9e7d9; font-size: 13px; }
    .manage-column > .section-title { flex: 0 0 auto; }
    .manage-list { display: grid; gap: 0; align-content: start; border-top: 1px solid var(--line); min-width: 0; }
    .scroll-list { overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 5px; }
    .management-panel .scroll-list { max-height: min(46vh, 520px); }
    .management-panel .manage-column > .scroll-list { flex: 1 1 auto; min-height: 96px; }
    #modSearchResults { max-height: min(28vh, 300px); }
    #nexusFilesList { max-height: min(42vh, 420px); }
    .diagnostic-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .diagnostic-summary .metric {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255,255,255,0.035);
      padding: 12px;
    }
    .diagnostic-summary .metric strong { display: block; font-size: 12px; color: var(--muted); font-weight: 600; }
    .diagnostic-summary .metric span { display: block; margin-top: 4px; font-size: 19px; font-weight: 760; overflow-wrap: anywhere; }
    .diagnostic-summary .metric span.ok { color: var(--green); }
    .diagnostic-summary .metric span.warn { color: var(--amber); }
    .diagnostic-summary .metric span.bad { color: var(--red); }
    .manage-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 12px 4px;
      border-bottom: 1px solid var(--line);
    }
    .manage-item strong { display: block; color: #f5f0dc; overflow-wrap: anywhere; }
    .manage-item .hint { display: block; margin-top: 3px; }
    .backup-select-line { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; }
    .backup-select-line input { width: auto; flex: 0 0 auto; accent-color: var(--accent); }
    .manage-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .manage-actions button { min-height: 32px; padding: 5px 9px; }
    .nexus-file-group { border-top: 1px solid var(--line); padding-top: 10px; }
    .nexus-file-group:first-child { border-top: 0; padding-top: 0; }
    .nexus-file-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
    .nexus-file-heading h4 { margin: 0; font-size: 13px; }
    .nexus-file-group .manage-list { border-top: 0; }
    .manage-item.recommended {
      background: rgba(81, 183, 105, 0.08);
      border: 1px solid rgba(121, 214, 139, 0.2);
      border-radius: 12px;
      margin: 0 0 7px;
      padding: 11px;
    }
    .log-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(4, 12, 9, 0.38);
    }
    .log-pagination-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
    .log-pagination select { width: auto; min-width: 92px; min-height: 34px; padding: 5px 8px; }
    .log-page-jump { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    .log-page-jump input { width: 72px; min-height: 34px; padding: 5px 8px; text-align: center; }
    .log-page-summary { color: var(--muted); font-size: 12px; white-space: nowrap; }
    pre {
      margin: 0;
      min-height: 360px;
      max-height: 65vh;
      overflow: auto;
      white-space: pre-wrap;
      background: #030906;
      color: #d6e7dc;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
      resize: vertical;
    }
    .notice {
      border: 1px solid rgba(246, 198, 91, 0.24);
      border-left: 3px solid var(--amber);
      background: rgba(246, 198, 91, 0.085);
      padding: 11px 13px;
      color: #f5d78e;
      border-radius: 11px;
    }
    .auth {
      max-width: 500px;
      margin: min(12vh, 110px) auto;
      padding: 28px;
      background: linear-gradient(145deg, rgba(24, 48, 39, 0.96), rgba(12, 27, 21, 0.96));
    }
    .auth::before { content: "🌾"; display: block; margin-bottom: 12px; font-size: 34px; }
    .hidden { display: none !important; }
    .tabs {
      position: sticky;
      top: 77px;
      z-index: 8;
      display: flex;
      gap: 5px;
      margin-bottom: 20px;
      padding: 6px;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(9, 23, 17, 0.88);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.18);
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab-btn {
      flex: 0 0 auto;
      border: 1px solid transparent;
      border-radius: 9px;
      padding: 9px 16px;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      cursor: pointer;
      min-height: 38px;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.055); }
    .tab-btn.active {
      border-color: rgba(255, 214, 125, 0.28);
      background: linear-gradient(135deg, rgba(232, 182, 87, 0.2), rgba(92, 156, 107, 0.14));
      color: var(--accent-strong);
      font-weight: 720;
      box-shadow: inset 0 1px rgba(255,255,255,0.08);
    }
    .tab-pane.hidden { display: none !important; }
    .message { min-height: 22px; color: var(--muted); white-space: pre-line; }
    .message.bad { color: var(--red); }
    .message.ok { color: var(--green); }
    .message.warn { color: var(--amber); }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(1, 7, 4, 0.74);
      backdrop-filter: blur(8px);
    }
    .modal-panel {
      width: min(680px, 100%);
      max-height: calc(100vh - 40px);
      display: grid;
      gap: 15px;
      overflow: auto;
      overscroll-behavior: contain;
      background: linear-gradient(160deg, rgba(24, 48, 39, 0.99), rgba(10, 24, 18, 0.99));
      border: 1px solid var(--line-strong);
      border-radius: 18px;
      box-shadow: 0 28px 80px rgba(0,0,0,0.52);
      padding: 22px;
    }
    .modal-panel h2 { margin: 0; color: var(--accent-strong); font-size: 18px; }
    .modal-message { margin: 0; white-space: pre-line; color: var(--text); }
    .modal-actions { justify-content: flex-end; }
    ::selection { background: rgba(232, 182, 87, 0.32); color: #fffbea; }
    * { scrollbar-color: rgba(158, 176, 165, 0.34) transparent; scrollbar-width: thin; }

    @media (max-width: 980px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      .topbar > .toolbar, #adminToolbar { width: 100%; }
      .tabs { top: 132px; }
      .span-4, .span-6, .span-8 { grid-column: span 12; }
      .field-3, .field-4, .field-6, .field-8 { grid-column: span 12; }
      .backup-policy { grid-template-columns: 1fr; }
      .manage-grid { grid-template-columns: 1fr; }
      .diagnostic-summary { grid-template-columns: 1fr 1fr; }
      .management-panel { max-height: none; overflow: visible; }
      .management-panel .scroll-list { max-height: min(48vh, 460px); }
      #modSearchPanel { max-height: min(40vh, 360px); }
      .manage-item { grid-template-columns: 1fr; }
      .manage-actions { justify-content: flex-start; }
      .section-title { align-items: flex-start; flex-direction: column; }
      .section-title > .toolbar { width: 100%; }
    }
    @media (max-width: 620px) {
      main { padding: 16px 12px 36px; }
      header { position: relative; }
      .topbar { padding: 12px; gap: 12px; }
      .brand { width: 100%; }
      .brand-mark { width: 40px; height: 40px; border-radius: 12px; font-size: 21px; }
      .brand h1 { font-size: 17px; }
      .topbar > .toolbar { width: 100%; align-items: stretch; }
      .language-select { width: 100%; justify-content: space-between; }
      .language-select select { flex: 1 1 auto; min-width: 0; }
      #adminToolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
      #adminToolbar button { width: 100%; min-width: 0; padding-inline: 8px; white-space: nowrap; }
      #adminToolbar .icon-link { width: 100%; }
      #serverActionMessage { grid-column: 1 / -1; }
      .tabs { position: sticky; top: 8px; margin: 0 -4px 16px; border-radius: 12px; }
      .tab-btn { padding: 8px 13px; }
      .panel { padding: 16px; border-radius: 15px; }
      fieldset { padding: 13px; }
      .toolbar button { max-width: 100%; }
      .diagnostic-summary { grid-template-columns: 1fr; }
      .log-pagination { align-items: stretch; flex-direction: column; }
      .log-pagination-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .log-pagination-controls button, .log-pagination-controls select { width: 100%; }
      .log-page-jump { grid-column: 1 / -1; }
      .log-page-jump input { width: 100%; }
      .log-page-summary { white-space: normal; }
      .modal { padding: 10px; }
      .modal-panel { max-height: calc(100vh - 20px); padding: 17px; border-radius: 15px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">🌱</div>
        <div class="brand-copy">
          <h1>Stardew Valley Server Kit</h1>
          <p data-i18n="app.subtitle"></p>
        </div>
      </div>
      <div class="toolbar">
        <label class="language-select">
          <span data-i18n="language.label"></span>
          <select id="languageSelect">
            <option value="zh-CN" data-i18n="language.zhCN"></option>
            <option value="en" data-i18n="language.en"></option>
          </select>
        </label>
        <div id="adminToolbar" class="toolbar hidden">
          <button id="startBtn" class="primary" type="button" data-i18n="action.startServer"></button>
          <button id="stopBtn" class="danger" type="button" data-i18n="action.stopServer"></button>
          <button id="cancelAutoStopBtn" type="button" disabled data-i18n="action.cancelAutoStop"></button>
          <button id="restartBtn" class="danger" type="button" data-i18n="action.restartServer"></button>
          <a
            class="icon-link"
            href="https://github.com/wuxianggujun/StardewValleyServerKit"
            target="_blank"
            rel="noopener noreferrer"
            data-i18n-title="app.githubProject"
            data-i18n-aria-label="app.githubProject"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path>
            </svg>
          </a>
          <span id="serverActionMessage" class="message"></span>
        </div>
      </div>
    </div>
  </header>

  <main>
    <section id="authPanel" class="panel auth hidden">
      <div class="section-title">
        <h2 data-i18n="auth.title"></h2>
      </div>
      <p class="muted" data-i18n="auth.description"></p>
      <form id="authForm">
        <label>
          <strong>ADMIN_TOKEN</strong>
          <input id="tokenInput" type="password" autocomplete="current-password" />
        </label>
        <button class="primary" type="submit" data-i18n="auth.enter"></button>
        <div id="authMessage" class="message"></div>
      </form>
    </section>

    <section id="appPanel" class="hidden">
      <div class="tabs" role="tablist">
        <button class="tab-btn active" type="button" data-tab="overview" role="tab" data-i18n="tab.overview"></button>
        <button class="tab-btn" type="button" data-tab="players" role="tab" data-i18n="tab.players"></button>
        <button class="tab-btn" type="button" data-tab="saves" role="tab" data-i18n="tab.saves"></button>
        <button class="tab-btn" type="button" data-tab="mods" role="tab" data-i18n="tab.mods"></button>
        <button class="tab-btn" type="button" data-tab="config" role="tab" data-i18n="tab.config"></button>
        <button class="tab-btn" type="button" data-tab="logs" role="tab" data-i18n="tab.logs"></button>
      </div>

      <div class="tab-pane" data-pane="overview">
        <div class="panel span-6">
          <div class="section-title">
            <h2 data-i18n="overview.status"></h2>
            <span id="generatedAt" class="hint"></span>
          </div>
          <div id="healthList" class="status-list"></div>
        </div>

        <div class="panel span-6">
          <div class="section-title">
            <h2 data-i18n="overview.joinInfo"></h2>
          </div>
          <div id="joinInfo" class="kv-list"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2 data-i18n="overview.playerSummary"></h2>
          </div>
          <div id="players" class="players"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2 data-i18n="overview.portMappings"></h2>
          </div>
          <div id="ports" class="kv-list"></div>
        </div>

        <div class="panel span-4">
          <div class="section-title">
            <h2 data-i18n="overview.resources"></h2>
          </div>
          <div id="stats" class="kv-list"></div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="players">
        <div id="playerManagerPanel" class="panel span-12 management-panel">
          <div class="section-title">
            <h2 data-i18n="players.title"></h2>
            <div class="toolbar">
              <button id="refreshPlayersBtn" type="button" data-i18n="players.refresh"></button>
              <button id="repairServerApiBtn" type="button" data-i18n="players.repairApi"></button>
            </div>
          </div>
          <div class="notice" data-i18n="players.notice"></div>
          <div id="playersMessage" class="message"></div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3 data-i18n="players.online"></h3>
              <div id="onlinePlayersList" class="manage-list scroll-list"></div>
            </div>
            <div class="manage-column">
              <h3 data-i18n="players.farmhands"></h3>
              <div id="farmhandsList" class="manage-list scroll-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="saves">
        <div id="saveManagerPanel" class="panel span-12 management-panel">
          <div class="section-title">
            <h2 data-i18n="saves.title"></h2>
            <div class="toolbar">
              <button id="refreshSavesBtn" type="button" data-i18n="saves.refresh"></button>
              <button id="createBackupBtn" type="button" data-i18n="saves.createBackup"></button>
              <button id="createNewGameBtn" class="primary" type="button" data-i18n="saves.createMap"></button>
            </div>
          </div>
          <div class="notice" data-i18n="saves.notice"></div>
          <div class="backup-policy">
            <label class="field-3 checkline"><input id="autoBackupEnabled" type="checkbox" /><span data-i18n="saves.autoBackup"></span></label>
            <label class="field-3"><strong data-i18n="saves.intervalMinutes"></strong><input id="autoBackupInterval" type="number" min="15" max="10080" /></label>
            <label class="field-3"><strong data-i18n="saves.maxRetain"></strong><input id="backupRetention" type="number" min="1" max="100" /></label>
            <div class="field-3 toolbar">
              <button id="saveBackupPolicyBtn" type="button" data-i18n="saves.savePolicy"></button>
            </div>
            <div id="backupPolicyStatus" class="field-12 hint"></div>
          </div>
          <div id="savesMessage" class="message"></div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3 data-i18n="saves.available"></h3>
              <div id="savesList" class="manage-list scroll-list"></div>
            </div>
            <div class="manage-column">
              <div class="section-title">
                <h3 data-i18n="saves.backupFiles"></h3>
                <button id="deleteSelectedBackupsBtn" class="danger" type="button" data-i18n="saves.deleteSelected"></button>
              </div>
              <div id="backupsList" class="manage-list scroll-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="mods">
        <div id="modManagerPanel" class="panel span-12 management-panel">
          <div class="section-title">
            <h2 data-i18n="mods.title"></h2>
            <div class="toolbar">
              <button id="refreshModsBtn" type="button" data-i18n="mods.refresh"></button>
              <button id="diagnoseModsBtn" type="button" data-i18n="mods.diagnose"></button>
              <button id="backupBeforeModsBtn" type="button" data-i18n="mods.backupBefore"></button>
            </div>
          </div>
          <div class="notice" data-i18n="mods.notice"></div>
          <div class="backup-policy">
            <label class="field-6"><strong data-i18n="mods.searchLabel"></strong><input id="modSearchInput" data-i18n-placeholder="mods.searchPlaceholder" /></label>
            <div class="field-6 toolbar">
              <button id="searchModsBtn" class="primary" type="button" data-i18n="mods.search"></button>
              <button id="installModUrlBtn" type="button" data-i18n="mods.installUrl"></button>
              <button id="installModLocalBtn" type="button" data-i18n="mods.installLocal"></button>
            </div>
          </div>
          <div id="modsMessage" class="message"></div>
          <div id="modLoadSummary" class="diagnostic-summary"></div>
          <div id="modSearchPanel" class="manage-column hidden">
            <div class="section-title">
              <h3 data-i18n="mods.searchResults"></h3>
              <span id="modSearchSummary" class="hint"></span>
            </div>
            <div id="modSearchResults" class="manage-list scroll-list"></div>
          </div>
          <div class="manage-grid">
            <div class="manage-column">
              <h3 data-i18n="mods.installed"></h3>
              <div id="installedModsList" class="manage-list scroll-list"></div>
            </div>
            <div class="manage-column">
              <h3 data-i18n="mods.guide"></h3>
              <div id="modGuidanceList" class="manage-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="config">
        <div class="panel span-12">
          <div class="section-title">
            <h2 data-i18n="config.title"></h2>
            <span class="hint" data-i18n="config.hint"></span>
          </div>
          <div id="runtimeFarmNotice" class="notice hidden"></div>
          <form id="configForm">
            <fieldset>
              <legend data-i18n="config.connection"></legend>
              <label class="field-4"><strong data-i18n="config.maxPlayers"></strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
              <label class="field-4"><strong data-i18n="config.lobbyMode"></strong>
                <select name="lobbyMode">
                  <option value="Shared">Shared</option>
                  <option value="Individual">Individual</option>
                </select>
              </label>
              <label class="field-4 checkline"><input name="allowIpConnections" type="checkbox" /><span data-i18n="config.allowIp"></span></label>
              <label class="field-4 checkline"><input name="separateWallets" type="checkbox" /><span data-i18n="config.separateWallets"></span></label>
              <label class="field-4 checkline"><input name="verboseLogging" type="checkbox" /><span data-i18n="config.verboseLogging"></span></label>
            </fieldset>

            <fieldset>
              <legend data-i18n="config.ports"></legend>
              <label class="field-3"><strong data-i18n="config.gameUdpPort"></strong><input name="gamePort" type="number" min="1" max="65535" /></label>
              <label class="field-3"><strong data-i18n="config.queryUdpPort"></strong><input name="queryPort" type="number" min="1" max="65535" /></label>
              <label class="field-3"><strong data-i18n="config.vncPort"></strong><input name="vncPort" type="number" min="1" max="65535" /></label>
              <label class="field-3"><strong data-i18n="config.httpApiPort"></strong><input name="apiPort" type="number" min="1" max="65535" /></label>
            </fieldset>

            <fieldset>
              <legend data-i18n="config.usersAccess"></legend>
              <label class="field-4"><strong data-i18n="config.cabinStrategy"></strong>
                <select name="cabinStrategy">
                  <option value="CabinStack">CabinStack</option>
                  <option value="None">None</option>
                </select>
              </label>
              <label class="field-4"><strong data-i18n="config.existingCabinBehavior"></strong>
                <select name="existingCabinBehavior">
                  <option value="KeepExisting">KeepExisting</option>
                </select>
              </label>
              <label class="field-4"><strong data-i18n="config.passwordAction"></strong>
                <select name="serverPasswordAction">
                  <option value="keep" data-i18n="config.keep"></option>
                  <option value="set" data-i18n="config.setPassword"></option>
                  <option value="clear" data-i18n="config.clearPassword"></option>
                </select>
              </label>
              <label class="field-4"><strong data-i18n="config.newPassword"></strong><input name="serverPassword" type="password" autocomplete="new-password" /></label>
              <label class="field-12"><strong data-i18n="config.adminSteamIds"></strong><textarea name="adminSteamIds" data-i18n-placeholder="config.adminSteamIdsPlaceholder"></textarea></label>
            </fieldset>

            <fieldset>
              <legend>Nexus Mods</legend>
              <label class="field-4"><strong data-i18n="config.apiKeyAction"></strong>
                <select name="nexusApiKeyAction">
                  <option value="keep" data-i18n="config.keep"></option>
                  <option value="set" data-i18n="config.setKey"></option>
                  <option value="clear" data-i18n="config.clearKey"></option>
                </select>
              </label>
              <label class="field-8"><strong data-i18n="config.newNexusApiKey"></strong><input name="nexusApiKey" type="password" autocomplete="new-password" /></label>
              <div id="nexusApiKeyStatus" class="field-12 hint"></div>
            </fieldset>

            <div class="notice" data-i18n="config.notice"></div>
            <div class="toolbar">
              <button class="primary" type="submit" data-i18n="action.saveConfig"></button>
              <button id="saveConfigRestartBtn" class="danger" type="submit" data-restart-after-save="true" data-i18n="action.saveAndRestart"></button>
              <span id="saveMessage" class="message"></span>
            </div>
          </form>
        </div>
      </div>

      <div class="tab-pane hidden" data-pane="logs">
        <div class="panel span-12">
          <div class="section-title">
            <h2 data-i18n="logs.title"></h2>
            <div class="toolbar">
              <button id="loadLogsBtn" type="button" data-i18n="logs.refreshMore"></button>
              <button id="diagnosticsBtn" type="button" data-i18n="logs.diagnostics"></button>
              <button id="copyLogsBtn" type="button" data-i18n="logs.copy"></button>
            </div>
          </div>
          <div id="logPagination" class="log-pagination">
            <div class="log-pagination-controls">
              <button id="firstLogsPageBtn" type="button" data-i18n="logs.firstPage"></button>
              <button id="previousLogsPageBtn" type="button" data-i18n="logs.previousPage"></button>
              <label class="log-page-jump">
                <span data-i18n="logs.page"></span>
                <input id="logPageInput" type="number" min="1" value="1" inputmode="numeric" data-i18n-aria-label="logs.pageInput" />
                <button id="goToLogsPageBtn" type="button" data-i18n="logs.goToPage"></button>
              </label>
              <button id="nextLogsPageBtn" type="button" data-i18n="logs.nextPage"></button>
              <button id="lastLogsPageBtn" type="button" data-i18n="logs.lastPage"></button>
              <select id="logPageSize" data-i18n-aria-label="logs.pageSize">
                <option value="100">100</option>
                <option value="200" selected>200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
            <span id="logPageSummary" class="log-page-summary"></span>
          </div>
          <pre id="logs"></pre>
        </div>
      </div>
    </section>
  </main>

  <div id="createMapDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="createMapTitle">
    <form id="createMapForm" class="modal-panel">
      <h2 id="createMapTitle" data-i18n="createMap.title"></h2>
      <p class="modal-message" data-i18n="createMap.description"></p>
      <fieldset>
        <label class="field-6"><strong data-i18n="createMap.farmName"></strong><input name="farmName" maxlength="48" /></label>
        <label class="field-6"><strong data-i18n="createMap.farmType"></strong><select name="farmType"></select></label>
        <label class="field-4"><strong data-i18n="createMap.profitMargin"></strong>
          <select name="profitMargin">
            <option value="1">100%</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
            <option value="0.25">25%</option>
          </select>
        </label>
        <label class="field-4"><strong data-i18n="config.maxPlayers"></strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
        <label class="field-4"><strong data-i18n="createMap.startingCabins"></strong><input name="startingCabins" type="number" min="0" max="9" /></label>
        <label class="field-4"><strong data-i18n="createMap.monstersAtNight"></strong>
          <select name="spawnMonstersAtNight">
            <option value="auto" data-i18n="createMap.auto"></option>
            <option value="true" data-i18n="createMap.enable"></option>
            <option value="false" data-i18n="createMap.disable"></option>
          </select>
        </label>
        <label class="field-4 checkline"><input name="separateWallets" type="checkbox" /><span data-i18n="config.separateWallets"></span></label>
      </fieldset>
      <div id="createMapMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="cancelCreateMapBtn" type="button" data-i18n="action.cancel"></button>
        <button class="primary" type="submit" data-i18n="createMap.submit"></button>
      </div>
    </form>
  </div>

  <div id="editConfigDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="editConfigTitle">
    <form id="editConfigForm" class="modal-panel">
      <h2 id="editConfigTitle" data-i18n="saveConfig.title"></h2>
      <p class="modal-message" data-i18n="saveConfig.description"></p>
      <fieldset>
        <label class="field-6"><strong data-i18n="createMap.farmName"></strong><input name="farmName" maxlength="48" /></label>
        <label class="field-6"><strong data-i18n="createMap.farmType"></strong><input name="whichFarm" disabled /></label>
        <label class="field-4"><strong data-i18n="saveConfig.money"></strong><input name="money" type="number" min="0" max="999999999" /></label>
        <label class="field-4"><strong data-i18n="saveConfig.year"></strong><input name="year" type="number" min="1" max="9999" /></label>
        <label class="field-4"><strong data-i18n="saveConfig.season"></strong>
          <select name="currentSeason">
            <option value="spring" data-i18n="saveConfig.spring"></option>
            <option value="summer" data-i18n="saveConfig.summer"></option>
            <option value="fall" data-i18n="saveConfig.fall"></option>
            <option value="winter" data-i18n="saveConfig.winter"></option>
          </select>
        </label>
        <label class="field-4"><strong data-i18n="saveConfig.day"></strong><input name="dayOfMonth" type="number" min="1" max="28" /></label>
        <label class="field-4"><strong data-i18n="saveConfig.currentTime"></strong><input name="timeOfDay" disabled /></label>
        <label class="field-4"><strong data-i18n="saveConfig.totalIncome"></strong><input name="totalMoneyEarned" disabled /></label>
        <label class="field-4"><strong data-i18n="config.maxPlayers"></strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
        <label class="field-4"><strong data-i18n="saveConfig.targetCabins"></strong><input name="targetCabins" type="number" min="1" max="9" /></label>
        <label class="field-4"><strong data-i18n="saveConfig.currentCabinStatus"></strong><input name="cabinStatus" disabled /></label>
      </fieldset>
      <input type="hidden" name="saveName" />
      <div id="editConfigMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="repairCabinsFromConfigBtn" type="button" data-i18n="saveConfig.repairCabins"></button>
        <button id="cancelEditConfigBtn" type="button" data-i18n="action.cancel"></button>
        <button class="primary" type="submit" data-i18n="action.saveConfig"></button>
        <button id="saveEditConfigRestartBtn" class="danger" type="submit" data-restart-after-save="true" data-i18n="action.saveAndRestart"></button>
      </div>
    </form>
  </div>

  <div id="installModDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="installModTitle">
    <form id="installModForm" class="modal-panel">
      <h2 id="installModTitle" data-i18n="installUrl.title"></h2>
      <p id="installModHelp" class="modal-message" data-i18n="installUrl.help"></p>
      <label>
        <strong data-i18n="installUrl.downloadUrl"></strong>
        <input name="url" type="url" placeholder="https://..." autocomplete="off" />
      </label>
      <div id="nexusFilesPanel" class="hidden">
        <div class="section-title">
          <h3 data-i18n="installUrl.nexusFiles"></h3>
          <span id="nexusFilesSummary" class="hint"></span>
        </div>
        <div id="nexusFilesList" class="manage-list scroll-list"></div>
      </div>
      <input type="hidden" name="displayName" />
      <input type="hidden" name="sourceUrl" />
      <input type="hidden" name="nexusId" />
      <div id="installModMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="openInstallSourceBtn" type="button" data-i18n="installUrl.openSource"></button>
        <button id="cancelInstallModBtn" type="button" data-i18n="action.cancel"></button>
        <button class="primary" type="submit" data-i18n="action.install"></button>
      </div>
    </form>
  </div>

  <div id="installModLocalDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="installModLocalTitle">
    <form id="installModLocalForm" class="modal-panel">
      <h2 id="installModLocalTitle" data-i18n="installLocal.title"></h2>
      <p class="modal-message" data-i18n="installLocal.help"></p>
      <label>
        <strong data-i18n="installLocal.localZip"></strong>
        <input name="localZip" type="file" accept=".zip,application/zip,application/x-zip-compressed" />
      </label>
      <input type="hidden" name="displayName" />
      <div id="installModLocalMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="cancelInstallModLocalBtn" type="button" data-i18n="action.cancel"></button>
        <button class="primary" type="submit" data-i18n="installLocal.upload"></button>
      </div>
    </form>
  </div>

  <div id="modConfigDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="modConfigTitle">
    <form id="modConfigForm" class="modal-panel">
      <h2 id="modConfigTitle" data-i18n="modConfig.title"></h2>
      <p class="modal-message" data-i18n="modConfig.description"></p>
      <label>
        <strong>config.json</strong>
        <textarea id="modConfigText" name="text" spellcheck="false" autocomplete="off"></textarea>
      </label>
      <input type="hidden" name="directoryName" />
      <div id="modConfigMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="formatModConfigBtn" type="button" data-i18n="modConfig.formatJson"></button>
        <button id="cancelModConfigBtn" type="button" data-i18n="action.cancel"></button>
        <button class="primary" type="submit" data-i18n="action.saveConfig"></button>
        <button id="saveModConfigRestartBtn" class="danger" type="submit" data-restart-after-save="true" data-i18n="action.saveAndRestart"></button>
      </div>
    </form>
  </div>

  <script>window.SDV_I18N = ${I18N_JSON};</script>
  <script>
    const authPanel = document.querySelector("#authPanel");
    const appPanel = document.querySelector("#appPanel");
    const authForm = document.querySelector("#authForm");
    const tokenInput = document.querySelector("#tokenInput");
    const authMessage = document.querySelector("#authMessage");
    const adminToolbar = document.querySelector("#adminToolbar");
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
    const modManagerPanel = document.querySelector("#modManagerPanel");
    const modsMessage = document.querySelector("#modsMessage");
    const refreshModsBtn = document.querySelector("#refreshModsBtn");
    const diagnoseModsBtn = document.querySelector("#diagnoseModsBtn");
    const backupBeforeModsBtn = document.querySelector("#backupBeforeModsBtn");
    const modSearchInput = document.querySelector("#modSearchInput");
    const searchModsBtn = document.querySelector("#searchModsBtn");
    const installModUrlBtn = document.querySelector("#installModUrlBtn");
    const installModLocalBtn = document.querySelector("#installModLocalBtn");
    const modSearchPanel = document.querySelector("#modSearchPanel");
    const modSearchSummary = document.querySelector("#modSearchSummary");
    const modSearchResults = document.querySelector("#modSearchResults");
    const installedModsList = document.querySelector("#installedModsList");
    const modGuidanceList = document.querySelector("#modGuidanceList");
    const modLoadSummary = document.querySelector("#modLoadSummary");
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
    const editConfigDialog = document.querySelector("#editConfigDialog");
    const editConfigForm = document.querySelector("#editConfigForm");
    const editConfigMessage = document.querySelector("#editConfigMessage");
    const editConfigTitle = document.querySelector("#editConfigTitle");
    const cancelEditConfigBtn = document.querySelector("#cancelEditConfigBtn");
    const repairCabinsFromConfigBtn = document.querySelector("#repairCabinsFromConfigBtn");
    const installModDialog = document.querySelector("#installModDialog");
    const installModForm = document.querySelector("#installModForm");
    const installModTitle = document.querySelector("#installModTitle");
    const installModHelp = document.querySelector("#installModHelp");
    const installModMessage = document.querySelector("#installModMessage");
    const installModLocalDialog = document.querySelector("#installModLocalDialog");
    const installModLocalForm = document.querySelector("#installModLocalForm");
    const installModLocalMessage = document.querySelector("#installModLocalMessage");
    const modConfigDialog = document.querySelector("#modConfigDialog");
    const modConfigForm = document.querySelector("#modConfigForm");
    const modConfigTitle = document.querySelector("#modConfigTitle");
    const modConfigMessage = document.querySelector("#modConfigMessage");
    const formatModConfigBtn = document.querySelector("#formatModConfigBtn");
    const cancelModConfigBtn = document.querySelector("#cancelModConfigBtn");
    const nexusFilesPanel = document.querySelector("#nexusFilesPanel");
    const nexusFilesSummary = document.querySelector("#nexusFilesSummary");
    const nexusFilesList = document.querySelector("#nexusFilesList");
    const openInstallSourceBtn = document.querySelector("#openInstallSourceBtn");
    const cancelInstallModBtn = document.querySelector("#cancelInstallModBtn");
    const cancelInstallModLocalBtn = document.querySelector("#cancelInstallModLocalBtn");
    const playersMessage = document.querySelector("#playersMessage");
    const repairServerApiBtn = document.querySelector("#repairServerApiBtn");
    const onlinePlayersList = document.querySelector("#onlinePlayersList");
    const farmhandsList = document.querySelector("#farmhandsList");
    const playerManagerPanel = document.querySelector("#playerManagerPanel");
    const logsPanel = document.querySelector("#logs");
    const loadLogsBtn = document.querySelector("#loadLogsBtn");
    const firstLogsPageBtn = document.querySelector("#firstLogsPageBtn");
    const previousLogsPageBtn = document.querySelector("#previousLogsPageBtn");
    const logPageInput = document.querySelector("#logPageInput");
    const goToLogsPageBtn = document.querySelector("#goToLogsPageBtn");
    const nextLogsPageBtn = document.querySelector("#nextLogsPageBtn");
    const lastLogsPageBtn = document.querySelector("#lastLogsPageBtn");
    const logPageSize = document.querySelector("#logPageSize");
    const logPageSummary = document.querySelector("#logPageSummary");
    const logPagination = document.querySelector("#logPagination");
    const diagnosticsBtn = document.querySelector("#diagnosticsBtn");
    const copyLogsBtn = document.querySelector("#copyLogsBtn");
    const languageSelect = document.querySelector("#languageSelect");
    const i18n = window.SDV_I18N || {};
    const defaultLanguage = "zh-CN";
    const languageStorageKey = "sdv-admin-language";
    let hasConfig = false;
    let shutdownPollTimer = null;
    let logsMode = "recent";
    let logPageState = { page: 1, pageSize: 200, totalPages: 1, totalLines: 0 };
    let logsLoaded = false;
    let latestStatus = null;
    let latestConfig = null;
    let latestSaveManagement = null;
    let latestPlayerManagement = null;
    let latestModManagement = null;
    let latestModSearchResults = [];
    let latestModSearchQuery = "";
    let activeAdminToken = "";
    let currentLanguage = pickLanguage(localStorage.getItem(languageStorageKey) || navigator.language || defaultLanguage);

    function pickLanguage(language) {
      const value = String(language || "").toLowerCase();
      if (value === "en" || value.startsWith("en-")) return "en";
      if (value === "zh" || value === "zh-cn" || value.startsWith("zh-hans")) return "zh-CN";
      return i18n[value] ? value : defaultLanguage;
    }

    function t(key, params = {}) {
      const dict = i18n[currentLanguage] || {};
      const fallback = i18n[defaultLanguage] || {};
      const raw = dict[key] ?? fallback[key] ?? key;
      return String(raw).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => (
        params[name] == null ? "" : String(params[name])
      ));
    }

    function applyStaticTranslations() {
      document.documentElement.lang = currentLanguage;
      document.querySelectorAll("[data-i18n]").forEach((element) => {
        element.textContent = t(element.dataset.i18n);
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
        element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
      });
      document.querySelectorAll("[data-i18n-title]").forEach((element) => {
        element.setAttribute("title", t(element.dataset.i18nTitle));
      });
      document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
        element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
      });
      if (languageSelect) languageSelect.value = currentLanguage;
    }

    function setLanguage(language) {
      currentLanguage = pickLanguage(language);
      localStorage.setItem(languageStorageKey, currentLanguage);
      applyStaticTranslations();
      rerenderLocalizedData();
    }

    function rerenderLocalizedData() {
      if (latestConfig) {
        refreshFarmTypeOptions(latestConfig);
        renderNexusApiKeyStatus(latestConfig.env || {});
      }
      if (latestStatus) {
        renderStatus(latestStatus);
        if (latestConfig) renderRuntimeFarmNotice(latestStatus, latestConfig);
      }
      if (latestSaveManagement) renderSaveManagement(latestSaveManagement);
      if (latestPlayerManagement && !latestStatus) renderPlayerManagement(latestPlayerManagement);
      if (latestModManagement) renderModManagement(latestModManagement);
      if (logsLoaded) {
        renderLogPagination({
          ...logPageState,
          hasNewerPage: logPageState.page > 1,
          hasOlderPage: logPageState.page < logPageState.totalPages,
        });
      }
    }

    applyStaticTranslations();

    document.querySelector(".tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
      document.querySelector('[data-pane="' + btn.dataset.tab + '"]').classList.remove("hidden");
      if (btn.dataset.tab === "logs" && !logsLoaded) {
        loadLogPage(1).catch((error) => setLogsText(error.message, "full"));
      }
    });

    languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));

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

    function renderLogPagination(data) {
      logPageState = {
        page: Number(data.page || 1),
        pageSize: Number(data.pageSize || 200),
        totalPages: Number(data.totalPages || 1),
        totalLines: Number(data.totalLines || 0),
      };
      logPageSize.value = String(logPageState.pageSize);
      logPageInput.value = String(logPageState.page);
      logPageInput.max = String(logPageState.totalPages);
      firstLogsPageBtn.disabled = logPageState.page <= 1;
      previousLogsPageBtn.disabled = logPageState.page <= 1;
      nextLogsPageBtn.disabled = logPageState.page >= logPageState.totalPages;
      lastLogsPageBtn.disabled = logPageState.page >= logPageState.totalPages;
      logPageSummary.textContent = t("logs.pageSummary", {
        page: logPageState.page,
        totalPages: logPageState.totalPages,
        totalLines: logPageState.totalLines,
      });
    }

    async function loadLogPage(page = 1) {
      const pageSize = Number(logPageSize.value || logPageState.pageSize || 200);
      [loadLogsBtn, firstLogsPageBtn, previousLogsPageBtn, logPageInput, goToLogsPageBtn, nextLogsPageBtn, lastLogsPageBtn, logPageSize].forEach((element) => {
        element.disabled = true;
      });
      try {
        const data = await request("/api/logs?page=" + encodeURIComponent(page) + "&pageSize=" + encodeURIComponent(pageSize));
        setLogsText(data.logs, "full");
        logPagination.classList.remove("hidden");
        renderLogPagination(data);
        logsLoaded = true;
      } finally {
        loadLogsBtn.disabled = false;
        logPageSize.disabled = false;
        logPageInput.disabled = false;
        goToLogsPageBtn.disabled = false;
        firstLogsPageBtn.disabled = logPageState.page <= 1;
        previousLogsPageBtn.disabled = logPageState.page <= 1;
        nextLogsPageBtn.disabled = logPageState.page >= logPageState.totalPages;
        lastLogsPageBtn.disabled = logPageState.page >= logPageState.totalPages;
      }
    }

    function metricHtml(label, value, kind) {
      return '<div class="metric">' +
        '<strong>' + escapeHtml(label) + '</strong>' +
        '<span class="' + escapeHtml(kind || "") + '">' + escapeHtml(value) + '</span>' +
      '</div>';
    }

    function loadReportStateText(report) {
      if (!report?.logAvailable || !report?.smapiDetected) return t("mods.loadNoLogs");
      if (report.errors?.length || report.problemMods?.length || report.skipped?.length) return t("mods.loadNeedsAttention");
      if (report.warningMods?.length || report.runtimeWarnings?.length) return t("mods.loadWarnings");
      if (report.logWindowMissedStartup || report.startupSummaryMissing) return t("mods.loadLogWindowMissing");
      if (report.unconfirmedInstalled?.length || report.directoryIssues?.length) return t("mods.loadPartial");
      return t("mods.loadHealthy");
    }

    function renderModLoadSummary(report, installedCount) {
      if (!modLoadSummary) return;
      const loadedSummary = report?.loadedSummaryCount;
      const loadedText = loadedSummary == null
        ? t("mods.loadUnknown")
        : String(loadedSummary);
      const stateKind = (!report?.logAvailable || !report?.smapiDetected || report.errors?.length || report.problemMods?.length || report.skipped?.length)
        ? "bad"
        : ((report.warningMods?.length || report.runtimeWarnings?.length || report.unconfirmedInstalled?.length || report.directoryIssues?.length || report.startupSummaryMissing) ? "warn" : "ok");
      modLoadSummary.innerHTML = [
        metricHtml(t("mods.metricInstalled"), installedCount, ""),
        metricHtml(t("mods.metricLoaded"), loadedText, loadedSummary == null ? "warn" : "ok"),
        metricHtml(t("mods.metricUnconfirmed"), String(report?.unconfirmedInstalled?.length || 0), report?.unconfirmedInstalled?.length ? "warn" : "ok"),
        metricHtml(t("mods.metricState"), loadReportStateText(report), stateKind),
      ].join("");
    }

    function modLoadReasonText(item) {
      const reason = item?.reason || "";
      const map = {
        "loaded": t("mods.reasonLoaded"),
        "runtime-warning": t("mods.reasonRuntimeWarning"),
        "missing-dependency": t("mods.reasonMissingDependency"),
        "manifest-error": t("mods.reasonManifestError"),
        "empty-folder": t("mods.reasonEmptyFolder"),
        "skipped": t("mods.reasonSkipped"),
        "load-failed": t("mods.reasonLoadFailed"),
        "runtime-error": t("mods.reasonRuntimeError"),
        "not-seen-in-log": t("mods.reasonNotSeen"),
        "log-unavailable": t("mods.reasonNoLogs"),
        "startup-summary-missing": t("mods.reasonStartupSummaryMissing"),
      };
      return map[reason] || reason || "";
    }

    function modLoadPill(report, mod) {
      const item = report?.byDirectory?.[mod.directoryName];
      if (!report?.logAvailable || !report?.smapiDetected) return "";
      if (!item) return "";
      if (item.state === "loaded") {
        const pillClass = item.severity === "warn" ? "warn" : "ok";
        const text = item.severity === "warn" ? t("mods.loadWarning") : t("mods.loadConfirmed");
        return ' <span class="pill ' + pillClass + '" title="' + escapeHtml(item.evidence || "") + '">' + escapeHtml(text) + '</span>';
      }
      if (item.state === "warning") {
        return ' <span class="pill warn" title="' + escapeHtml(item.evidence || "") + '">' + escapeHtml(t("mods.loadWarning")) + '</span>';
      }
      if (item.state === "problem") {
        return ' <span class="pill bad" title="' + escapeHtml(item.evidence || "") + '">' + escapeHtml(t("mods.loadProblem")) + '</span>';
      }
      const pillClass = item.severity === "unknown" ? "muted" : "warn";
      return ' <span class="pill ' + pillClass + '" title="' + escapeHtml(modLoadReasonText(item)) + '">' + escapeHtml(t("mods.loadUnconfirmed")) + '</span>';
    }

    function modLoadDetailHtml(report, mod) {
      const item = report?.byDirectory?.[mod.directoryName];
      if (!item) return "";
      const reason = modLoadReasonText(item);
      const evidence = item.evidence || "";
      if (!reason && !evidence) return "";
      const cls = item.severity === "error" ? "bad" : (item.severity === "warn" ? "warn" : "");
      const text = [reason, evidence].filter(Boolean).join("：");
      return '<span class="hint ' + cls + '">' + escapeHtml(text) + '</span>';
    }

    function diagnosticsText(report) {
      const loadReport = report.mods?.loadReport || {};
      const containerVisibility = report.mods?.containerVisibility || {};
      const steamAuth = report.steamAuth || {};
      const steamAuthLog = steamAuth.logReport || {};
      const gameCrash = report.gameCrash || {};
      const lines = [
        "StardewValleyServerKit diagnostics",
        "Generated: " + (report.generatedAt || ""),
        "",
        "Summary: " + (report.summary?.message || "n/a"),
        "Status: " + (report.summary?.status || "unknown"),
        "",
        "Environment:",
        "API_ENABLED=" + report.env?.apiEnabled,
        "API_PORT=" + report.env?.apiPort,
        "API_KEY_SET=" + report.env?.apiKeySet,
        "ADMIN_HOST=" + report.env?.adminHost,
        "ADMIN_PORT=" + report.env?.adminPort,
        "IMAGE_VERSION=" + report.env?.imageVersion,
        "",
        "Server API:",
        JSON.stringify(report.serverApi || {}, null, 2),
        "",
        "Steam Auth:",
        "status=" + (steamAuth.status || "unknown"),
        "message=" + (steamAuth.message || "n/a"),
        "setupCommand=" + (steamAuthLog.setupCommand || "./scripts/sdv-server.sh login"),
        "fallbackRecommended=" + Boolean(steamAuthLog.fallbackRecommended),
        "guardRequired=" + Boolean(steamAuthLog.guardRequired),
        "manifestForbidden=" + Boolean(steamAuthLog.manifestForbidden),
        "issues:",
        (steamAuth.issues || []).join("\n") || "none",
        "recentErrors:",
        (steamAuthLog.recentErrors || []).join("\n") || "none",
        "",
        "Game crash:",
        "status=" + (gameCrash.status || "unknown"),
        "message=" + (gameCrash.message || "n/a"),
        "newDayDisconnectCrash=" + Boolean(gameCrash.newDayDisconnectCrash),
        "newDaySyncCrash=" + Boolean(gameCrash.newDaySyncCrash),
        "crashGuardLoaded=" + Boolean(gameCrash.crashGuardLoaded),
        "crashGuardSuppressedCount=" + (gameCrash.crashGuardSuppressedCount || 0),
        "keyIds=" + ((gameCrash.keyIds || []).join(",") || "none"),
        "repeatCount=" + (gameCrash.repeatCount || 0),
        "timestamp=" + (gameCrash.timestamp || "n/a"),
        "issues:",
        (gameCrash.issues || []).join("\n") || "none",
        "recommendations:",
        (gameCrash.recommendations || []).join("\n") || "none",
        "recentErrors:",
        (gameCrash.recentErrors || []).join("\n") || "none",
        "crashGuardRecentEvents:",
        (gameCrash.crashGuardRecentEvents || []).join("\n") || "none",
        "",
        "Stack:",
        JSON.stringify(report.stack || {}, null, 2),
        "",
        "Mods:",
        "modsDir=" + (report.mods?.modsDir || "data/mods"),
        "containerModsDir=" + (report.mods?.containerModsDir || "/data/Mods/user"),
        "installedCount=" + (report.mods?.installedCount || 0),
        "loadedSummaryCount=" + (loadReport.loadedSummaryCount ?? "unknown"),
        "smapiStartupSummaryFound=" + Boolean(loadReport.smapiStartupSummaryFound),
        "startupSummaryMissing=" + Boolean(loadReport.startupSummaryMissing),
        "logWindowMissedStartup=" + Boolean(loadReport.logWindowMissedStartup),
        "analysisWindowLines=" + (loadReport.analysisWindowLines || 0) + "/" + (loadReport.analysisMaxLines || "unknown"),
        "unconfirmedInstalled=" + (loadReport.unconfirmedInstalled?.length || 0),
        "warningMods=" + (loadReport.warningMods?.length || 0),
        "problemMods=" + (loadReport.problemMods?.length || 0),
        "directoryIssues=" + (loadReport.directoryIssues?.length || report.mods?.directoryIssues?.length || 0),
        "smapiErrors=" + (loadReport.errors?.length || 0),
        "",
        "Container mod visibility:",
        "available=" + Boolean(containerVisibility.available),
        "status=" + (containerVisibility.status || "unknown"),
        "message=" + (containerVisibility.message || "n/a"),
        "roots=" + JSON.stringify(containerVisibility.roots || {}),
        "seenInstalledCount=" + (containerVisibility.seenInstalledCount ?? "unknown") + "/" + (containerVisibility.expectedInstalledCount ?? "unknown"),
        "missingInstalled=" + ((containerVisibility.missingInstalled || []).map((mod) => mod.directoryName).join(", ") || "none"),
        "userManifests:",
        (containerVisibility.userManifests || []).slice(0, 80).join("\n") || "none",
        "",
        "Mod load details:",
        Object.values(loadReport.byDirectory || {}).map((item) => (
          String(item.directoryName || "unknown") + ": " +
            String(item.state || "unknown") + "/" + String(item.severity || "unknown") + " " +
            String(item.reason || "") + (item.evidence ? " | " + item.evidence : "")
        )).join("\n") || "none",
        "",
        "Recent SMAPI problems:",
        [...(loadReport.errors || []), ...(loadReport.skipped || []), ...(loadReport.warnings || []), ...(loadReport.runtimeWarnings || [])].slice(0, 40).join("\n") || "none",
        "",
        "Recent logs:",
        report.logs?.tail || "",
      ];
      return lines.join("\n");
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

    function formatTimeOfDay(value) {
      const raw = String(value ?? 0).padStart(4, "0");
      return raw.slice(0, -2) + ":" + raw.slice(-2);
    }

    function farmTypeLabel(value) {
      const map = {
        0: t("farm.standard"),
        1: t("farm.riverland"),
        2: t("farm.forest"),
        3: t("farm.hilltop"),
        4: t("farm.wilderness"),
        5: t("farm.fourCorners"),
        6: t("farm.beach"),
        7: t("farm.meadowlands"),
      };
      return map[value] != null ? map[value] + "（" + value + "）" : String(value ?? "n/a");
    }

    function openEditConfigDialog(saveName, result) {
      const config = result.config || {};
      const settings = result.settings || {};
      const save = result.save || {};
      const form = editConfigForm.elements;
      form.saveName.value = saveName;
      form.farmName.value = config.farmName || "";
      form.money.value = config.money ?? 0;
      form.year.value = config.year ?? 1;
      form.currentSeason.value = config.currentSeason || "spring";
      form.dayOfMonth.value = config.dayOfMonth ?? 1;
      form.timeOfDay.value = formatTimeOfDay(config.timeOfDay);
      form.totalMoneyEarned.value = (config.totalMoneyEarned ?? 0).toLocaleString();
      form.whichFarm.value = farmTypeLabel(config.whichFarm);
      form.maxPlayers.value = settings.Server?.MaxPlayers ?? configForm.elements.maxPlayers.value ?? 4;
      form.targetCabins.value = settings.Game?.StartingCabins ?? Math.max(save.usableCabinCount || 0, save.cabinCount || 1, 1);
      form.cabinStatus.value = t("saveConfig.cabinStatus", {
        cabins: save.cabinCount ?? 0,
        roles: save.usableCabinCount ?? save.cabinCount ?? 0,
      });
      editConfigTitle.textContent = t("saveConfig.titleWithName", { name: saveName });
      setMessage(editConfigMessage, "");
      editConfigDialog.classList.remove("hidden");
      setTimeout(() => form.farmName.focus(), 0);
    }

    function closeEditConfigDialog() {
      editConfigDialog.classList.add("hidden");
      setMessage(editConfigMessage, "");
    }

    function openInstallModDialog(options = {}) {
      const form = installModForm.elements;
      form.url.value = "";
      form.displayName.value = options.displayName || "";
      form.sourceUrl.value = options.sourceUrl || "";
      form.nexusId.value = options.nexusId || "";
      installModTitle.textContent = options.displayName
        ? t("installUrl.titleWithName", { name: options.displayName })
        : t("installUrl.title");
      installModHelp.textContent = options.sourceUrl
        ? t("installUrl.helpSource")
        : t("installUrl.help");
      openInstallSourceBtn.disabled = !options.sourceUrl;
      nexusFilesPanel.classList.add("hidden");
      nexusFilesSummary.textContent = "";
      nexusFilesList.innerHTML = "";
      setMessage(installModMessage, "");
      installModDialog.classList.remove("hidden");
      setTimeout(() => form.url.focus(), 0);
      if (options.nexusId) {
        loadNexusFiles(options.nexusId).catch((error) => setMessage(installModMessage, error.message, "bad"));
      }
    }

    function openInstallModLocalDialog(options = {}) {
      const form = installModLocalForm.elements;
      form.localZip.value = "";
      form.displayName.value = options.displayName || "";
      setMessage(installModLocalMessage, "");
      installModLocalDialog.classList.remove("hidden");
      setTimeout(() => form.localZip.focus(), 0);
    }

    function closeInstallModDialog() {
      installModDialog.classList.add("hidden");
      setMessage(installModMessage, "");
    }

    function closeInstallModLocalDialog() {
      installModLocalDialog.classList.add("hidden");
      setMessage(installModLocalMessage, "");
    }

    function formatJsonText(text) {
      return JSON.stringify(JSON.parse(text), null, 2) + "\n";
    }

    async function openModConfigDialog(directoryName, displayName) {
      const label = displayName || directoryName;
      modConfigForm.elements.directoryName.value = directoryName;
      modConfigForm.elements.text.value = "";
      modConfigTitle.textContent = t("modConfig.titleWithName", { name: label });
      setMessage(modConfigMessage, t("modConfig.reading"));
      modConfigDialog.classList.remove("hidden");
      try {
        const config = await request("/api/mods/config?directoryName=" + encodeURIComponent(directoryName));
        modConfigForm.elements.text.value = config.text || "";
        setMessage(modConfigMessage, t("modConfig.readOk"), "ok");
        setTimeout(() => modConfigForm.elements.text.focus(), 0);
      } catch (error) {
        setMessage(modConfigMessage, error.message, "bad");
      }
    }

    function closeModConfigDialog() {
      modConfigDialog.classList.add("hidden");
      setMessage(modConfigMessage, "");
    }

    function formatKb(sizeKb) {
      const value = Number(sizeKb || 0);
      if (!Number.isFinite(value) || value <= 0) return t("farm.unknownSize");
      if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " GB";
      if (value >= 1024) return (value / 1024).toFixed(1) + " MB";
      return Math.round(value) + " KB";
    }

    const nexusFileGroupOrder = ["main", "patch", "optional", "old", "other"];
    const modUploadMaxBytes = 100 * 1024 * 1024;
    const nexusFileGroupMeta = {
      main: { title: "nexus.group.main.title", hint: "nexus.group.main.hint" },
      patch: { title: "nexus.group.patch.title", hint: "nexus.group.patch.hint" },
      optional: { title: "nexus.group.optional.title", hint: "nexus.group.optional.hint" },
      old: { title: "nexus.group.old.title", hint: "nexus.group.old.hint" },
      other: { title: "nexus.group.other.title", hint: "nexus.group.other.hint" },
    };

    function nexusFileGroup(file) {
      const group = String(file?.group || "").toLowerCase();
      if (nexusFileGroupOrder.includes(group)) return group;
      const id = Number(file?.categoryId || file?.category_id || 0);
      const name = String(file?.categoryName || file?.category_name || "").toUpperCase();
      if (id === 1 || name === "MAIN") return "main";
      if (id === 2 || name.includes("UPDATE") || name.includes("PATCH")) return "patch";
      if (id === 3 || name.includes("OPTION")) return "optional";
      if (id === 4 || name.includes("OLD")) return "old";
      return "other";
    }

    function groupNexusFiles(files) {
      const groups = Object.fromEntries(nexusFileGroupOrder.map((group) => [group, []]));
      files.forEach((file) => groups[nexusFileGroup(file)].push(file));
      return groups;
    }

    function normalizeNexusGroups(result, files) {
      if (!result?.groups || typeof result.groups !== "object") return groupNexusFiles(files);
      const groups = Object.fromEntries(nexusFileGroupOrder.map((group) => [
        group,
        Array.isArray(result.groups[group]) ? result.groups[group] : [],
      ]));
      const groupedIds = new Set(nexusFileGroupOrder.flatMap((group) => groups[group].map((file) => String(file.fileId))));
      files.forEach((file) => {
        if (!groupedIds.has(String(file.fileId))) groups[nexusFileGroup(file)].push(file);
      });
      return groups;
    }

    function renderNexusFileItem(file, recommendedFileId) {
      const fileId = String(file.fileId || "");
      const isRecommended = recommendedFileId && fileId === recommendedFileId;
      const badges = [
        isRecommended ? pill(t("nexus.recommended"), "ok") : "",
        file.isPrimary ? pill(t("nexus.mainFile"), "ok") : "",
      ].filter(Boolean).join(" ");
      const buttonClass = isRecommended ? ' class="primary"' : "";
      const buttonText = isRecommended ? t("nexus.installRecommended") : t("nexus.installFile");
      const fileName = file.fileName && file.fileName !== file.name
        ? '<span class="hint">' + escapeHtml(t("nexus.fileName", { name: file.fileName })) + '</span>'
        : "";
      const uploadedAt = file.uploadedAt
        ? escapeHtml(t("nexus.uploaded", { time: formatDateTime(file.uploadedAt) }))
        : "";
      return '<div class="manage-item' + (isRecommended ? ' recommended' : '') + '">' +
        '<div><strong>' + escapeHtml(file.name) + (badges ? " " + badges : "") + '</strong>' +
          '<span class="hint">' + escapeHtml(t("nexus.type", { type: file.categoryName || "UNKNOWN" })) +
          ' · ' + escapeHtml(t("nexus.fileId", { id: file.fileId })) +
          ' · ' + escapeHtml(t("nexus.size", { size: formatKb(file.sizeKb) })) +
          (file.version ? ' · ' + escapeHtml(t("nexus.version", { version: file.version })) : '') +
          uploadedAt + '</span>' +
          fileName +
          (file.description ? '<span class="hint">' + escapeHtml(file.description) + '</span>' : '') +
        '</div>' +
        '<div class="manage-actions">' +
          '<button' + buttonClass + ' type="button" data-action="install-nexus-file" data-file-id="' + escapeHtml(file.fileId) + '" data-file-name="' + escapeHtml(file.name) + '">' + escapeHtml(buttonText) + '</button>' +
        '</div>' +
      '</div>';
    }

    function renderNexusFileGroup(group, files, recommendedFileId) {
      if (!files.length) return "";
      const meta = nexusFileGroupMeta[group] || nexusFileGroupMeta.other;
      return '<div class="nexus-file-group">' +
        '<div class="nexus-file-heading"><h4>' + escapeHtml(t(meta.title)) + '</h4><span class="hint">' + escapeHtml(t("nexus.fileCount", { count: files.length })) + '</span></div>' +
        '<div class="hint">' + escapeHtml(t(meta.hint)) + '</div>' +
        '<div class="manage-list">' + files.map((file) => renderNexusFileItem(file, recommendedFileId)).join("") + '</div>' +
      '</div>';
    }

    function renderNexusFiles(result) {
      const files = Array.isArray(result) ? result : (Array.isArray(result?.files) ? result.files : []);
      const recommendedFileId = Array.isArray(result) ? "" : String(result?.recommendedFileId || "");
      const updateCount = Array.isArray(result?.fileUpdates) ? result.fileUpdates.length : 0;
      const cacheText = result?.cached ? t("nexus.cacheSuffix") : "";
      const groups = normalizeNexusGroups(result, files);
      nexusFilesPanel.classList.remove("hidden");
      nexusFilesSummary.textContent = files.length
        ? t("nexus.foundFiles", {
            count: files.length,
            cache: cacheText,
            recommended: recommendedFileId ? t("nexus.recommendedSuffix") : "",
            updates: updateCount ? t("nexus.updateRelationsSuffix", { count: updateCount }) : "",
          })
        : t("nexus.noInstallableFiles");
      nexusFilesList.innerHTML = files.length
        ? nexusFileGroupOrder.map((group) => renderNexusFileGroup(group, groups[group] || [], recommendedFileId)).join("")
        : '<p class="muted">' + escapeHtml(t("nexus.noFiles")) + '</p>';
    }

    async function loadNexusFiles(nexusId) {
      setMessage(installModMessage, t("nexus.reading"));
      const result = await request("/api/mods/nexus/files", {
        method: "POST",
        body: JSON.stringify({ nexusId }),
      });
      renderNexusFiles(result);
      const sourceText = result?.cached ? t("nexus.cachePrefix") : "";
      setMessage(installModMessage, sourceText + t("nexus.groupedOk"), "ok");
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
      const { headers: optionHeaders, ...requestOptions } = options;
      const headers = { "Content-Type": "application/json", ...(optionHeaders || {}) };
      if (activeAdminToken && !headers["X-Admin-Token"] && !headers["x-admin-token"]) {
        headers["X-Admin-Token"] = activeAdminToken;
      }
      const response = await fetch(appPath(path), {
        credentials: "same-origin",
        ...requestOptions,
        headers,
      });
      if (response.status === 401) {
        activeAdminToken = "";
        adminToolbar.classList.add("hidden");
        appPanel.classList.add("hidden");
        authPanel.classList.remove("hidden");
        throw new Error(t("auth.required"));
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

    async function uploadModFile(file, displayName) {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("displayName", displayName || "");
      const headers = {};
      if (activeAdminToken) headers["X-Admin-Token"] = activeAdminToken;
      const response = await fetch(appPath("/api/mods/upload"), {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: formData,
      });
      if (response.status === 401) {
        activeAdminToken = "";
        adminToolbar.classList.add("hidden");
        appPanel.classList.add("hidden");
        authPanel.classList.remove("hidden");
        throw new Error(t("auth.required"));
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

    function safeExternalUrl(value) {
      try {
        const parsed = new URL(String(value || ""), location.href);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
      } catch (_) {
        return "";
      }
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
      const seasons = {
        spring: t("saveConfig.spring"),
        summer: t("saveConfig.summer"),
        fall: t("saveConfig.fall"),
        winter: t("saveConfig.winter"),
      };
      const season = seasons[String(runtime.season || "").toLowerCase()] || runtime.season || "";
      const rawTime = String(runtime.timeOfDay || 0).padStart(4, "0");
      const time = rawTime.slice(0, -2) + ":" + rawTime.slice(-2);
      return t("status.gameDate", { year: runtime.year, season, day: runtime.day, time });
    }

    function renderRuntimeFarmNotice(status, config) {
      const runtime = status.runtime;
      if (!runtime || !runtime.farmName) {
        runtimeFarmNotice.classList.add("hidden");
        runtimeFarmNotice.textContent = "";
        return;
      }

      const configuredName = config.settings.Game.FarmName || "Junimo";
      const nameText = t("status.runtimeName", { runtime: runtime.farmName, configured: configuredName });
      const suffix = runtime.farmName === configuredName
        ? t("status.runtimeSame")
        : t("status.runtimeDifferent");

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
      parts.push(policy.enabled ? t("saves.policyEnabled") : t("saves.policyDisabled"));
      parts.push(t("saves.policyRetention", { count: policy.retention || 10 }));
      if (policy.enabled && state.nextRunAt) parts.push(t("saves.nextRun", { time: formatDateTime(state.nextRunAt) }));
      if (state.running) parts.push(t("saves.backupRunning"));
      if (state.lastResult?.ok) {
        parts.push(t("saves.lastRun", { time: formatDateTime(state.lastRunAt), archive: state.lastResult.archive }));
        if (state.lastResult.pruned?.length) parts.push(t("saves.pruned", { count: state.lastResult.pruned.length }));
      } else if (state.lastResult?.error) {
        parts.push(t("saves.lastFailed", { error: state.lastResult.error }));
      }
      backupPolicyStatus.textContent = parts.join(" · ");
    }

    function renderSaveManagement(data) {
      latestSaveManagement = data;
      renderBackupPolicy(data);
      if (!data.volumeExists) {
        savesList.innerHTML = '<p class="muted">' + escapeHtml(t("saves.noVolume")) + '</p>';
      } else if (data.saves.length) {
        savesList.innerHTML = data.saves.map((save) => (
          (() => {
            const cabinText = save.usableCabinCount === save.cabinCount
              ? ' · ' + escapeHtml(t("saves.cabins", { count: save.cabinCount ?? 0 }))
              : ' · ' + escapeHtml(t("saves.cabins", { count: save.cabinCount ?? 0 })) +
                ' · ' + escapeHtml(t("saves.usableFarmhands", { count: save.usableCabinCount ?? 0 }));
            return (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(save.name) + '</strong>' +
              '<span class="hint">' + escapeHtml(t("saves.farm", { name: save.farmName || "Unknown" })) +
              ' · ' + escapeHtml(t("saves.map", { type: save.farmType ?? "n/a" })) +
              cabinText +
              ' · ' + escapeHtml(t("saves.updated", { time: formatDateTime(save.updatedAt) })) + '</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="select-save" data-name="' + escapeHtml(save.name) + '">' + escapeHtml(t("saves.nextLoad")) + '</button>' +
              '<button data-action="edit-config" data-name="' + escapeHtml(save.name) + '">' + escapeHtml(t("saves.viewConfig")) + '</button>' +
              '<button class="danger" data-action="delete-save" data-name="' + escapeHtml(save.name) + '">' + escapeHtml(t("action.delete")) + '</button>' +
            '</div>' +
          '</div>'
            );
          })()
        )).join("");
      } else {
        savesList.innerHTML = '<p class="muted">' + escapeHtml(t("saves.noSaves")) + '</p>';
      }

      backupsList.innerHTML = data.backups.length ? data.backups.map((backup) => (
        '<div class="manage-item">' +
          '<div><label class="backup-select-line">' +
            '<input class="backup-select" type="checkbox" value="' + escapeHtml(backup.archive) + '" />' +
            '<strong>' + escapeHtml(backup.archive) + '</strong>' +
          '</label>' +
            '<span class="hint">' + escapeHtml(formatBytes(backup.sizeBytes)) +
            ' · ' + escapeHtml(t("saves.created", { time: formatDateTime(backup.createdAt) })) + '</span></div>' +
          '<div class="manage-actions">' +
            '<button data-action="restore-backup" data-archive="' + escapeHtml(backup.archive) + '">' + escapeHtml(t("action.restore")) + '</button>' +
            '<button class="danger" data-action="delete-backup" data-archive="' + escapeHtml(backup.archive) + '">' + escapeHtml(t("action.delete")) + '</button>' +
          '</div>' +
        '</div>'
      )).join("") : '<p class="muted">' + escapeHtml(t("saves.noBackups")) + '</p>';
      deleteSelectedBackupsBtn.disabled = !data.backups.length;
    }

    function modSourceLinks(source, query) {
      const encoded = encodeURIComponent(query || "");
      const smapi = source?.searchUrls?.smapiCompatibility || "https://smapi.io/mods";
      const nexusBase = source?.searchUrls?.nexusSearch || "https://www.nexusmods.com/stardewvalley/search/";
      const nexus = encoded ? nexusBase + "?gsearchtype=mods&gsearch=" + encoded : nexusBase;
      return {
        smapi: safeExternalUrl(smapi) || "https://smapi.io/mods",
        nexus: safeExternalUrl(nexus) || "https://www.nexusmods.com/stardewvalley/search/",
        guide: safeExternalUrl(source?.searchUrls?.moddingGuide) || "https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started",
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

    function installedModKeys(mods) {
      const keys = new Set();
      (mods || []).forEach((mod) => {
        if (mod.uniqueId) keys.add(String(mod.uniqueId).toLowerCase());
        (mod.updateKeys || []).forEach((key) => keys.add(String(key).toLowerCase()));
      });
      return keys;
    }

    function renderModSearchResults() {
      if (!latestModSearchQuery) {
        modSearchPanel.classList.add("hidden");
        modSearchSummary.textContent = "";
        modSearchResults.innerHTML = "";
        return;
      }

      const installedKeys = installedModKeys(latestModManagement?.installed || []);
      modSearchPanel.classList.remove("hidden");
      modSearchSummary.textContent = t("mods.querySummary", {
        query: latestModSearchQuery,
        count: latestModSearchResults.length,
      });

      modSearchResults.innerHTML = latestModSearchResults.length ? latestModSearchResults.map((mod) => {
        const isInstalled = (mod.uniqueIds || []).some((id) => installedKeys.has(String(id).toLowerCase())) ||
          (mod.nexusId && installedKeys.has("nexus:" + String(mod.nexusId).toLowerCase()));
        const nexusUrl = safeExternalUrl(mod.nexusUrl);
        const sourceExternalUrl = safeExternalUrl(mod.sourceUrl);
        const sourceUrl = nexusUrl || sourceExternalUrl || "";
        return '<div class="manage-item">' +
          '<div><strong>' + escapeHtml(mod.name) + (isInstalled ? ' <span class="pill ok">' + escapeHtml(t("mods.installedBadge")) + '</span>' : '') + '</strong>' +
            '<span class="hint">' + escapeHtml(t("mods.author", { author: mod.author || "n/a" })) +
            ' · ' + escapeHtml(t("mods.uniqueIds", { ids: (mod.uniqueIds || []).join(", ") || "n/a" })) +
            ' · ' + escapeHtml(t("mods.nexusId", { id: mod.nexusId || "n/a" })) + '</span>' +
            '<span class="hint">' + escapeHtml(t("mods.compatibility", { status: mod.status || "unknown" })) +
            (mod.brokeIn ? ' · ' + escapeHtml(t("mods.brokeIn", { version: mod.brokeIn })) : '') + '</span>' +
            '<span class="hint">' + escapeHtml(mod.summary || t("mods.noSummary")) + '</span>' +
          '</div>' +
          '<div class="manage-actions">' +
            (nexusUrl ? '<button data-action="open-mod-url" data-url="' + escapeHtml(nexusUrl) + '">Nexus</button>' : '') +
            (sourceExternalUrl ? '<button data-action="open-mod-url" data-url="' + escapeHtml(sourceExternalUrl) + '">' + escapeHtml(t("mods.source")) + '</button>' : '') +
            '<button class="primary" data-action="install-mod" data-name="' + escapeHtml(mod.name) + '" data-source-url="' + escapeHtml(sourceUrl) + '" data-nexus-id="' + escapeHtml(mod.nexusId || "") + '">' + escapeHtml(t("action.install")) + '</button>' +
          '</div>' +
        '</div>';
      }).join("") : '<p class="muted">' + escapeHtml(t("mods.noSearchResults")) + '</p>';
    }

    function renderModManagement(data) {
      latestModManagement = data;
      const query = modSearchInput.value.trim().toLowerCase();
      const installed = data.installed || [];
      const loadReport = data.loadReport || {};
      const filtered = installed.filter((mod) => modMatchesSearch(mod, query));
      const sourceLinks = modSourceLinks(data.sources, "");
      renderModLoadSummary(loadReport, installed.length);
      setMessage(
        modsMessage,
        query
          ? t("mods.matchCount", { filtered: filtered.length, total: installed.length })
          : t("mods.installedCount", { count: installed.length }),
        "ok",
      );
      installedModsList.innerHTML = filtered.length ? filtered.map((mod) => (
        '<div class="manage-item">' +
          '<div><strong>' + escapeHtml(mod.name) + modLoadPill(loadReport, mod) + '</strong>' +
            '<span class="hint">' + escapeHtml(t("mods.directory", { directory: mod.directoryName })) +
            ' · UniqueID：' + escapeHtml(mod.uniqueId || "n/a") +
            ' · ' + escapeHtml(t("mods.version", { version: mod.version || "n/a" })) +
            ' · ' + escapeHtml(t("mods.author", { author: mod.author || "n/a" })) + '</span>' +
            '<span class="hint">' + escapeHtml(mod.description || t("mods.noDescription")) + '</span>' +
            '<span class="hint">' + escapeHtml(t("mods.api", { api: mod.minimumApiVersion || "n/a" })) +
            ' · ' + escapeHtml(t("mods.dll", { dll: mod.entryDll || "n/a" })) +
            ' · ' + escapeHtml(t("mods.updated", { time: formatDateTime(mod.updatedAt) })) + '</span>' +
            '<span class="hint">' + escapeHtml(t("mods.config", { text: mod.hasConfig ? ("config.json · " + formatDateTime(mod.configUpdatedAt)) : t("mods.configMissing") })) + '</span>' +
            modLoadDetailHtml(loadReport, mod) +
            (mod.updateKeys?.length ? '<span class="hint">UpdateKeys：' + escapeHtml(mod.updateKeys.join(", ")) + '</span>' : '') +
            (mod.hasManifest ? '' : '<span class="hint bad">' + escapeHtml(t("mods.manifestFailed", { error: mod.manifestError || t("mods.unknownError") })) + '</span>') +
            (mod.protected ? '<span class="hint warn">' + escapeHtml(mod.protectedReason || t("mods.systemProtected")) + '</span>' : '') +
          '</div>' +
          '<div class="manage-actions">' +
            (mod.hasConfig
              ? '<button data-action="edit-mod-config" data-directory="' + escapeHtml(mod.directoryName) + '" data-name="' + escapeHtml(mod.name) + '">' + escapeHtml(t("tab.config")) + '</button>'
              : '<button disabled title="' + escapeHtml(t("mods.noConfigTitle")) + '">' + escapeHtml(t("mods.noConfig")) + '</button>') +
            (mod.protected
              ? '<button class="danger" disabled title="' + escapeHtml(mod.protectedReason || t("mods.systemProtected")) + '">' + escapeHtml(t("mods.systemProtectedShort")) + '</button>'
              : '<button class="danger" data-action="delete-mod" data-directory="' + escapeHtml(mod.directoryName) + '" data-name="' + escapeHtml(mod.name) + '">' + escapeHtml(t("action.delete")) + '</button>') +
          '</div>' +
        '</div>'
      )).join("") : (query
        ? '<p class="muted">' + escapeHtml(t("mods.noMatchInstalled")) + '</p>'
        : '<p class="muted">' + escapeHtml(t("mods.noInstalled")) + '</p>');
      renderModSearchResults();

      modGuidanceList.innerHTML = [
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideLoadTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideLoad", {
          loaded: loadReport.loadedSummaryCount == null ? t("mods.loadUnknown") : loadReport.loadedSummaryCount,
          errors: loadReport.errors?.length || 0,
          skipped: loadReport.skipped?.length || 0,
          warnings: loadReport.warningMods?.length || loadReport.runtimeWarnings?.length || 0,
          window: loadReport.analysisWindowLines || 0,
        })) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideVisibilityTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideVisibility", {
          host: data.modsDir || "data/mods",
          container: data.containerModsDir || "/data/Mods/user",
          status: data.containerVisibility?.message || t("mods.visibilityUnknown"),
        })) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideBackupTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideBackup")) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideRestartTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideRestart")) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideInstallTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideInstall")) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideSourceTitle")) + '</strong><span class="hint">' + escapeHtml(t("mods.guideSource")) + '</span></div></div>',
        '<div class="manage-item"><div><strong>' + escapeHtml(t("mods.guideLinksTitle")) + '</strong><span class="hint"><a href="' + escapeHtml(sourceLinks.smapi) + '" target="_blank" rel="noreferrer">' + escapeHtml(t("mods.smapiList")) + '</a> · <a href="' + escapeHtml(sourceLinks.nexus) + '" target="_blank" rel="noreferrer">' + escapeHtml(t("mods.nexusSearch")) + '</a> · <a href="' + escapeHtml(sourceLinks.guide) + '" target="_blank" rel="noreferrer">' + escapeHtml(t("mods.gettingStarted")) + '</a></span></div></div>',
      ].join("");
    }

    function renderPlayerManagement(data) {
      latestPlayerManagement = data;
      const unsupported = data.unsupportedMessage || t("players.unsupported");
      const hasSaveFallback = data.farmhandSource === "save" && data.farmhands?.length;
      const diagnosticMessage = data.apiDiagnostic?.message || "";
      const apiHint = hasSaveFallback
        ? ((diagnosticMessage ? diagnosticMessage + " " : "") + t("players.apiDisconnectedFarmhandsFallback", {
            saveName: data.farmhandSourceSave || t("saves.unknown"),
          }))
        : (data.apiAvailable
          ? (data.auth?.enabled
            ? t("players.apiProtected", {
                authenticated: data.auth.authenticatedCount,
                pending: data.auth.pendingCount,
              })
            : t("players.apiConnected"))
          : (diagnosticMessage || t("players.apiDisconnected")));
      setMessage(playersMessage, apiHint, hasSaveFallback ? "warn" : (data.apiAvailable ? "ok" : "bad"));

      if (data.onlinePlayers?.length) {
        onlinePlayersList.innerHTML = data.onlinePlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">ID：' + escapeHtml(player.id || "n/a") +
              ' · ' + escapeHtml(t("players.statusOnline")) + '</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="grant-admin" data-name="' + escapeHtml(player.name) + '">' + escapeHtml(t("players.grantAdmin")) + '</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">' + escapeHtml(t("players.kick")) + '</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">' + escapeHtml(t("players.ban")) + '</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else if (data.recentPlayers?.length) {
        onlinePlayersList.innerHTML = data.recentPlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">' + escapeHtml(player.address || t("players.recentLog")) +
              ' · ' + escapeHtml(player.lastEvent || "seen") + '</span></div>' +
            '<div class="manage-actions">' +
              '<button disabled title="' + escapeHtml(t("players.apiListRequired")) + '">' + escapeHtml(t("players.grantAdmin")) + '</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">' + escapeHtml(t("players.kick")) + '</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">' + escapeHtml(t("players.ban")) + '</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else {
        onlinePlayersList.innerHTML = '<p class="muted">' + escapeHtml(t("players.noOnline")) + '</p>';
      }

      if (data.farmhands?.length) {
        farmhandsList.innerHTML = data.farmhands.map((farmhand) => {
          const name = farmhand.name || t("players.unnamedFarmhand");
          const canDelete = data.capabilities?.deleteFarmhand && farmhand.name && !farmhand.isOnline;
          const deleteTitle = farmhand.isOnline
            ? t("players.onlineCannotDelete")
            : (!data.capabilities?.deleteFarmhand
              ? t("players.deleteRequiresApi")
              : (farmhand.name ? t("players.deleteOfflineTitle") : t("players.unnamedCannotDelete")));
          const sourceText = data.farmhandSource === "save"
            ? " · " + t("players.farmhandSourceSave", { saveName: data.farmhandSourceSave || t("saves.unknown") })
            : "";
          return (
            '<div class="manage-item">' +
              '<div><strong>' + escapeHtml(name) + '</strong>' +
                '<span class="hint">ID：' + escapeHtml(farmhand.id || "n/a") +
                ' · ' + escapeHtml(farmhand.isCustomized ? t("players.customized") : t("players.notCustomized")) +
                ' · ' + escapeHtml(farmhand.isOnline ? t("players.onlineState") : t("players.offlineState")) +
                escapeHtml(sourceText) + '</span></div>' +
              '<div class="manage-actions">' +
                '<button class="danger" ' +
                  (canDelete ? 'data-action="delete-farmhand" data-name="' + escapeHtml(farmhand.name) + '"' : "disabled") +
                  ' title="' + escapeHtml(deleteTitle) + '">' + escapeHtml(t("players.deleteOffline")) + '</button>' +
              '</div>' +
            '</div>'
          );
        }).join("");
      } else {
        farmhandsList.innerHTML = '<p class="muted">' + escapeHtml(t("players.noFarmhands")) + '</p>';
      }
    }

    function farmTypeName(value, fallback) {
      const keys = {
        0: "farm.standard",
        1: "farm.riverland",
        2: "farm.forest",
        3: "farm.hilltop",
        4: "farm.wilderness",
        5: "farm.fourCorners",
        6: "farm.beach",
        7: "farm.meadowlands",
      };
      return keys[value] ? t(keys[value]) : (fallback || String(value));
    }

    function refreshFarmTypeOptions(data) {
      const currentValue = createMapForm.elements.farmType.value;
      const farmTypeOptions = data.farmTypes.map((item) => (
        '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(farmTypeName(item.value, item.label)) + "</option>"
      )).join("");
      createMapForm.elements.farmType.innerHTML = farmTypeOptions;
      if (currentValue) createMapForm.elements.farmType.value = currentValue;
    }

    function renderNexusApiKeyStatus(env) {
      document.querySelector("#nexusApiKeyStatus").textContent = env.nexusApiKeySet
        ? t("config.nexusKeySet")
        : t("config.nexusKeyUnset");
    }

    function fillConfig(data) {
      latestConfig = data;
      const settings = data.settings;
      const env = data.env;
      refreshFarmTypeOptions(data);

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
      configForm.elements.nexusApiKeyAction.value = "keep";
      configForm.elements.nexusApiKey.value = "";
      renderNexusApiKeyStatus(env);
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
        nexusApiKeyAction: form.nexusApiKeyAction.value,
        nexusApiKey: form.nexusApiKey.value,
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
      if (!state.ok && state.error) return t("status.containerReadFailed", { error: state.error });
      if (!state.containers?.length) return t("status.noContainers");
      return state.containers.map((container) => {
        const health = container.health && container.health !== "none" ? "/" + container.health : "";
        const startedAt = container.startedAt ? t("status.startedAt", { time: formatDateTime(container.startedAt) }) : "";
        return container.name + "=" + (container.status || "unknown") + health + startedAt;
      }).join("；");
    }

    function operationStepsText(steps) {
      return (steps || [])
        .map((step, index) => (index + 1) + ". " + step.label + (step.detail ? ": " + step.detail : ""))
        .join("\n");
    }

    function patchVerificationText(patch) {
      const verification = patch?.verification;
      return verification
        ? t("saveConfig.verification", {
            cabins: verification.cabinCount,
            roles: verification.usableCabinCount,
          })
        : "";
    }

    function createMapResultText(result) {
      const patch = result.cabinPatch || {};
      const lines = [
        t("createMap.created", { farmName: result.farmName }),
        result.newSaveName ? t("createMap.newSave", { saveName: result.newSaveName }) : "",
        result.selectedSaveName ? t("createMap.selectedSave", { saveName: result.selectedSaveName }) : "",
        result.preNewGameBackup ? t("createMap.preBackup", { backup: result.preNewGameBackup }) : "",
        result.restarted
          ? (result.restartVerified ? t("createMap.restartVerified") : t("createMap.restartUnverified"))
          : t("createMap.notRestarted"),
      ];
      if (result.cabinPatch) {
        lines.push(
          t("createMap.cabinPatch", {
            added: patch.addedCabins || 0,
            moved: patch.movedCabins || 0,
            cleared: patch.clearedFarmObstacles || 0,
            farmhands: patch.addedFarmhands || 0,
            fixed: patch.fixedCabinReferences || 0,
          }),
        );
        lines.push(patchVerificationText(patch));
      }
      const state = stackStateText(result.stackState);
      if (state) lines.push(t("createMap.currentStack", { state }));
      const steps = operationStepsText(result.steps);
      if (steps) lines.push(t("createMap.steps", { steps }));
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
      if (readiness.mode === "safe-empty") return t("status.safeEmpty");
      if (readiness.mode === "safe-saved") return t("status.safeSaved");
      if (readiness.mode === "warn-unsaved") return t("status.warnUnsaved");
      if (readiness.mode === "unknown-saved") return t("status.unknownSaved");
      return t("status.unknownOnline");
    }

    function shutdownReadinessMessage(readiness) {
      if (!readiness) return t("server.readinessUnknown");
      const count = readiness.onlinePlayerCount ?? "n/a";
      if (readiness.mode === "safe-empty") return t("server.readinessSafeEmpty");
      if (readiness.mode === "safe-saved") return t("server.readinessSafeSaved", { count });
      if (readiness.mode === "warn-unsaved") return t("server.readinessWarnUnsaved", { count });
      if (readiness.mode === "unknown-saved") return t("server.readinessUnknownSaved");
      return t("server.readinessUnknown");
    }

    function preferServerMessage(message, fallback) {
      return currentLanguage === defaultLanguage && message ? message : fallback;
    }

    async function restartServerAfterSave(messageTarget) {
      if (!confirm(t("server.confirmRestart"))) return false;
      setMessage(messageTarget, t("server.restarting"));
      await request("/api/restart", { method: "POST", body: "{}" });
      setTimeout(() => loadAll().catch(() => {}), 4000);
      setMessage(messageTarget, t("config.savedAndRestarted"), "ok");
      return true;
    }

    function setFormSubmitDisabled(form, disabled) {
      form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = disabled;
      });
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
        setMessage(serverActionMessage, preferServerMessage(job.message, t("status.waitingAutoStop")), "warn");
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
        setMessage(serverActionMessage, preferServerMessage(job.message, t("status.autoStopped")), "ok");
      } else if (job?.state === "failed" || job?.state === "timed-out") {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, preferServerMessage(job.message, t("status.autoStopFailed")), "bad");
      } else if (!serverActionMessage.textContent) {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, "");
      }
    }

    function renderStatus(data) {
      latestStatus = data;
      document.querySelector("#generatedAt").textContent = new Date(data.generatedAt).toLocaleTimeString();
      renderServerActions(data);
      const health = document.querySelector("#healthList");
      health.innerHTML = data.health.length ? data.health.map((item) => {
        const hasHealth = item.health && item.health !== "none";
        const kind = hasHealth
          ? (item.health === "healthy" ? "ok" : "bad")
          : (item.status === "running" ? "ok" : "bad");
        return row(item.name, pill((item.status || "unknown") + " / " + (item.health || "none"), kind));
      }).join("") : row("Docker", pill(data.dockerAvailable ? t("overview.dockerStopped") : t("overview.unavailable"), data.dockerAvailable ? "warn" : "bad"));

      const join = document.querySelector("#joinInfo");
      const lan = data.lanAddresses.filter((item) => item.recommended)[0] || data.lanAddresses[0];
      join.innerHTML = [
        row(t("overview.server"), pill(data.stackRunning ? t("overview.running") : t("overview.stopped"), data.stackRunning ? "ok" : "warn")),
        row(t("overview.localIp"), escapeHtml(data.join.sameMachine)),
        row(t("overview.lanIp"), escapeHtml(lan ? lan.address : "n/a")),
        row(t("overview.gamePort"), escapeHtml(data.join.gamePort)),
        row(t("overview.ipConnect"), pill(data.join.allowIpConnections ? t("overview.enabled") : t("overview.disabled"), data.join.allowIpConnections ? "ok" : "bad")),
        row(t("overview.inviteCode"), escapeHtml(data.join.inviteCode || "n/a")),
        row(t("overview.currentFarm"), escapeHtml(data.runtime?.farmName || "n/a")),
        row(t("overview.gameDate"), escapeHtml(formatGameDate(data.runtime))),
        row(t("overview.shutdownReadiness"), escapeHtml(shutdownLabel(data.shutdownReadiness))),
      ].join("");

      document.querySelector("#players").innerHTML = data.players.length ? data.players.map((player) => (
        '<div class="row"><span>' + escapeHtml(player.name) + '<br><span class="hint">' + escapeHtml(player.address || "") + '</span></span>' +
        pill(player.lastEvent || "seen", player.lastEvent === "joined" || player.lastEvent === "online" ? "ok" : "warn") + "</div>"
      )).join("") : '<p class="muted">' + escapeHtml(t("overview.noRecentPlayers")) + '</p>';

      renderPlayerManagement(data.playerManagement || {});

      function renderPortMapping(item, index) {
        if (typeof item === "string") {
          return row(t("overview.mapping", { index: index + 1 }), escapeHtml(item));
        }
        const target = item?.target || "";
        const endpoint = item?.endpoint || "";
        const raw = item?.raw || "";
        const value = target && endpoint ? target + " -> " + endpoint : raw;
        return row(
          t(item?.labelKey || "overview.port.other", { index: index + 1, target: target || raw || "n/a" }),
          escapeHtml(value || "n/a"),
        );
      }

      document.querySelector("#ports").innerHTML = data.publishedPorts.length
        ? data.publishedPorts.map((item, index) => renderPortMapping(item, index)).join("")
        : '<p class="muted">' + escapeHtml(t("overview.noPorts")) + '</p>';

      document.querySelector("#stats").innerHTML = data.stats.length
        ? data.stats.map((item) => row(item.name, escapeHtml((item.cpu || "") + " / " + (item.memory || "")))).join("")
        : '<p class="muted">' + escapeHtml(t("overview.noStats")) + '</p>';

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
      latestConfig = config;
      renderStatus(status);
      if (!hasConfig) fillConfig(config);
      renderRuntimeFarmNotice(status, config);
      renderSaveManagement(saveManagement);
      renderModManagement(modManagement);
      adminToolbar.classList.remove("hidden");
      authPanel.classList.add("hidden");
      appPanel.classList.remove("hidden");
    }

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(authMessage, t("auth.verifying"));
      const token = tokenInput.value.trim();
      try {
        await request("/api/auth", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        activeAdminToken = token;
        tokenInput.value = "";
        setMessage(authMessage, "");
        await loadAll();
      } catch (error) {
        setMessage(authMessage, error.message, "bad");
      }
    });

    configForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const restartAfterSave = event.submitter?.dataset.restartAfterSave === "true";
      setFormSubmitDisabled(configForm, true);
      setMessage(saveMessage, t("config.saving"));
      try {
        await request("/api/config", { method: "POST", body: JSON.stringify(formPayload()) });
        hasConfig = false;
        await loadAll();
        if (!restartAfterSave || !(await restartServerAfterSave(saveMessage))) {
          setMessage(saveMessage, t("config.saved"), "ok");
        }
      } catch (error) {
        setMessage(saveMessage, error.message, "bad");
      } finally {
        setFormSubmitDisabled(configForm, false);
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

    async function repairSaveCabinsFromForm(saveName, targetCabins, messageTarget) {
      async function submit(force) {
        return request("/api/saves/repair-cabins", {
          method: "POST",
          body: JSON.stringify({ saveName, targetCabins, force }),
        });
      }

      setMessage(messageTarget, t("saveConfig.repairing"));
      let result;
      try {
        result = await submit(false);
      } catch (error) {
        if (error.status !== 409) throw error;
        if (!confirm(t("saveConfig.confirmForceRepair", { message: error.message }))) return null;
        setMessage(messageTarget, t("saveConfig.forceRepairing"));
        result = await submit(true);
      }

      hasConfig = false;
      await loadAll();
      return result;
    }

    function repairSaveCabinsResultText(result) {
      const patch = result.cabinPatch || {};
      const restartText = result.restarted ? t("saves.restartDoneSuffix") : "";
      return t("saveConfig.repairResult", {
        saveName: result.saveName,
        target: result.targetCabins,
        added: patch.addedCabins || 0,
        moved: patch.movedCabins || 0,
        cleared: patch.clearedFarmObstacles || 0,
        farmhands: patch.addedFarmhands || 0,
        fixedCabins: patch.fixedCabinReferences || 0,
        fixedIds: patch.fixedFarmhandIds || 0,
        verification: patchVerificationText(patch),
        backup: result.preRepairBackup,
        restart: restartText,
      });
    }

    refreshModsBtn.addEventListener("click", async () => {
      setMessage(modsMessage, t("mods.refreshing"));
      try {
        await reloadModManagement();
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      }
    });

    diagnoseModsBtn.addEventListener("click", async () => {
      diagnoseModsBtn.disabled = true;
      setMessage(modsMessage, t("mods.diagnosing"));
      try {
        const report = await request("/api/diagnostics");
        setLogsText(diagnosticsText(report), "diagnostics");
        logPagination.classList.add("hidden");
        const loadReport = report.mods?.loadReport || {};
        setMessage(modsMessage, t("mods.diagnosed", {
          loaded: loadReport.loadedSummaryCount == null ? t("mods.loadUnknown") : loadReport.loadedSummaryCount,
          errors: loadReport.errors?.length || 0,
          skipped: loadReport.skipped?.length || 0,
          warnings: loadReport.warningMods?.length || loadReport.runtimeWarnings?.length || 0,
          steam: report.steamAuth?.status || "unknown",
        }), report.summary?.status === "ok" ? "ok" : "warn");
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      } finally {
        diagnoseModsBtn.disabled = false;
      }
    });

    backupBeforeModsBtn.addEventListener("click", async () => {
      setMessage(modsMessage, t("mods.creatingBackup"));
      try {
        const result = await request("/api/saves/backup", { method: "POST", body: "{}" });
        await reloadSaveManagement();
        setMessage(modsMessage, t("mods.backupCreated", { archive: result.archive }), "ok");
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      }
    });

    async function performModSearch() {
      const query = modSearchInput.value.trim();
      if (!query) {
        setMessage(modsMessage, t("mods.enterQuery"), "bad");
        return;
      }
      searchModsBtn.disabled = true;
      setMessage(modsMessage, t("mods.searching"));
      try {
        const result = await request("/api/mods/search", {
          method: "POST",
          body: JSON.stringify({ query }),
        });
        latestModSearchQuery = query;
        latestModSearchResults = result.results || [];
        renderModSearchResults();
        setMessage(modsMessage, t("mods.searchDone", { count: latestModSearchResults.length }), "ok");
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      } finally {
        searchModsBtn.disabled = false;
      }
    }

    searchModsBtn.addEventListener("click", () => {
      performModSearch().catch((error) => setMessage(modsMessage, error.message, "bad"));
    });
    installModUrlBtn.addEventListener("click", () => {
      openInstallModDialog({ displayName: modSearchInput.value.trim() });
    });
    installModLocalBtn.addEventListener("click", () => {
      openInstallModLocalDialog({ displayName: modSearchInput.value.trim() });
    });
    modSearchInput.addEventListener("input", () => {
      if (latestModManagement) renderModManagement(latestModManagement);
    });
    modSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        performModSearch().catch((error) => setMessage(modsMessage, error.message, "bad"));
      }
    });

    modManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "open-mod-url") {
          const url = safeExternalUrl(button.dataset.url);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        if (action === "install-mod") {
          openInstallModDialog({
            displayName: button.dataset.name || modSearchInput.value.trim(),
            sourceUrl: button.dataset.sourceUrl || "",
            nexusId: button.dataset.nexusId || "",
          });
          return;
        }

        if (action === "install-nexus-file") {
          const nexusId = installModForm.elements.nexusId.value;
          const fileId = button.dataset.fileId;
          const displayName = button.dataset.fileName || installModForm.elements.displayName.value;
          if (!nexusId || !fileId) {
            setMessage(installModMessage, t("mods.missingNexusFile"), "bad");
            return;
          }
          button.disabled = true;
          setMessage(installModMessage, t("mods.installingNexus"));
          try {
            const result = await request("/api/mods/nexus/install", {
              method: "POST",
              body: JSON.stringify({ nexusId, fileId, displayName }),
            });
            latestModSearchQuery = "";
            latestModSearchResults = [];
            await reloadModManagement();
            closeInstallModDialog();
            const names = (result.installed || []).map((mod) => mod.name || mod.directoryName).join(", ");
            setMessage(modsMessage, preferServerMessage(result.message, t("mods.installedRestart")) + (names ? t("mods.installedNames", { names }) : ""), "ok");
          } catch (error) {
            setMessage(installModMessage, error.message, "bad");
          } finally {
            button.disabled = false;
          }
          return;
        }

        if (action === "edit-mod-config") {
          await openModConfigDialog(button.dataset.directory, button.dataset.name);
          return;
        }

        if (action === "delete-mod") {
          const directoryName = button.dataset.directory;
          const label = button.dataset.name || directoryName;
          if (!confirm(t("mods.confirmDelete", { name: label }))) return;
          setMessage(modsMessage, t("mods.deleting"));
          const result = await request("/api/mods/delete", {
            method: "POST",
            body: JSON.stringify({ directoryName }),
          });
          await reloadModManagement();
          setMessage(modsMessage, preferServerMessage(result.message, t("mods.deletedRestart")), "ok");
        }
      } catch (error) {
        setMessage(modsMessage, error.message, "bad");
      }
    });

    openInstallSourceBtn.addEventListener("click", () => {
      const sourceUrl = safeExternalUrl(installModForm.elements.sourceUrl.value);
      if (sourceUrl) window.open(sourceUrl, "_blank", "noopener,noreferrer");
    });
    cancelInstallModBtn.addEventListener("click", closeInstallModDialog);
    installModDialog.addEventListener("click", (event) => {
      if (event.target === installModDialog) closeInstallModDialog();
    });
    cancelInstallModLocalBtn.addEventListener("click", closeInstallModLocalDialog);
    installModLocalDialog.addEventListener("click", (event) => {
      if (event.target === installModLocalDialog) closeInstallModLocalDialog();
    });
    cancelModConfigBtn.addEventListener("click", closeModConfigDialog);
    modConfigDialog.addEventListener("click", (event) => {
      if (event.target === modConfigDialog) closeModConfigDialog();
    });
    formatModConfigBtn.addEventListener("click", () => {
      try {
        modConfigForm.elements.text.value = formatJsonText(modConfigForm.elements.text.value);
        setMessage(modConfigMessage, t("modConfig.formatted"), "ok");
      } catch (error) {
        setMessage(modConfigMessage, t("modConfig.jsonError", { message: error.message }), "bad");
      }
    });
    installModForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = installModForm.elements;
      const url = form.url.value.trim();
      if (!url) {
        setMessage(installModMessage, t("mods.needUrl"), "bad");
        return;
      }

      setFormSubmitDisabled(installModForm, true);
      setMessage(installModMessage, t("mods.installingUrl"));
      try {
        const result = await request("/api/mods/install", {
          method: "POST",
          body: JSON.stringify({
            url,
            displayName: form.displayName.value,
          }),
        });
        latestModSearchQuery = "";
        latestModSearchResults = [];
        await reloadModManagement();
        closeInstallModDialog();
        const names = (result.installed || []).map((mod) => mod.name || mod.directoryName).join(", ");
        setMessage(modsMessage, preferServerMessage(result.message, t("mods.installedRestart")) + (names ? t("mods.installedNames", { names }) : ""), "ok");
      } catch (error) {
        setMessage(installModMessage, error.message, "bad");
      } finally {
        setFormSubmitDisabled(installModForm, false);
      }
    });

    modConfigForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = modConfigForm.elements;
      const directoryName = form.directoryName.value;
      const restartAfterSave = event.submitter?.dataset.restartAfterSave === "true";
      let text;
      try {
        text = formatJsonText(form.text.value);
      } catch (error) {
        setMessage(modConfigMessage, t("modConfig.jsonError", { message: error.message }), "bad");
        return;
      }

      setFormSubmitDisabled(modConfigForm, true);
      setMessage(modConfigMessage, t("modConfig.saving"));
      try {
        const result = await request("/api/mods/config", {
          method: "POST",
          body: JSON.stringify({ directoryName, text }),
        });
        form.text.value = result.text || text;
        await reloadModManagement();
        setMessage(modsMessage, t("modConfig.savedList", { backup: result.backupName || "n/a" }), "ok");
        if (!restartAfterSave || !(await restartServerAfterSave(modConfigMessage))) {
          setMessage(modConfigMessage, t("modConfig.savedDialog"), "ok");
        }
      } catch (error) {
        setMessage(modConfigMessage, error.message, "bad");
      } finally {
        setFormSubmitDisabled(modConfigForm, false);
      }
    });

    installModLocalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = installModLocalForm.elements;
      const localZip = form.localZip.files && form.localZip.files[0];
      if (!localZip) {
        setMessage(installModLocalMessage, t("mods.needLocalZip"), "bad");
        return;
      }
      if (!/\.zip$/i.test(localZip.name)) {
        setMessage(installModLocalMessage, t("mods.needZipExt"), "bad");
        return;
      }
      if (localZip.size > modUploadMaxBytes) {
        setMessage(installModLocalMessage, t("mods.localZipTooLarge"), "bad");
        return;
      }

      setFormSubmitDisabled(installModLocalForm, true);
      setMessage(installModLocalMessage, t("mods.uploadingLocal"));
      try {
        const result = await uploadModFile(localZip, form.displayName.value || localZip.name.replace(/\.zip$/i, ""));
        latestModSearchQuery = "";
        latestModSearchResults = [];
        await reloadModManagement();
        closeInstallModLocalDialog();
        const names = (result.installed || []).map((mod) => mod.name || mod.directoryName).join(", ");
        setMessage(modsMessage, preferServerMessage(result.message, t("mods.installedRestart")) + (names ? t("mods.installedNames", { names }) : ""), "ok");
      } catch (error) {
        setMessage(installModLocalMessage, error.message, "bad");
      } finally {
        setFormSubmitDisabled(installModLocalForm, false);
      }
    });

    document.querySelector("#refreshPlayersBtn").addEventListener("click", async () => {
      setMessage(playersMessage, t("players.refreshing"));
      try {
        await reloadPlayerManagement();
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    repairServerApiBtn.addEventListener("click", async () => {
      if (!confirm(t("players.confirmRepairApi"))) return;
      repairServerApiBtn.disabled = true;
      setMessage(playersMessage, t("players.repairingApi"));
      try {
        const result = await request("/api/server-api/repair", { method: "POST" });
        await reloadPlayerManagement();
        setMessage(playersMessage, preferServerMessage(result.message, t("players.repairedApi")), "ok");
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      } finally {
        repairServerApiBtn.disabled = false;
      }
    });

    playerManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "grant-admin") {
          const name = button.dataset.name;
          if (!confirm(t("players.confirmGrantAdmin", { name }))) return;
          setMessage(playersMessage, t("players.grantingAdmin"));
          const result = await request("/api/players/grant-admin", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, preferServerMessage(result.message, t("players.grantedAdmin", { name })), "ok");
          return;
        }

        if (action === "delete-farmhand") {
          const name = button.dataset.name;
          if (!confirm(t("players.confirmDeleteFarmhand", { name }))) return;
          setMessage(playersMessage, t("players.deletingFarmhand"));
          const result = await request("/api/farmhands", {
            method: "DELETE",
            body: JSON.stringify({ name }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, preferServerMessage(result.message, t("players.deletedFarmhand", { name })), "ok");
        }
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    saveBackupPolicyBtn.addEventListener("click", async () => {
      setMessage(savesMessage, t("saves.savingPolicy"));
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
          prunedCount ? t("saves.policySavedPruned", { count: prunedCount }) : t("saves.policySaved"),
          "ok",
        );
        renderBackupPolicy(data);
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshSavesBtn").addEventListener("click", async () => {
      setMessage(savesMessage, t("players.refreshing"));
      try {
        await reloadSaveManagement();
        setMessage(savesMessage, t("saves.refreshed"), "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#createBackupBtn").addEventListener("click", async () => {
      setMessage(savesMessage, t("saves.creatingBackup"));
      try {
        const result = await request("/api/saves/backup", { method: "POST", body: "{}" });
        await reloadSaveManagement();
        setMessage(savesMessage, t("saves.backupCreated", { archive: result.archive }), "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    deleteSelectedBackupsBtn.addEventListener("click", async () => {
      const archives = selectedBackupArchives();
      if (!archives.length) {
        setMessage(savesMessage, t("saves.selectBackup"), "bad");
        return;
      }
      setMessage(savesMessage, t("saves.deletingSelected"));
      try {
        const result = await request("/api/backups/delete", {
          method: "POST",
          body: JSON.stringify({ archives }),
        });
        await reloadSaveManagement();
        setMessage(savesMessage, t("saves.deletedBackups", { archives: (result.deleted || []).join(", ") }), "ok");
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
      setMessage(createMapMessage, t("createMap.running"));
      try {
        let result;
        try {
          result = await submit(false);
        } catch (error) {
          if (error.status !== 409) throw error;
          if (!confirm(t("createMap.confirmForce", { message: error.message }))) return;
          setMessage(createMapMessage, t("createMap.forceRunning"));
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

    cancelEditConfigBtn.addEventListener("click", closeEditConfigDialog);
    editConfigDialog.addEventListener("click", (event) => {
      if (event.target === editConfigDialog) closeEditConfigDialog();
    });

    editConfigForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = editConfigForm.elements;
      const restartAfterSave = event.submitter?.dataset.restartAfterSave === "true";
      const payload = {
        saveName: form.saveName.value,
        farmName: form.farmName.value,
        money: form.money.value,
        year: form.year.value,
        currentSeason: form.currentSeason.value,
        dayOfMonth: form.dayOfMonth.value,
        maxPlayers: form.maxPlayers.value,
        targetCabins: form.targetCabins.value,
      };
      setFormSubmitDisabled(editConfigForm, true);
      setMessage(editConfigMessage, t("saveConfig.saving"));
      try {
        const result = await request("/api/saves/config", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        hasConfig = false;
        await loadAll();
        const backupText = result.preEditBackup ? t("saves.preEditBackup", { backup: result.preEditBackup }) : "";
        let restartText = result.restartRequired ? t("saves.restartRequired") : "";
        if (restartAfterSave && await restartServerAfterSave(savesMessage)) {
          restartText = t("saves.restartDoneSuffix");
        }
        closeEditConfigDialog();
        setMessage(savesMessage, t("saves.configSaved", {
          saveName: result.saveName,
          backup: backupText,
          restart: restartText,
        }), "ok");
      } catch (error) {
        setMessage(editConfigMessage, error.message, "bad");
      } finally {
        setFormSubmitDisabled(editConfigForm, false);
      }
    });

    repairCabinsFromConfigBtn.addEventListener("click", async () => {
      const form = editConfigForm.elements;
      const saveName = form.saveName.value;
      repairCabinsFromConfigBtn.disabled = true;
      try {
        const result = await repairSaveCabinsFromForm(saveName, form.targetCabins.value, editConfigMessage);
        if (!result) return;
        closeEditConfigDialog();
        setMessage(savesMessage, repairSaveCabinsResultText(result), "ok");
      } catch (error) {
        setMessage(editConfigMessage, error.message, "bad");
      } finally {
        repairCabinsFromConfigBtn.disabled = false;
      }
    });

    saveManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "select-save") {
          const saveName = button.dataset.name;
          if (!confirm(t("saves.confirmSelect", { saveName }))) return;
          setMessage(savesMessage, t("saves.selecting"));
          await request("/api/saves/select", {
            method: "POST",
            body: JSON.stringify({ saveName }),
          });
          setMessage(savesMessage, t("saves.selected", { saveName }), "ok");
          return;
        }

        if (action === "edit-config") {
          const saveName = button.dataset.name;
          setMessage(savesMessage, t("saves.readingConfig"));
          try {
            const result = await request("/api/saves/config?saveName=" + encodeURIComponent(saveName));
            openEditConfigDialog(saveName, result);
            setMessage(savesMessage, "");
          } catch (error) {
            setMessage(savesMessage, error.message, "bad");
          }
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

          setMessage(savesMessage, t("saves.deletingSave"));
          let result;
          try {
            result = await submit(false);
          } catch (error) {
            if (error.status !== 409) throw error;
            if (!confirm(t("saves.confirmForceDelete", { message: error.message }))) return;
            setMessage(savesMessage, t("saves.forceDeletingSave"));
            result = await submit(true);
          }

          hasConfig = false;
          await loadAll();
          const restartText = result.restarted
            ? t("saves.restartDoneSuffix")
            : (result.stoppedBecauseNoSaves ? t("saves.noSavesStoppedSuffix") : "");
          setMessage(
            savesMessage,
            t("saves.deletedSave", {
              deleted: result.deleted,
              backup: result.preDeleteBackup,
              restart: restartText,
            }),
            "ok",
          );
          return;
        }

        if (action === "restore-backup") {
          const archive = button.dataset.archive;
          if (!confirm(t("saves.confirmRestore", { archive }))) return;
          setMessage(savesMessage, t("saves.restoring"));
          const result = await request("/api/backups/restore", {
            method: "POST",
            body: JSON.stringify({ archive }),
          });
          hasConfig = false;
          await loadAll();
          setMessage(savesMessage, t("saves.restored", {
            archive: result.restored,
            backup: result.preRestoreBackup,
          }), "ok");
          return;
        }

        if (action === "delete-backup") {
          const archive = button.dataset.archive;
          setMessage(savesMessage, t("saves.deletingBackup"));
          const result = await request("/api/backups/delete", {
            method: "POST",
            body: JSON.stringify({ archives: [archive] }),
          });
          await reloadSaveManagement();
          setMessage(savesMessage, t("saves.deleted", { archives: (result.deleted || [archive]).join(", ") }), "ok");
        }
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    startBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, t("server.starting"));
      try {
        await request("/api/start", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, t("server.startDone"), "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    stopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, t("server.checkingStop"));
      try {
        const status = await request("/api/status");
        renderStatus(status);
        const readiness = status.shutdownReadiness || {};
        const prefix = t("server.stopPrefix");
        const readinessText = shutdownReadinessMessage(readiness);

        if (readiness.mode === "safe-empty") {
          if (!confirm(prefix + t("server.confirmSafeEmpty"))) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, t("server.stopped"), "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "safe-saved") {
          if (!confirm(prefix + t("server.confirmSafeSaved", { message: readiness.lastSaveLine || readinessText }))) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, t("server.stopped"), "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "warn-unsaved") {
          if (!confirm(prefix + t("server.confirmWaitSave", { message: readinessText }))) return;
          const result = await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "after-save" }) });
          setMessage(serverActionMessage, preferServerMessage(result.job?.message, t("server.waitingNextSave")), "warn");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (!confirm(prefix + t("server.confirmForceStop", { message: readinessText }))) return;
        await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now", force: true }) });
        setMessage(serverActionMessage, t("server.forceStopped"), "ok");
        setTimeout(() => loadAll().catch(() => {}), 2000);
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    cancelAutoStopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, t("server.cancelingAutoStop"));
      try {
        const result = await request("/api/stop/cancel", { method: "POST", body: "{}" });
        setMessage(serverActionMessage, preferServerMessage(result.job?.message, t("server.autoStopCanceled")), "ok");
        await loadAll();
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    restartBtn.addEventListener("click", async () => {
      if (!confirm(t("server.confirmRestart"))) return;
      setMessage(serverActionMessage, t("server.restarting"));
      try {
        await request("/api/restart", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, t("server.restartDone"), "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    function goToRequestedLogPage() {
      const requestedPage = Number.parseInt(logPageInput.value, 10);
      const safePage = Number.isInteger(requestedPage)
        ? Math.min(Math.max(requestedPage, 1), logPageState.totalPages)
        : logPageState.page;
      logPageInput.value = String(safePage);
      loadLogPage(safePage);
    }

    loadLogsBtn.addEventListener("click", () => loadLogPage(1));
    firstLogsPageBtn.addEventListener("click", () => loadLogPage(1));
    previousLogsPageBtn.addEventListener("click", () => loadLogPage(Math.max(1, logPageState.page - 1)));
    goToLogsPageBtn.addEventListener("click", goToRequestedLogPage);
    logPageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        goToRequestedLogPage();
      }
    });
    nextLogsPageBtn.addEventListener("click", () => loadLogPage(Math.min(logPageState.totalPages, logPageState.page + 1)));
    lastLogsPageBtn.addEventListener("click", () => loadLogPage(logPageState.totalPages));
    logPageSize.addEventListener("change", () => loadLogPage(1));

    diagnosticsBtn.addEventListener("click", async () => {
      diagnosticsBtn.disabled = true;
      try {
        const report = await request("/api/diagnostics");
        setLogsText(diagnosticsText(report), "diagnostics");
        logPagination.classList.add("hidden");
      } finally {
        diagnosticsBtn.disabled = false;
      }
    });

    copyLogsBtn.addEventListener("click", async () => {
      const text = logsPanel.textContent || "";
      if (!text) return;
      try {
        await copyTextToClipboard(text);
        copyLogsBtn.textContent = t("logs.copied");
        setTimeout(() => {
          copyLogsBtn.textContent = t("logs.copy");
        }, 1600);
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(logsPanel);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copyLogsBtn.textContent = t("logs.selected");
        setTimeout(() => {
          copyLogsBtn.textContent = t("logs.copy");
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
      try {
        await loadAll();
        startBackgroundPolling();
      } catch (_) {
        adminToolbar.classList.add("hidden");
        authPanel.classList.remove("hidden");
      }
    })();
  </script>
</body>
</html>`;

module.exports = { PAGE };
