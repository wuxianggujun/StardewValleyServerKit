using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using HarmonyLib;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;
using StardewValley.Network;

namespace SVSKCrashGuard;

public sealed class ModEntry : Mod
{
    private const string LidgrenServerTypeName = "StardewValley.Network.LidgrenServer";
    private const string SleepReadyCheckId = "sleep";
    private const uint UpdatesPerSecond = 60;

    private static IMonitor? StaticMonitor;

    private ModConfig Config = new();
    private System.Reflection.FieldInfo? HasDedicatedHostField;
    private uint UpdateCount;
    private uint SleepReadyStartedAt;
    private uint LastSleepGuardLogAt;
    private uint LastSleepGuardErrorAt;
    private bool LoggedDedicatedHostFlag;

    public override void Entry(IModHelper helper)
    {
        StaticMonitor = Monitor;
        Config = ReadConfigOrDefault(helper);

        try
        {
            helper.Events.GameLoop.UpdateTicked += OnUpdateTicked;
            helper.ConsoleCommands.Add(
                "svsk_sleep_guard",
                "Checks and nudges the SVSK dedicated-host sleep ready guard. Usage: svsk_sleep_guard [status|force]",
                OnSleepGuardCommand);

            Monitor.Log(
                $"[SVSK Crash Guard] Sleep ready guard is {(Config.EnableSleepGuard ? "enabled" : "disabled")}; force dedicated host flag is {(Config.ForceDedicatedHostFlag ? "enabled" : "disabled")}.",
                LogLevel.Info);
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Failed to register sleep ready guard: {ex}", LogLevel.Error);
        }

        InstallDisconnectGuard();
    }

    private ModConfig ReadConfigOrDefault(IModHelper helper)
    {
        var configPath = Path.Combine(helper.DirectoryPath, "config.json");
        if (!File.Exists(configPath))
        {
            Monitor.Log("[SVSK Crash Guard] config.json not found; using built-in defaults.", LogLevel.Info);
            return new ModConfig();
        }

        try
        {
            return ParseConfig(File.ReadAllText(configPath));
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Failed to read config.json; using defaults. Error: {ex.GetBaseException().Message}", LogLevel.Warn);
            return new ModConfig();
        }
    }

    private static ModConfig ParseConfig(string json)
    {
        var config = new ModConfig();
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return config;
        }

        var root = document.RootElement;
        if (root.TryGetProperty(nameof(ModConfig.EnableSleepGuard), out var enableSleepGuard)
            && enableSleepGuard.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            config.EnableSleepGuard = enableSleepGuard.GetBoolean();
        }

        if (root.TryGetProperty(nameof(ModConfig.ForceDedicatedHostFlag), out var forceDedicatedHostFlag)
            && forceDedicatedHostFlag.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            config.ForceDedicatedHostFlag = forceDedicatedHostFlag.GetBoolean();
        }

        if (root.TryGetProperty(nameof(ModConfig.SleepReadyTimeoutSeconds), out var sleepReadyTimeoutSeconds)
            && sleepReadyTimeoutSeconds.TryGetInt32(out var timeoutSeconds))
        {
            config.SleepReadyTimeoutSeconds = Math.Max(1, timeoutSeconds);
        }

