import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { applySkin, type UiTheme } from "./theme";
import { useI18n, type Locale, type T } from "./i18n";

/** Rust-side env_info payload (all fields nullable — probes degrade). */
export type EnvInfo = {
  app?: { version?: string; installDir?: string };
  dsh?: {
    portAnswering?: boolean;
    webVersion?: string | null;
    owner?: { pid?: number; cmd?: string; chain?: string; owned?: boolean } | null;
    dshCmd?: string | null;
    dshCwd?: string | null;
    customPath?: string | null;
    whereDsh?: string | null;
    localInstall?: { shim?: string; root?: string } | null;
    preferNpx?: boolean;
  };
  node?: { path?: string | null; version?: string | null };
  plugins?: { dshDesktopPlugin?: string | null; dshmarket?: string | null };
  profileDir?: string;
  logDir?: string | null;
  workspaceDir?: string | null;
  cacheDir?: string | null;
  profileSizeBytes?: number | null;
  logTail?: string[];
};

/** Which detail tab is active. */
type Tab = "env" | "log" | "update" | "settings";

const TABS: { id: Tab; labelKey: Parameters<T>["0"] }[] = [
  { id: "env", labelKey: "tab.env" },
  { id: "log", labelKey: "tab.log" },
  { id: "update", labelKey: "tab.update" },
  { id: "settings", labelKey: "tab.settings" },
];

const TAB_IDS: readonly string[] = TABS.map((t) => t.id);

function formatBytes(bytes: number | null | undefined, notDetected: string): string {
  if (bytes === null || bytes === undefined) return notDetected;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** Small self-dismissing toast ("已复制" style); never blocks anything. */
function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="ep-toast">{message}</div>;
}

