using System;
using System.Collections.Generic;
using HarmonyLib;
using StardewModdingAPI;
using StardewValley.Network;

namespace SVSKCrashGuard;

public sealed class ModEntry : Mod
{
    private const string LidgrenServerTypeName = "StardewValley.Network.LidgrenServer";
    private static IMonitor? StaticMonitor;

    public override void Entry(IModHelper helper)
    {
        StaticMonitor = Monitor;

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
}
