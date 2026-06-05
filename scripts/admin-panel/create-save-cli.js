#!/usr/bin/env node
"use strict";

const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const path = require("node:path");

const { __cli } = require(path.join(__dirname, "..", "admin-panel.js"));

const EN_FARM_TYPES = new Map([
  [0, "Standard Farm"],
  [1, "Riverland Farm"],
  [2, "Forest Farm"],
  [3, "Hill-top Farm"],
  [4, "Wilderness Farm"],
  [5, "Four Corners Farm"],
  [6, "Beach Farm"],
  [7, "Meadowlands Farm"],
]);

const MESSAGES = {
  zh: {
    usage: `用法:
  node scripts/admin-panel/create-save-cli.js [选项]

选项:
  --farm-name <名称>        农场名称
  --farm-type <0-7>         地图类型
  --starting-cabins <0-9>   初始小屋/农场工槽位
  --max-players <1-10>      最大玩家数
  --profit-margin <值>      收益倍率: 1, 0.75, 0.5, 0.25
  --separate-wallets        分开钱包
  --shared-wallet           共享钱包
  --force                   在线/未就绪时强制创建
  --json                    输出 JSON
  --lang <zh|en>            输出语言
  --help                    显示帮助`,
    title: "创建新农场存档",
    farmName: "农场名称",
    farmType: "地图类型",
    startingCabins: "初始小屋数量",
    maxPlayers: "最大玩家数",
    useDefault: "直接回车使用默认值。",
    creating: "正在调用真实创建流程。这可能需要几分钟，请不要关闭终端。",
    complete: "新农场已创建",
    newSave: "新存档",
    selected: "已设为下次加载",
    restarted: "服务端已重启",
    restartUnverified: "服务端重启已触发，但未能完成 ready 验证",
    cancelled: "已取消。",
    forcePrompt: "当前服务端不适合立即重启。仍然强制创建并重启吗？[y/N]: ",
    error: "创建失败",
    steps: "执行步骤",
    noFarmName: "非交互模式必须提供 --farm-name。",
  },
  en: {
    usage: `Usage:
  node scripts/admin-panel/create-save-cli.js [options]

Options:
  --farm-name <name>        Farm name
  --farm-type <0-7>         Map type
  --starting-cabins <0-9>   Starting cabins / farmhand slots
  --max-players <1-10>      Max players
  --profit-margin <value>   Profit margin: 1, 0.75, 0.5, 0.25
  --separate-wallets        Separate wallets
  --shared-wallet           Shared wallet
  --force                   Force creation when restart readiness blocks it
  --json                    Print JSON
  --lang <zh|en>            Output language
  --help                    Show help`,
    title: "Create New Farm Save",
    farmName: "Farm name",
    farmType: "Map type",
    startingCabins: "Starting cabins",
    maxPlayers: "Max players",
    useDefault: "Press Enter to use the default.",
    creating: "Running the real creation flow. This may take several minutes; keep this terminal open.",
    complete: "New farm created",
    newSave: "New save",
    selected: "Selected for next load",
    restarted: "Server restarted",
    restartUnverified: "Server restart was triggered, but ready verification did not complete",
    cancelled: "Cancelled.",
    forcePrompt: "The server is not ready for an immediate restart. Force-create and restart anyway? [y/N]: ",
    error: "Creation failed",
    steps: "Steps",
    noFarmName: "Non-interactive mode requires --farm-name.",
  },
};

const STEP_LABELS_EN = new Map([
  ["已启用官方小屋生成", "Enabled native cabin generation"],
  ["已保存新地图配置", "Saved new farm configuration"],
  ["已创建执行前备份", "Created pre-run backup"],
  ["已启动服务端", "Started server"],
  ["已停止原服务端", "Stopped previous server"],
  ["已发送官方 newgame 命令", "Sent official newgame command"],
  ["已停止服务端", "Stopped server"],
  ["已重启服务端", "Restarted server"],
  ["已确认新存档生成", "Confirmed new save"],
  ["已自动设为下次加载", "Selected for next load"],
  ["已写入小屋补丁", "Wrote cabin patch"],
  ["小屋补丁无需修改", "Cabin patch not needed"],
  ["已重启并验证服务端", "Restarted and verified server"],
]);