/** 30px icon button (copy / open dir), weak by default, framed on hover. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="ep-icon-btn"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const CopyIcon = (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M9.5 2.5h-6a1 1 0 0 0-1 1v6" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const FolderIcon = (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M1.5 4a1 1 0 0 1 1-1h3l1.2 1.5H11.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);

/** One field row inside a section card: name / value / action icons. */
function FieldRow({
  label,
  value,
  mono,
  openable,
  onCopy,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  openable?: boolean;
  onCopy: (text: string) => void;
}) {
  const { t } = useI18n();
  const shown = value === null || value === undefined || value === "" ? t("common.notDetected") : value;
  const absent = shown === t("common.notDetected");
  return (
    <div className="ep-row">
      <div className="ep-row-label">{label}</div>
      <div className={`ep-row-value${mono ? " mono" : ""}${absent ? " absent" : ""}`}>{shown}</div>
      <div className="ep-row-actions">
        {!absent && (
          <IconButton label={t("common.copy")} onClick={() => onCopy(shown)}>
            {CopyIcon}
          </IconButton>
        )}
        {!absent && openable && (
          <IconButton
            label={t("common.openDir")}
            onClick={() => invoke("open_path", { path: shown }).catch(() => {})}
          >
            {FolderIcon}
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** Section = main-function title ABOVE one big rounded card wrapping all its
 *  rows, hairline-separated (spec's core visual rule). */
function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ep-group">
      <div className="ep-group-title">{title}</div>
      <div className="ep-card">{children}</div>
    </section>
  );
}

/** Log tab: shell session console with level filters, follow-on-scroll,
 *  clear-display (frontend only) and jump-to-latest. */
function LogViewer({ onCopy }: { onCopy: (text: string, note: string) => void }) {
  const { t } = useI18n();
  const [lines, setLines] = useState<string[] | null>(null);
  const [polling, setPolling] = useState(true);
  const [follow, setFollow] = useState(true);
  const [cleared, setCleared] = useState(false);
  const [levels, setLevels] = useState<Record<"INFO" | "WARN" | "ERROR", boolean>>({
    INFO: true,
    WARN: true,
    ERROR: true,
  });
  const consoleRef = useRef<HTMLPreElement>(null);

  const load = useCallback(() => {
    invoke<string[]>("log_tail", { lines: 400 })
      .then((fresh) => {
        setLines(fresh);
        setCleared(false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [polling, load]);

  // Follow the tail unless the user scrolled up (pause auto-follow only).
  useEffect(() => {
    if (!follow) return;
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, follow, levels]);

  const levelOf = (line: string): "INFO" | "WARN" | "ERROR" | null => {
    const match = line.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(INFO|WARN|ERROR)\]/);
    return (match?.[1] as "INFO" | "WARN" | "ERROR") ?? null;
  };

  const visible = useMemo(() => {
    const source = cleared ? [] : lines ?? [];
    return source.filter((line) => {
      const level = levelOf(line);
      return level === null || levels[level];
    });
  }, [lines, levels, cleared]);

  const lineClass = (line: string): string => {
    if (line.startsWith("**")) return "log-banner";
    if (levelOf(line) === "ERROR") return "log-error";
    if (levelOf(line) === "WARN") return "log-warn";
    return "";
  };

  return (
    <div className="ep-log">
      <div className="ep-log-toolbar">
        {(["INFO", "WARN", "ERROR"] as const).map((level) => (
          <button
            key={level}
            type="button"
            className={`ep-pill ep-pill-sm${levels[level] ? " active" : ""}`}
            aria-pressed={levels[level]}
            onClick={() => setLevels((s) => ({ ...s, [level]: !s[level] }))}
          >
            {level === "WARN" ? "WARNING" : level}
          </button>
        ))}
        <span className="ep-log-spacer" />
        <button type="button" className="ep-tool-btn" onClick={() => setPolling((p) => !p)}>
          {polling ? t("log.pauseAuto") : t("log.resumeAuto")}
        </button>
        <button
          type="button"
          className="ep-tool-btn"
          onClick={() => onCopy((lines ?? []).join("\n"), t("common.copied"))}
        >
          {t("log.copyAll")}
        </button>
        <button type="button" className="ep-tool-btn" onClick={() => setCleared(true)}>
          {t("log.clearDisplay")}
        </button>
        <button
          type="button"
          className="ep-tool-btn"
          onClick={() => {
            setFollow(true);
            const el = consoleRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          {t("log.jumpLatest")}
        </button>
      </div>
      <pre
        ref={consoleRef}
        className="ep-log-console"
        onScroll={(event) => {
          const el = event.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {lines === null && t("log.reading")}
        {lines !== null && visible.length === 0 && (cleared ? t("log.cleared") : t("log.empty"))}
        {visible.map((line, i) => (
          <span key={i} className={lineClass(line)}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

/** Channels payload from dsh_npm_channels. */
type DshChannels = { latest?: string; next?: string | null; checkedAt?: string };

/** "{n} 分钟前"-style relative stamp for the 上次检查 row. */
function relativeStamp(stamp: string | undefined, t: T): string {
  if (!stamp) return "—";
  const then = new Date(stamp.replace(" ", "T")).getTime();
  if (Number.isNaN(then)) return stamp;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("time.hourAgo", { n: hours });
  return t("time.dayAgo", { n: Math.round(hours / 24) });
}

/** Loose numeric semver compare ("1.6.17" vs "v1.6.11") — enough for tags. */
function verCmp(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.+\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

type Channel = "latest" | "next";

export type ChannelOption = { id: string; title: string; desc: string };

/** Comfy-style channel dropdown shared by BOTH update cards: anchored
 *  trigger button + two-line options rendered via portal to body with fixed
 *  anchor — immune to panel scroll-container clipping. Scroll/resize/
 *  outside-click dismiss it; clicks inside don't. */
function ChannelPicker({
  value,
  onChange,
  options,
  disabled,
  hideDesc,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ChannelOption[];
  disabled?: boolean;
  /** Collapse the helper line under the trigger (compact rows, e.g. language). */
  hideDesc?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    setOpen((o) => {
      if (!o && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ left: r.left, top: r.bottom + 6, width: r.width });
      }
      return !o;
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (event: MouseEvent) => {
      const t = event.target as HTMLElement;
      if (!t.closest(".ep-select-menu") && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const sel = options.find((o) => o.id === value) ?? options[0];

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`ep-select${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        {sel.title}
        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      {!hideDesc && <div className="ep-select-desc-below">{sel.desc}</div>}
      {open &&
        pos !== null &&
        createPortal(
          <div
            className="ep-select-menu"
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 3000,
            }}
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={value === o.id}
                className={`ep-select-option${value === o.id ? " selected" : ""}`}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                <span className="ep-select-title">{o.title}</span>
                <span className="ep-select-desc">{o.desc}</span>
                {value === o.id && (
                  <svg className="ep-select-check" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2.5 7.5 6 11 11.5 4" fill="none" stroke="#4c9aff" strokeWidth="1.6" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

const backendChannels = (t: T): ChannelOption[] => [
  { id: "latest", title: t("upd.bchLatestTitle"), desc: t("upd.bchLatestDesc") },
  { id: "next", title: t("upd.bchNextTitle"), desc: t("upd.bchNextDesc") },
];

const appChannels = (t: T): ChannelOption[] => [
  { id: "stable", title: t("upd.achStableTitle"), desc: t("upd.achStableDesc") },
  { id: "dev", title: t("upd.achDevTitle"), desc: t("upd.achDevDesc") },
];

/** 更新 tab, Comfy-Desktop-style: big heading + facts card + a channel
 *  selector (stable/rc) with copy-and-update / update-now actions. */
function UpdateTab({
  info,
  backendVersion,
  onBackendUpgraded,
}: {
  info: EnvInfo | null;
  backendVersion: string;
  onBackendUpgraded: () => void;
}) {
  const [channels, setChannels] = useState<DshChannels | null>(null);
  const [checking, setChecking] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [appRel, setAppRel] = useState<{ latest?: string; checkedAt?: string } | null>(null);
  const [appRelSrc, setAppRelSrc] = useState<"stable" | "dev">("stable");
  const [checkingApp, setCheckingApp] = useState(false);
  const [appUpdating, setAppUpdating] = useState(false);
  const [cfg, setCfg] = useState<{ channel: "stable" | "dev"; autoUpdate: boolean } | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("latest");
  const { t } = useI18n();

  const check = useCallback(() => {
    setChecking(true);
    invoke<DshChannels>("dsh_npm_channels")
      .then(setChannels)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const checkApp = useCallback((chan: "stable" | "dev") => {
    setCheckingApp(true);
    invoke<{ latest?: string; checkedAt?: string }>("app_latest_stable", { channel: chan })
      .then((r) => {
        setAppRel(r);
        setAppRelSrc(chan);
      })
      .catch(() => {})
      .finally(() => setCheckingApp(false));
  }, []);

  useEffect(() => {
    checkApp("stable");
    invoke<{ channel: "stable" | "dev"; autoUpdate: boolean }>("app_get_update_config")
      .then(setCfg)
      .catch(() => {});
  }, [checkApp]);

  // Config arrives async; when dev is configured, refetch that channel's latest.
  useEffect(() => {
    if (cfg?.channel === "dev") checkApp("dev");
  }, [cfg?.channel, checkApp]);

  // Persist a pref change; the new value drives the next startup check.
  const saveCfg = (patch: { channel?: "stable" | "dev"; autoUpdate?: boolean }) => {
    if (!cfg) return;
    const next = {
      channel: patch.channel ?? cfg.channel,
      autoUpdate: patch.autoUpdate ?? cfg.autoUpdate,
    };
    setSavingCfg(true);
    invoke("app_set_update_config", { channel: next.channel, autoUpdate: next.autoUpdate })
      .then(() => {
        setCfg(next);
        if (patch.channel !== undefined && patch.channel !== cfg.channel) checkApp(next.channel);
      })
      .catch(() => {})
      .finally(() => setSavingCfg(false));
  };


  const installed = backendVersion === "" ? null : backendVersion.replace(/^v/, "");
  const hasUpdate = channels?.latest != null && installed != null && !installed.startsWith(channels.latest);
  const target = channel === "latest" ? channels?.latest : channels?.next;
  const installCmd = `npm i -g @deepseek-ai/dsh@${channel}`;



  const upgrade = (alsoCopy: boolean) => {
    const label = channel === "latest" ? t("upd.npmLatest") : t("upd.npmNext");
    if (!window.confirm(t("upd.confirmUpgrade", { label }))) return;
    if (alsoCopy) navigator.clipboard?.writeText(installCmd).catch(() => {});
    setUpgrading(true);
    setNote(null);
    invoke<string>("dsh_backend_upgrade", { channel })
      .then((stamp) => {
        setNote(t("upd.doneNote", { stamp }));
        check();
        onBackendUpgraded();
      })
      .catch(() => setNote(t("upd.failNote")))
      .finally(() => setUpgrading(false));
  };

  return (
    <div className="ep-content-inner">
      <section className="ep-group">
        <div className="ep-version-heading">
          {"DeepSeek Harness "}
          {installed !== null && (
            <span className="ep-version-num">{installed.startsWith("0.1") ? installed : `v${installed}`}</span>
          )}
          {hasUpdate && <span className="ep-badge warn">{t("upd.badgeHasUpdate")}</span>}
        </div>
        <div className="ep-card">
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.installed")}</div>
            <div className="ep-row-value mono">{installed ?? t("common.notDetected")}</div>
            <div className="ep-row-actions" />
          </div>
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.latest")}</div>
            <div className="ep-row-value mono link">{channels?.latest ?? t("common.checking")}</div>
            <div className="ep-row-actions" />
          </div>
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.lastCheck")}</div>
            <div className="ep-row-value">{relativeStamp(channels?.checkedAt, t)}</div>
            <div className="ep-row-actions">
              <button type="button" className="ep-tool-btn" disabled={checking} onClick={check}>
                {checking ? t("common.checking") : t("upd.check")}
              </button>
            </div>
          </div>
        </div>

        <div className="ep-card ep-channel-card">
          <div className="ep-channel-title">
            {t("upd.channelTitle")}
            <span className="ep-help" title={t("upd.channelHelpBackend")}>?</span>
          </div>
          <ChannelPicker value={channel} onChange={(id) => setChannel(id as Channel)} options={backendChannels(t)} />
          <div className="ep-upgrade-row">
            <button type="button" className="ep-secondary" disabled={upgrading || target == null} onClick={() => upgrade(true)}>
              {t("upd.copyAndUpdate")}
            </button>
            <button type="button" className="ep-primary" disabled={upgrading || target == null} onClick={() => upgrade(false)}>
              {upgrading ? t("upd.nowUpdating") : t("upd.updateNow")}
            </button>
          </div>
        </div>

        {note !== null && <div className="detail">{note}</div>}
      </section>

      <section className="ep-group">
        <div className="ep-version-heading">
          {"dsh desktop "}
          {info?.app?.version && <span className="ep-version-num">v{info.app.version}</span>}
          {info?.app?.version && appRel?.latest && verCmp(appRel.latest, info.app.version) > 0 && (
            <span className="ep-badge warn">{t("upd.badgeHasUpdate")}</span>
          )}
        </div>
        <div className="ep-card">
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.installed")}</div>
            <div className="ep-row-value mono">{info?.app?.version ?? t("common.notDetected")}</div>
            <div className="ep-row-actions" />
          </div>
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.latest")}</div>
            <div className={`ep-row-value mono${appRel?.latest ? " link" : ""}`}>
              {appRel?.latest ? (
                <>
                  <span className={`ep-badge ${appRelSrc === "dev" ? "warn" : "ok"}`}>
                    {appRelSrc === "dev" ? t("upd.badgePreview") : t("upd.badgeStable")}
                  </span>
                  {appRel.latest}
                </>
              ) : (
                t("common.checking")
              )}
            </div>
            <div className="ep-row-actions" />
          </div>
          <div className="ep-row">
            <div className="ep-row-label">{t("upd.lastCheck")}</div>
            <div className="ep-row-value">{relativeStamp(appRel?.checkedAt, t)}</div>
            <div className="ep-row-actions">
              <button
                type="button"
                className="ep-tool-btn"
                disabled={checkingApp}
                onClick={() => checkApp(cfg?.channel === "dev" ? "dev" : "stable")}
              >
                {checkingApp ? t("common.checking") : t("upd.check")}
              </button>
            </div>
          </div>
        </div>
        <div className="ep-card ep-channel-card">
          <div className="ep-channel-title">
            {t("upd.channelTitle")}
            <span className="ep-help" title={t("upd.channelHelpApp")}>?</span>
          </div>
          <ChannelPicker
            value={cfg?.channel ?? "stable"}
            onChange={(id) => saveCfg({ channel: id as "stable" | "dev" })}
            options={appChannels(t)}
            disabled={savingCfg}
          />
          <div className="ep-upgrade-row">
            <span className="ep-hint-inline">
              {cfg?.autoUpdate === false ? t("upd.autoOff") : t("upd.autoOn")}
            </span>
            <button
              type="button"
              className={`ep-switch${cfg?.autoUpdate ? " on" : ""}`}
              role="switch"
              aria-checked={cfg?.autoUpdate ?? true}
              aria-label={t("upd.autoUpdate")}
              disabled={savingCfg}
              onClick={() => saveCfg({ autoUpdate: !(cfg?.autoUpdate ?? true) })}
            />
          </div>
        </div>

        <div className="ep-upgrade-row">
          <span className="ep-hint-inline">
            {t("upd.manualHint")}
          </span>
          <button
            type="button"
            className="ep-primary"
            disabled={
              appUpdating ||
              checkingApp ||
              !(
                info?.app?.version &&
                appRel?.latest &&
                verCmp(appRel.latest, info.app.version) > 0
              )
            }
            onClick={() => {
              setAppUpdating(true);
              invoke("dsh_self_update_check")
                .catch(() => {})
                .finally(() => setTimeout(() => setAppUpdating(false), 3000));
            }}
          >
            {appUpdating ? t("common.checking") : t("upd.updateNow")}
          </button>
        </div>
      </section>
    </div>
  );
}

// --- 设置 tab ---

/** Shell prefs served by app_get_shell_settings. */
type ShellSettings = {
  closeAction: "tray" | "exit";
  alwaysOnTop: boolean;
  autostart: boolean;
  uiTheme: UiTheme;
  uiLocale: "zh" | "en";
};

const closeActions = (t: T): ChannelOption[] => [
  { id: "tray", title: t("set.closeTray"), desc: t("set.closeTrayDesc") },
  { id: "exit", title: t("set.closeExit"), desc: t("set.closeExitDesc") },
];

/** One boolean preference row: label(+? hover help) / 开关 (改动即时落盘). */
function PrefRow({
  label,
  help,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  /** Hover hint rendered as a ? beside the label instead of visible text. */
  help?: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="ep-row">
      <div className="ep-row-label">
        {label}
        {help && (
          <span className="ep-help" title={help}>?</span>
        )}
      </div>
      <div className="ep-row-value" />
      <div className="ep-row-actions">
        <button
          type="button"
          className={`ep-switch${active ? " on" : ""}`}
          role="switch"
          aria-checked={active}
          aria-label={label}
          disabled={disabled}
          onClick={onToggle}
        />
      </div>
    </div>
  );
}

/** 设置 tab, Comfy-Desktop-style:窗口行为 + 面板偏好,全部即时保存。
 *  更新通道/自动更新刻意不在此页——归「更新」tab,避免同一配置两处入口。 */
function SettingsTab({ currentTab }: { currentTab: Tab }) {
  const { t, locale, setLocale } = useI18n();
  const [cfg, setCfg] = useState<ShellSettings | null>(null);
  const [rememberTab, setRememberTab] = useState<boolean>(
    () => localStorage.getItem("epRememberTab") !== "0",
  );
  const [busyAutostart, setBusyAutostart] = useState(false);

  useEffect(() => {
    invoke<{
      closeAction?: string;
      alwaysOnTop?: boolean;
      autostart?: boolean;
      uiTheme?: string;
      uiLocale?: string;
    }>("app_get_shell_settings")
      .then((r) => {
        setCfg({
          closeAction: r.closeAction === "exit" ? "exit" : "tray",
          alwaysOnTop: r.alwaysOnTop === true,
          autostart: r.autostart === true,
          uiTheme:
            r.uiTheme === "dark" || r.uiTheme === "light" ? r.uiTheme : "system",
          uiLocale: r.uiLocale === "en" ? "en" : "zh",
        });
      })
      .catch(() => {});
  }, []);

  // 每个 saver 都在命令成功返回后才更新本地 state——写失败就不骗 UI。
  const saveUiTheme = (pref: UiTheme) => {
    invoke("app_set_ui_theme", { theme: pref })
      .then(() => {
        setCfg((c) => (c ? { ...c, uiTheme: pref } : c));
        applySkin(pref);
      })
      .catch(() => {});
  };

  const saveClose = (id: string) => {
    invoke("app_set_close_action", { action: id })
      .then(() => setCfg((c) => (c ? { ...c, closeAction: id === "exit" ? "exit" : "tray" } : c)))
      .catch(() => {});
  };

  const saveAlwaysOnTop = () => {
    if (!cfg) return;
    const next = !cfg.alwaysOnTop;
    invoke("app_set_always_on_top", { enable: next })
      .then(() => setCfg((c) => (c ? { ...c, alwaysOnTop: next } : c)))
      .catch(() => {});
  };

  const saveAutostart = () => {
    if (!cfg) return;
    const next = !cfg.autostart;
    setBusyAutostart(true);
    invoke("app_set_autostart", { enable: next })
      .then(() => setCfg((c) => (c ? { ...c, autostart: next } : c)))
      .catch(() => {})
      .finally(() => setBusyAutostart(false));
  };

  const saveRememberTab = () => {
    const next = !rememberTab;
    localStorage.setItem("epRememberTab", next ? "1" : "0");
    if (next) localStorage.setItem("epLastTab", currentTab);
    setRememberTab(next);
  };

  return (
    <div className="ep-content-inner">
      <section className="ep-group">
        <div className="ep-group-title">{t("set.groupAppearance")}</div>
        <div className="ep-card">
          <div className="ep-row">
            <div className="ep-row-label">
              {t("set.theme")}
              <span className="ep-help" title={t("set.themeDesc")}>?</span>
            </div>
            <div className="ep-row-value" />
            <div className="ep-row-actions">
              <div className="ep-seg" role="radiogroup" aria-label={t("set.theme")}>
                {(["system", "dark", "light"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={cfg?.uiTheme === value}
                    className={`ep-seg-btn${cfg?.uiTheme === value ? " active" : ""}`}
                    disabled={cfg === null}
                    onClick={() => saveUiTheme(value)}
                  >
                    {value === "system" ? t("set.themeSystem") : value === "dark" ? t("set.themeDark") : t("set.themeLight")}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="ep-row">
            <div className="ep-row-label">
              {t("set.language")}
              <span className="ep-help" title={t("set.langDesc")}>?</span>
            </div>
            <div className="ep-row-value" />
            <div className="ep-row-actions">
              {/* Dropdown so future locales are one option away; names stay
                  in their own language by convention. */}
              <div className="ep-select-wrap" style={{ width: 150, margin: 0 }}>
                <ChannelPicker
                  value={locale}
                  onChange={(l) => setLocale(l as Locale)}
                  options={[
                    { id: "zh", title: "中文", desc: "" },
                    { id: "en", title: "English", desc: "" },
                  ]}
                  hideDesc
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ep-group">
        <div className="ep-group-title">{t("set.groupWindow")}</div>
        <div className="ep-card">
          <PrefRow
            label={t("set.alwaysOnTop")}
            help={t("set.alwaysOnTopDesc")}
            active={cfg?.alwaysOnTop ?? false}
            disabled={cfg === null}
            onToggle={saveAlwaysOnTop}
          />
          <PrefRow
            label={t("set.autostart")}
            help={t("set.autostartDesc")}
            active={cfg?.autostart ?? false}
            disabled={cfg === null || busyAutostart}
            onToggle={saveAutostart}
          />
        </div>
        <div className="ep-card ep-channel-card">
          <div className="ep-channel-title">
            {t("set.closeAction")}
            <span className="ep-help" title={t("set.closeActionHelp")}>?</span>
          </div>
          <ChannelPicker
            value={cfg?.closeAction ?? "tray"}
            onChange={saveClose}
            options={closeActions(t)}
            disabled={cfg === null}
          />
        </div>
      </section>

      <section className="ep-group">
        <div className="ep-group-title">{t("set.groupPanel")}</div>
        <div className="ep-card">
          <PrefRow
            label={t("set.rememberTab")}
            help={t("set.rememberTabDesc")}
            active={rememberTab}
            onToggle={saveRememberTab}
          />
        </div>
      </section>
    </div>
  );
}

/** The environment panel: search bar / env+log tabs / grouped fact cards /
 *  bottom action bar. Only real data and real actions. */
export default function EnvPanel({
  initialTab,
  info,
  error,
  refreshing,
  onRefresh,
  onClose,
}: {
  initialTab: Tab;
  info: EnvInfo | null;
  error: string;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  // 初始页签:通用入口(胶囊按钮/托盘环境信息, initialTab==="env")在开启
  // "记住上次页签"时落在记忆页;显式入口(启动页查日志等)永远直落指定页。
  const loadInitialTab = (): Tab => {
    if (initialTab === "env" && localStorage.getItem("epRememberTab") !== "0") {
      const last = localStorage.getItem("epLastTab");
      if (last !== null && TAB_IDS.includes(last)) return last as Tab;
    }
    return initialTab;
  };
  const [tab, setTabState] = useState<Tab>(loadInitialTab);
  const switchTab = (t: Tab) => {
    setTabState(t);
    if (localStorage.getItem("epRememberTab") !== "0") localStorage.setItem("epLastTab", t);
  };
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [restartMenuOpen, setRestartMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);

  // --- resizable dialog width (persisted; clamped) ---
  const MIN_W = 720;
  const DEFAULT_W = MIN_W; // 默认开在最小宽度(720)
  const maxW = () => Math.min(1440, window.innerWidth - 96);
  const clampW = (w: number) => Math.max(MIN_W, Math.min(w, maxW()));
  const loadW = (): number => {
    const raw = Number(localStorage.getItem("epDialogWidth"));
    return Number.isFinite(raw) && raw >= MIN_W ? clampW(raw) : DEFAULT_W;
  };
  const [dialogWidth, setDialogWidth] = useState<number>(loadW);
  const saveW = (w: number) => { localStorage.setItem("epDialogWidth", String(Math.round(w))); };
  const startResize = (edge: "left" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = dialogWidth;
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    let last = startW;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      last = clampW(edge === "right" ? startW + dx : startW - dx);
      setDialogWidth(last);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      saveW(last); // 关键:松手即落盘,重开面板/重启应用都保持
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  // Esc closes; focus starts in the search box (spec: keyboard support).
  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  // Dismiss the 更多 dropdown on outside clicks.
  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (event: MouseEvent) => {
      const inMore = moreRef.current?.contains(event.target as Node) ?? false;
      const inRestart = restartRef.current?.contains(event.target as Node) ?? false;
      if (!inMore) setMoreOpen(false);
      if (!inRestart) setRestartMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const { t } = useI18n();
  const copy = useCallback(
    (text: string, note?: string) => {
      navigator.clipboard?.writeText(text).catch(() => {});
      setToast(note ?? t("common.copied"));
    },
    [t],
  );

  const dsh = info?.dsh;
  const owner = dsh?.owner;
  const running = dsh?.portAnswering === true;

  const q = query.trim().toLowerCase();
  const matches = (label: string, value: string | null | undefined) =>
    q === "" ||
    label.toLowerCase().includes(q) ||
    (value ?? "").toLowerCase().includes(q);

  const exportBundle = () => {
    setMoreOpen(false);
    invoke<{ dir: string; content: string }>("diagnostic_export")
      .then((result) => {
        navigator.clipboard?.writeText(result.content).catch(() => {});
        invoke("open_path", { path: result.dir }).catch(() => {});
        setToast(t("panel.diagExported"));
      })
      .catch(() => setToast(t("panel.diagFailed")));
  };

  const restart = () => {
    if (!window.confirm(t("panel.confirmRestart"))) return;
    invoke("dsh_restart_backend").catch(() => {});
    onClose();
  };

  const statusRow = running ? (
    <span className="ep-status ok">
      <span className="ep-dot ok" />
      运行正常
    </span>
  ) : (
    <span className="ep-status warn">
      <span className="ep-dot warn" />
      无应答
    </span>
  );

  return (
    <div
      className="ep-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ep-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("panel.dialogAria")}
        style={{ width: dialogWidth }}
      >
        {/* edge resize handles: drag to adjust width, double-click resets */}
        <div
          className="ep-resize-handle left"
          title={t("env.resizingHint")}
          onPointerDown={startResize("left")}
          onDoubleClick={() => { setDialogWidth(DEFAULT_W); saveW(DEFAULT_W); }}
        />
        <div
          className="ep-resize-handle right"
          title={t("env.resizingHint")}
          onPointerDown={startResize("right")}
          onDoubleClick={() => { setDialogWidth(DEFAULT_W); saveW(DEFAULT_W); }}
        />
        {/* 1. Search bar */}
        <div className="ep-search">
          <svg className="ep-search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 10 14 14" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            placeholder={t("env.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== "" ? (
            <button type="button" className="ep-icon-btn" title={t("log.clearDisplay")} aria-label={t("log.clearDisplay")} onClick={() => setQuery("")}>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.8 0.8 9.2 9.2 M9.2 0.8 0.8 9.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
          ) : (
            <button type="button" className="ep-icon-btn" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.8 0.8 9.2 9.2 M9.2 0.8 0.8 9.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
          )}
        </div>

        {/* Body: tabs + full-width content (single column) */}
        <div className="ep-body">
          <div className="ep-detail">
            <nav className="ep-nav">
              {TABS.map((tabItem) => (
                <button
                  key={tabItem.id}
                  type="button"
                  className={`ep-tab${tab === tabItem.id ? " active" : ""}`}
                  aria-current={tab === tabItem.id ? "page" : undefined}
                  onClick={() => switchTab(tabItem.id)}
                >
                  {t(tabItem.labelKey)}
                </button>
              ))}
            </nav>

            <div className="ep-content">
              {tab === "env" ? (
                info === null && error === "" ? (
                  <div className="ep-loading">
                    <div className="spinner" aria-hidden="true" />
                    正在采集环境信息…
                  </div>
                ) : (
                  <div className="ep-content-inner">
                    {error !== "" && (
                      <div className="ep-error">
                        检测失败:{error}
                        <button type="button" className="ep-tool-btn" onClick={onRefresh}>
                          重新检测
                        </button>
                      </div>
                    )}
                    {info !== null && (
                      <>
                        <SectionCard title={t("env.secRuntime")}>
                          {matches(t("env.appStatus"), running ? t("env.statusRunning") : t("env.statusNoReply")) && (
                            <div className="ep-row">
                              <div className="ep-row-label">{t("env.appStatus")}</div>
                              <div className="ep-row-value">{statusRow}</div>
                              <div className="ep-row-actions" />
                            </div>
                          )}
                          {matches(t("env.ownerPid"), owner?.pid !== undefined ? String(owner.pid) : null) && (
                            <FieldRow label={t("env.ownerPid")} value={owner?.pid !== undefined ? String(owner.pid) : null} mono onCopy={copy} />
                          )}
                          {matches(t("env.procCmdline"), owner?.cmd) && (
                            <FieldRow label={t("env.procCmdline")} value={owner?.cmd ?? null} mono onCopy={copy} />
                          )}
                          {matches(t("env.ownership"), owner?.owned ? t("env.ownLocal") : t("env.ownExternal")) && (
                            <FieldRow
                              label={t("env.ownership")}
                              value={owner == null ? null : owner.owned ? t("env.ownMonitored") : t("env.ownForeign")}
                              onCopy={copy}
                            />
                          )}
                          {matches(t("env.parentChain"), owner?.chain) && (
                            <FieldRow label={t("env.parentChain")} value={owner?.chain ?? null} mono onCopy={copy} />
                          )}
                        </SectionCard>

                        <SectionCard title={t("env.secCore")}>
                          {matches("where dsh", dsh?.whereDsh) && (
                            <FieldRow label="where dsh" value={dsh?.whereDsh ?? null} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.customPath"), dsh?.customPath) && (
                            <FieldRow label={t("env.customPath")} value={dsh?.customPath ?? null} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.localInstall"), dsh?.localInstall?.shim) && (
                            <FieldRow label={t("env.localInstall")} value={dsh?.localInstall?.shim ?? null} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.dshCmdVar"), dsh?.dshCmd) && (
                            <FieldRow label={t("env.dshCmdVar")} value={dsh?.dshCmd ?? null} mono onCopy={copy} />
                          )}
                          {matches(t("env.dshCwdVar"), dsh?.dshCwd) && (
                            <FieldRow label={t("env.dshCwdVar")} value={dsh?.dshCwd ?? null} mono onCopy={copy} />
                          )}
                          {matches(t("env.npxAuthorized"), dsh?.preferNpx ? t("env.yes") : t("env.no")) && (
                            <FieldRow label={t("env.npxAuthorized")} value={dsh?.preferNpx ? t("env.yes") : t("env.no")} onCopy={copy} />
                          )}
                        </SectionCard>

                        <SectionCard title={t("env.secVersions")}>
                          {matches(t("env.backendVersion"), dsh?.webVersion) && (
                            <FieldRow label={t("env.backendVersion")} value={dsh?.webVersion ?? null} mono onCopy={copy} />
                          )}
                          {matches("dsh-desktop-plugin", info.plugins?.dshDesktopPlugin) && (
                            <FieldRow label="dsh-desktop-plugin" value={info.plugins?.dshDesktopPlugin ?? null} mono onCopy={copy} />
                          )}
                          {matches("dshmarket", info.plugins?.dshmarket) && (
                            <FieldRow label="dshmarket" value={info.plugins?.dshmarket ?? null} mono onCopy={copy} />
                          )}
                          {matches("Node.js", info.node?.version) && (
                            <FieldRow label="Node.js" value={info.node?.version ?? null} mono onCopy={copy} />
                          )}
                          {matches(t("env.dhVersion"), info.app?.version) && (
                            <FieldRow label={t("env.dhVersion")} value={info.app?.version} mono onCopy={copy} />
                          )}
                        </SectionCard>

                        <SectionCard title={t("env.secStorage")}>
                          {matches(t("env.profileDir"), info.profileDir) && (
                            <FieldRow label={t("env.profileDir")} value={info.profileDir} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.workDir"), info.workspaceDir) && (
                            <FieldRow label={t("env.workDir")} value={info.workspaceDir ?? null} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.logDir"), info.logDir) && (
                            <FieldRow label={t("env.logDir")} value={info.logDir ?? null} mono openable onCopy={copy} />
                          )}
                          {matches(t("env.cacheDir"), info.cacheDir) && (
                            <FieldRow label={t("env.cacheDir")} value={info.cacheDir ?? null} mono onCopy={copy} />
                          )}
                          {matches(t("env.diskUsage"), undefined) && (
                            <FieldRow
                              label={t("env.diskUsage")}
                              value={info.profileSizeBytes === null || info.profileSizeBytes === undefined ? null : formatBytes(info.profileSizeBytes, t("common.notDetected"))}
                              onCopy={copy}
                            />
                          )}
                        </SectionCard>
                      </>
                    )}
                  </div>
                )
              ) : null}
              {tab === "log" && <LogViewer onCopy={copy} />}
              {tab === "update" && (
                <UpdateTab
                  info={info}
                  backendVersion={dsh?.webVersion ?? ""}
                  onBackendUpgraded={onRefresh}
                />
              )}
              {tab === "settings" && <SettingsTab currentTab={tab} />}
            </div>
          </div>
        </div>

        {/* 4. Bottom action bar (right-aligned actions only) */}
        <div className="ep-bottom">
          <button type="button" className="ep-secondary" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? t("common.checking") : t("panel.refreshCheck")}
          </button>
          <div className="ep-split" ref={restartRef}>
            <button type="button" className="ep-primary ep-split-main" onClick={restart}>
              {t("panel.restartBackend")}
            </button>
            <button
              type="button"
              className="ep-primary ep-split-caret"
              aria-haspopup="menu"
              aria-expanded={restartMenuOpen}
              title={t("panel.moreRestarts")}
              onClick={() => setRestartMenuOpen((o) => !o)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 6.5 5 2.5 9 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            </button>
            {restartMenuOpen && (
              <div className="ep-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRestartMenuOpen(false);
                    if (!window.confirm(t("panel.confirmFullRestart"))) return;
                    invoke("app_full_restart").catch(() => {});
                  }}
                >
                  {t("panel.fullRestart")}
                </button>
              </div>
            )}
          </div>
          <div className="ep-more" ref={moreRef}>
            <div className="ep-split">
              <button type="button" className="ep-secondary ep-split-main" onClick={() => setMoreOpen((o) => !o)}>
                {t("panel.more")}
              </button>
              <button
                type="button"
                className="ep-secondary ep-split-caret"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 6.5 5 2.5 9 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              </button>
            </div>
              {moreOpen && (
                <div className="ep-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      const dir = info?.dsh?.dshCwd ?? info?.workspaceDir;
                      if (dir) invoke("open_path", { path: dir }).catch(() => {});
                    }}
                  >
                    {t("panel.openWorkDir")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      if (info?.logDir) invoke("open_path", { path: info.logDir }).catch(() => {});
                    }}
                  >
                    {t("panel.openLogDir")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      copy(JSON.stringify(info ?? {}, null, 2), t("panel.envCopied"));
                    }}
                  >
                    {t("panel.copyAllEnv")}
                  </button>
                  <button type="button" role="menuitem" onClick={exportBundle}>
                    {t("panel.exportDiag")}
                  </button>
                </div>
              )}
          </div>
        </div>

        <Toast message={toast} />
      </div>
    </div>
  );
}