        return config;
    }

    private void InstallDisconnectGuard()
    {
        try
        {
            var harmony = new Harmony(ModManifest.UniqueID);
            var target = FindPlayerDisconnectedTarget();
            if (target == null)
            {
                Monitor.Log(
                    "[SVSK Crash Guard] No playerDisconnected(long) target found; disconnect crash guard is not active.",
                    LogLevel.Error);
                return;
            }

            harmony.Patch(
                original: target,
                finalizer: new HarmonyMethod(typeof(ModEntry), nameof(PlayerDisconnected_Finalizer)));

            Monitor.Log(
                $"[SVSK Crash Guard] Installed disconnect guard on {target.DeclaringType?.FullName}.{target.Name}.",
                LogLevel.Info);
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Failed to install disconnect guard; sleep ready guard will continue. Error: {ex}", LogLevel.Error);
        }
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        try
        {
            OnUpdateTickedCore();
        }
        catch (Exception ex)
        {
            if (LastSleepGuardErrorAt == 0 || UpdateCount - LastSleepGuardErrorAt >= UpdatesPerSecond * 10)
            {
                Monitor.Log($"[SVSK Crash Guard] Sleep ready guard tick failed: {ex.GetBaseException().Message}", LogLevel.Warn);
                LastSleepGuardErrorAt = UpdateCount;
            }
            ResetSleepReadyTracking();
        }
    }

    private void OnUpdateTickedCore()
    {
        if (!Config.EnableSleepGuard)
        {
            return;
        }

        UpdateCount++;
        if (UpdateCount % UpdatesPerSecond != 0)
        {
            return;
        }

        if (!CanGuardHost())
        {
            ResetSleepReadyTracking();
            return;
        }

        EnsureDedicatedHostFlag("tick");
        GuardSleepReadyCheck(force: false);
    }

    private void OnSleepGuardCommand(string command, string[] args)
    {
        try
        {
            var action = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "force";
            if (!CanGuardHost())
            {
                Monitor.Log("[SVSK Crash Guard] Sleep guard is not available until a multiplayer host save is loaded.", LogLevel.Warn);
                return;
            }

            if (action is not "status" and not "force")
            {
                Monitor.Log("[SVSK Crash Guard] Usage: svsk_sleep_guard [status|force]", LogLevel.Info);
                return;
            }

            var beforeDedicatedHost = Game1.HasDedicatedHost;
            if (action == "force")
            {
                EnsureDedicatedHostFlag("command");
                GuardSleepReadyCheck(force: true);
            }

            Monitor.Log(
                $"[SVSK Crash Guard] Sleep guard status: dedicatedHost={beforeDedicatedHost}->{Game1.HasDedicatedHost}, sleepReady={Game1.netReady.GetNumberReady(SleepReadyCheckId)}/{Game1.netReady.GetNumberRequired(SleepReadyCheckId)}, complete={Game1.netReady.IsReady(SleepReadyCheckId)}, location={Game1.currentLocation?.NameOrUniqueName ?? "unknown"}.",
                LogLevel.Info);
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Sleep guard command failed: {ex}", LogLevel.Error);
        }
    }

    private bool CanGuardHost()
    {
        return Context.IsWorldReady
            && Game1.IsMultiplayer
            && Game1.IsMasterGame
            && Game1.player != null
            && Game1.netReady != null
            && Game1.dedicatedServer != null;
    }

    private bool EnsureDedicatedHostFlag(string reason)
    {
        if (!Config.ForceDedicatedHostFlag || Game1.HasDedicatedHost)
        {
            return false;
        }

        try
        {
            HasDedicatedHostField ??= AccessTools.Field(typeof(FarmerTeam), "hasDedicatedHost");
            var netBool = HasDedicatedHostField?.GetValue(Game1.player.team);
            if (netBool == null)
            {
                Monitor.Log("[SVSK Crash Guard] Could not find FarmerTeam.hasDedicatedHost; sleep guard cannot enable dedicated-host automation.", LogLevel.Warn);
                return false;
            }

            var valueProperty = AccessTools.Property(netBool.GetType(), "Value");
            if (valueProperty == null)
            {
                Monitor.Log("[SVSK Crash Guard] Could not find NetBool.Value on FarmerTeam.hasDedicatedHost; sleep guard cannot enable dedicated-host automation.", LogLevel.Warn);
                return false;
            }

            valueProperty.SetValue(netBool, true);
            if (!LoggedDedicatedHostFlag)
            {
                Monitor.Log($"[SVSK Crash Guard] Enabled Stardew dedicated-host automation flag ({reason}).", LogLevel.Info);
                LoggedDedicatedHostFlag = true;
            }
            return true;
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Failed to enable dedicated-host automation flag: {ex.GetBaseException().Message}", LogLevel.Warn);
            return false;
        }
    }

    private void GuardSleepReadyCheck(bool force)
    {
        var ready = Game1.netReady.GetNumberReady(SleepReadyCheckId);
        var required = Game1.netReady.GetNumberRequired(SleepReadyCheckId);
        var complete = Game1.netReady.IsReady(SleepReadyCheckId);
        if (complete || ready <= 0 || required <= 1)
        {
            ResetSleepReadyTracking();
            return;
        }

        if (SleepReadyStartedAt == 0)
        {
            SleepReadyStartedAt = UpdateCount;
        }

        var elapsedSeconds = (int)((UpdateCount - SleepReadyStartedAt) / UpdatesPerSecond);
        var enoughOtherPlayersReady = ready >= required - 1;
        if (!enoughOtherPlayersReady && !force)
        {
            return;
        }

        if (!Game1.HasDedicatedHost)
        {
            EnsureDedicatedHostFlag("sleep-ready");
        }

        if (Game1.IsDedicatedHost)
        {
            try
            {
                Game1.dedicatedServer.Tick();
                TryConfirmActiveSleepDialog();
            }
            catch (Exception ex)
            {
                Monitor.Log($"[SVSK Crash Guard] Dedicated server tick nudge failed: {ex.GetBaseException().Message}", LogLevel.Warn);
            }
        }

        if (force || elapsedSeconds >= Math.Max(1, Config.SleepReadyTimeoutSeconds))
        {
            TryForceHostSleepInBed();
            TryConfirmActiveSleepDialog();
        }

        if (force || UpdateCount - LastSleepGuardLogAt >= UpdatesPerSecond * 10)
        {
            Monitor.Log(
                $"[SVSK Crash Guard] Nudged sleep ready check: ready={ready}/{required}, dedicatedHost={Game1.HasDedicatedHost}, elapsed={elapsedSeconds}s, force={force}.",
                LogLevel.Warn);
            LastSleepGuardLogAt = UpdateCount;
        }
    }

    private static void TryConfirmActiveSleepDialog()
    {
        if (Game1.activeClickableMenu is not ReadyCheckDialog { checkName: SleepReadyCheckId } dialog)
        {
            return;
        }

        Game1.netReady.SetLocalReady(SleepReadyCheckId, ready: true);
        if (Game1.netReady.IsReady(SleepReadyCheckId))
        {
            dialog.confirm();
        }
    }

    private void TryForceHostSleepInBed()
    {
        var method = AccessTools.Method(Game1.dedicatedServer.GetType(), "HostSleepInBed");
        if (method == null)
        {
            return;
        }

        try
        {
            method.Invoke(Game1.dedicatedServer, Array.Empty<object>());
        }
        catch (Exception ex)
        {
            Monitor.Log($"[SVSK Crash Guard] Failed to force host sleep in bed: {ex.GetBaseException().Message}", LogLevel.Warn);
        }
    }

    private void ResetSleepReadyTracking()
    {
        SleepReadyStartedAt = 0;
        LastSleepGuardLogAt = 0;
    }

    private static System.Reflection.MethodInfo? FindPlayerDisconnectedTarget()
    {
        var lidgrenType = AccessTools.TypeByName(LidgrenServerTypeName);
        var target = lidgrenType == null
            ? null
            : AccessTools.Method(lidgrenType, "playerDisconnected", new[] { typeof(long) });

        if (target != null)
        {
            return target;
        }

        StaticMonitor?.Log(
            "[SVSK Crash Guard] LidgrenServer.playerDisconnected(long) not found; falling back to GameServer.playerDisconnected(long).",
            LogLevel.Warn);
        return AccessTools.Method(typeof(GameServer), nameof(GameServer.playerDisconnected), new[] { typeof(long) });
    }

    // Harmony finalizer: only suppress the known duplicate/missing disconnect race.
    private static Exception? PlayerDisconnected_Finalizer(Exception? __exception, object[] __args)
    {
        if (__exception == null)
        {
            return null;
        }

        if (__exception is not KeyNotFoundException)
        {
            return __exception;
        }

        var disconnectee = __args.Length > 0 && __args[0] is long id ? id.ToString() : "unknown";
        StaticMonitor?.Log(
            $"[SVSK Crash Guard] Suppressed missing player disconnect for {disconnectee}: {__exception.Message}",
            LogLevel.Warn);
        return null;
    }

    private sealed class ModConfig
    {
        public bool EnableSleepGuard { get; set; } = true;

        public bool ForceDedicatedHostFlag { get; set; } = true;

        public int SleepReadyTimeoutSeconds { get; set; } = 8;
    }
}