function normalizeLang(value) {
  const lang = String(value || process.env.SVSK_LANG || process.env.LANG || "zh").toLowerCase();
  return lang.startsWith("en") ? "en" : "zh";
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    const setMaybeEquals = (key) => {
      const eq = arg.indexOf("=");
      options[key] = eq === -1 ? next() : arg.slice(eq + 1);
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--separate-wallets") options.separateWallets = true;
    else if (arg === "--shared-wallet") options.separateWallets = false;
    else if (arg === "--farm-name" || arg === "--name" || arg.startsWith("--farm-name=") || arg.startsWith("--name=")) {
      setMaybeEquals("farmName");
    } else if (arg === "--farm-type" || arg === "--type" || arg.startsWith("--farm-type=") || arg.startsWith("--type=")) {
      setMaybeEquals("farmType");
    } else if (arg === "--starting-cabins" || arg === "--cabins" || arg.startsWith("--starting-cabins=") || arg.startsWith("--cabins=")) {
      setMaybeEquals("startingCabins");
    } else if (arg === "--max-players" || arg === "--players" || arg.startsWith("--max-players=") || arg.startsWith("--players=")) {
      setMaybeEquals("maxPlayers");
    } else if (arg === "--profit-margin" || arg.startsWith("--profit-margin=")) {
      setMaybeEquals("profitMargin");
    } else if (arg === "--spawn-monsters-at-night" || arg.startsWith("--spawn-monsters-at-night=")) {
      setMaybeEquals("spawnMonstersAtNight");
    } else if (arg === "--lang" || arg.startsWith("--lang=")) {
      setMaybeEquals("lang");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function intOption(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
}

function numberOption(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : value;
}

function farmTypeLabel(item, lang) {
  return lang === "en" ? EN_FARM_TYPES.get(item.value) || item.label : item.label;
}

async function ask(rl, label, fallback) {
  const suffix = fallback == null || fallback === "" ? "" : ` [${fallback}]`;
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || fallback;
}

async function promptOptions(options, lang, t) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!options.farmName) throw new Error(t.noFarmName);
    return options;
  }

    const rl = readline.createInterface({ input, output });
  try {
    console.log(`\n==> ${t.title}`);
    console.log(`${t.useDefault}\n`);
    options.farmName = options.farmName || await ask(rl, t.farmName, "Junimo");
    console.log("");
    for (const item of __cli.FARM_TYPES) {
      console.log(`${item.value}) ${farmTypeLabel(item, lang)}`);
    }
    options.farmType = options.farmType ?? await ask(rl, t.farmType, "0");
    options.startingCabins = options.startingCabins ?? await ask(rl, t.startingCabins, "1");
    options.maxPlayers = options.maxPlayers ?? await ask(rl, t.maxPlayers, "4");
  } finally {
    rl.close();
  }
  return options;
}

function payloadFromOptions(options) {
  const startingCabins = intOption(options.startingCabins, 1);
  const maxPlayers = intOption(options.maxPlayers, 4);
  return {
    farmName: options.farmName || "Junimo",
    farmType: intOption(options.farmType, 0),
    profitMargin: numberOption(options.profitMargin, 1),
    startingCabins,
    maxPlayers,
    separateWallets: Boolean(options.separateWallets),
    spawnMonstersAtNight: options.spawnMonstersAtNight || "auto",
    force: Boolean(options.force),
  };
}

function stepLabel(step, lang) {
  return lang === "en" ? STEP_LABELS_EN.get(step.label) || step.label : step.label;
}

function makeStepPrinter(lang) {
  return function printStep(step) {
  const detail = step.detail ? ` - ${step.detail}` : "";
    console.log(`  - ${stepLabel(step, lang)}${detail}`);
  };
}

function printSummary(result, t) {
  console.log(`\nOK  ${t.complete}: ${result.farmName}`);
  if (result.newSaveName) console.log(`OK  ${t.newSave}: ${result.newSaveName}`);
  if (result.selectedSaveName) console.log(`OK  ${t.selected}: ${result.selectedSaveName}`);
  if (result.restarted && result.restartVerified !== false) console.log(`OK  ${t.restarted}`);
  if (result.restarted && result.restartVerified === false) console.log(`WARN ${t.restartUnverified}`);
}

async function runCreate(options, lang, t) {
  await __cli.ensureAdminFiles();
  const payload = payloadFromOptions(options);
  if (!options.json) {
    console.log(`\n==> ${t.creating}`);
    payload.onStep = makeStepPrinter(lang);
  }
  return __cli.createNewGame(payload);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lang = normalizeLang(options.lang);
  const t = MESSAGES[lang];

  if (options.help) {
    console.log(t.usage);
    return;
  }

  await promptOptions(options, lang, t);
  let result;
  try {
    result = await runCreate(options, lang, t);
  } catch (error) {
    if (error && error.status === 409 && !options.force && process.stdin.isTTY && process.stdout.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(t.forcePrompt);
        if (!/^(y|yes)$/i.test(answer.trim())) {
          console.log(t.cancelled);
          process.exitCode = 1;
          return;
        }
        options.force = true;
      } finally {
        rl.close();
      }
      result = await runCreate(options, lang, t);
    } else {
      throw error;
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSummary(result, t);
  }
}

if (require.main === module) {
  main().catch((error) => {
    const lang = normalizeLang(process.env.SVSK_LANG);
    const t = MESSAGES[lang];
    console.error(`ERROR: ${t.error}: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  payloadFromOptions,
  normalizeLang,
};
