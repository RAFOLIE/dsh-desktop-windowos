import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { ArrowLeft, Settings2, Palette, Monitor, Download, ScrollText, Search, X, Copy, FolderOpen, RefreshCw, ChevronUp, ChevronDown, Ellipsis, type IconNode } from "lucide";
import BackendUpdate from "./BackendUpdate";
import { compare, valid } from "semver";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import Appearance from "./Appearance";
import type { UiTheme } from "./theme";
import { appearanceText } from "./appearanceI18n";
import { LANG_NATIVE, zh, useI18n, type LocalePref, type T } from "./i18n";

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
type Tab = "env" | "log" | "update" | "settings" | "appearance";

const TABS: { id: Tab; labelKey: Parameters<T>[0]; icon: IconNode; group: "preferences" | "application"; keywords: Parameters<T>[0][] }[] = [
  { id: "settings", labelKey: "panel.general", icon: Settings2, group: "preferences", keywords: ["set.language", "set.alwaysOnTop", "set.alwaysOnTopDesc", "set.autostart", "set.autostartDesc", "set.closeAction", "set.closeActionHelp", "set.rememberTab", "set.rememberTabDesc"] },
  { id: "appearance", labelKey: "set.groupAppearance", icon: Palette, group: "preferences", keywords: ["set.theme", "set.themeDesc", "set.themeSystem", "set.themeDark", "set.themeLight"] },
  { id: "env", labelKey: "tab.env", icon: Monitor, group: "application", keywords: ["env.secRuntime", "env.secCore", "env.secVersions", "env.secStorage"] },
  { id: "update", labelKey: "tab.update", icon: Download, group: "application", keywords: ["upd.autoUpdate", "upd.channelTitle", "upd.channelHelpApp", "upd.channelHelpBackend"] },
  { id: "log", labelKey: "tab.log", icon: ScrollText, group: "application", keywords: ["log.copyAll", "log.pauseAuto", "log.clearDisplay"] },
];

function PanelIcon({ icon, size = 19 }: { icon: IconNode; size?: number }) {
  return <MorphIcon icon={icon} size={size} strokeWidth={1.7} reducedMotion="user" />;
}

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

const CopyIcon = <PanelIcon icon={Copy} size={16} />;
const FolderIcon = <PanelIcon icon={FolderOpen} size={16} />;

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
      <div title={shown} className={`ep-row-value${mono ? " mono" : ""}${absent ? " absent" : ""}`}>{shown}</div>
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

function verCmp(a: string, b: string): number {
  return valid(a) && valid(b) ? compare(a, b) : 0;
}

export type ChannelOption = { id: string; title: string; desc: string; /** Hidden search aliases (e.g. English names). */ keywords?: string };

/** Comfy-style channel dropdown shared by BOTH update cards: anchored
 *  trigger button + two-line options rendered via portal to body with fixed
 *  anchor — immune to panel scroll-container clipping. Scroll/resize/
 *  outside-click dismiss it; clicks inside don't. */
export function ChannelPicker({
  value,
  onChange,
  options,
  disabled,
  hideDesc,
  searchable,
  searchPlaceholder,
  emptyText,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ChannelOption[];
  disabled?: boolean;
  /** Collapse the helper line under the trigger (compact rows, e.g. language). */
  hideDesc?: boolean;
  /** Render a filter box pinned to the menu top (for long option lists). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the query matches nothing — never dead-end the list. */
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    setOpen((o) => {
      if (o) setQuery("");
      if (!o && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ left: r.left, top: r.bottom + 6, width: r.width });
      }
      return !o;
    });
  };

  useEffect(() => {
    if (!open) return;
    // Autofocus the filter box so typing starts immediately.
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Scroll-to-close ignores scrolls inside the menu itself: with enough
    // options (the 7-entry language list) the menu overflows and MUST
    // scroll — a capture-phase listener would otherwise close on it.
    const onScroll = (event: Event) => {
      const t = event.target;
      if (t instanceof Element && t.closest(".ep-select-menu")) return;
      setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      const t = event.target as HTMLElement;
      if (!t.closest(".ep-select-menu") && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered =
    q === ""
      ? options
      : options.filter(o =>
          [o.title, o.desc, o.id, o.keywords].some(
            v => v !== undefined && v.toLowerCase().includes(q),
          ),
        );

  const sel = options.find((o) => o.id === value) ?? options[0];

  const pickFirst = () => {
    if (filtered.length > 0) {
      onChange(filtered[0].id);
      setOpen(false);
      btnRef.current?.focus();
    }
  };

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
        onKeyDown={event => {
          if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          if (event.key === "ArrowDown") { event.preventDefault(); if (!open) toggle(); else document.querySelector<HTMLButtonElement>(".ep-select-option")?.focus(); }
        }}
      >
        {sel.title}
        <PanelIcon icon={open ? ChevronUp : ChevronDown} size={15} />
      </button>
      {!hideDesc && <div className="ep-select-desc-below">{sel.desc}</div>}
      {open &&
        pos !== null &&
        createPortal(
          <div
            className="ep-select-menu"
            onKeyDown={event => {
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".ep-select-option"));
                const index = options.indexOf(document.activeElement as HTMLButtonElement);
                options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1) + options.length) % options.length]?.focus();
              }
            }}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 3000,
            }}
          >
            {searchable && (
              <input
                ref={searchRef}
                className="ep-select-search"
                placeholder={searchPlaceholder}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    pickFirst();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    btnRef.current?.focus();
                  }
                }}
              />
            )}
            {filtered.map(o => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={value === o.id}
                className={`ep-select-option${value === o.id ? " selected" : ""}`}
                onClick={() => { onChange(o.id); setOpen(false); btnRef.current?.focus(); }}
              >
                <span className="ep-select-title">{o.title}</span>
                <span className="ep-select-desc">{o.desc}</span>
                {value === o.id && (
                  <svg className="ep-select-check" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2.5 7.5 6 11 11.5 4" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
                  </svg>
                )}
              </button>
            ))}
            {filtered.length === 0 && emptyText !== undefined && (
              <div className="ep-select-empty">{emptyText}</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

const appChannels = (t: T): ChannelOption[] => [
  { id: "stable", title: t("upd.achStableTitle"), desc: t("upd.achStableDesc") },
  { id: "dev", title: t("upd.achDevTitle"), desc: t("upd.achDevDesc") },
];

/** 更新 tab, Comfy-Desktop-style: big heading + facts card + a channel
 *  selector (stable/rc) with copy-and-update / update-now actions. */
function UpdateTab({
  info,
  onBackendUpgraded,
}: {
  info: EnvInfo | null;
  onBackendUpgraded: () => void;
}) {
  const [appRel, setAppRel] = useState<{ latest?: string; checkedAt?: string } | null>(null);
  const [appRelSrc, setAppRelSrc] = useState<"stable" | "dev">("stable");
  const [checkingApp, setCheckingApp] = useState(false);
  const [appUpdating, setAppUpdating] = useState(false);
  const [cfg, setCfg] = useState<{ channel: "stable" | "dev"; autoUpdate: boolean } | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const { t } = useI18n();

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


  return (
    <div className="ep-content-inner">
      <BackendUpdate onChanged={onBackendUpgraded} />

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
        <div className="ep-card ep-channel-card ep-update-choice">
          <div className="ep-channel-title">
            {t("upd.channelTitle")}
            <span className="ep-row-description">{t("upd.channelHelpApp")}</span>
          </div>
          <ChannelPicker
            value={cfg?.channel ?? "stable"}
            onChange={(id) => saveCfg({ channel: id as "stable" | "dev" })}
            options={appChannels(t)}
            disabled={cfg === null || savingCfg}
          />
          <div className="ep-upgrade-row ep-auto-update-row">
            <div className="ep-row-label">{t("upd.autoUpdate")}<span className="ep-row-description">
              {cfg?.autoUpdate === false ? t("upd.autoOff") : t("upd.autoOn")}
            </span></div>
            <button
              type="button"
              className={`ep-switch${cfg?.autoUpdate ? " on" : ""}`}
              role="switch"
              aria-checked={cfg?.autoUpdate ?? true}
              aria-label={t("upd.autoUpdate")}
              disabled={cfg === null || savingCfg}
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

/** Boolean preference: name and description on the left, switch on the right. */
function PrefRow({
  label,
  help,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  /** Supporting text appears below the preference name. */
  help?: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="ep-row">
      <div className="ep-row-label">
        {label}
        {help && <span className="ep-row-description">{help}</span>}
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
  const { t, locale, localePref, setLocale } = useI18n();
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
    <div className="ep-content-inner ep-preferences">
      {currentTab === "settings" && <section className="ep-group">
        <div className="ep-group-title">{t("panel.general")}</div>
        <div className="ep-card">
          <div className="ep-row">
            <div className="ep-row-label">
              {t("set.language")}
              <span className="ep-row-description">{t("set.langSystemDesc", { name: LANG_NATIVE[locale] })}</span>
            </div>
            <div className="ep-row-value" />
            <div className="ep-row-actions">
              {/* Dropdown so future locales are one option away; names stay
                  in their own language by convention. "system" follows the
                  Windows display language (resolved Rust-side). */}
              <div className="ep-select-wrap" style={{ width: 150, margin: 0 }}>
                <ChannelPicker
                  value={localePref}
                  onChange={(l) => setLocale(l as LocalePref)}
                  options={[
                    { id: "system", title: t("set.langSystem"), desc: "", keywords: "follow system auto detect" },
                    { id: "zh", title: LANG_NATIVE.zh, desc: "", keywords: "chinese simplified 中文" },
                    { id: "zh-Hant", title: LANG_NATIVE["zh-Hant"], desc: "", keywords: "chinese traditional 繁體" },
                    { id: "en", title: LANG_NATIVE.en, desc: "", keywords: "english" },
                    { id: "ja", title: LANG_NATIVE.ja, desc: "", keywords: "japanese" },
                    { id: "ko", title: LANG_NATIVE.ko, desc: "", keywords: "korean" },
                    { id: "ru", title: LANG_NATIVE.ru, desc: "", keywords: "russian" },
                  ]}
                  searchable
                  searchPlaceholder={t("set.langSearchPlaceholder")}
                  emptyText={t("set.langNoMatch")}
                  hideDesc
                />
              </div>
            </div>
          </div>
        </div>
      </section>}

      {currentTab === "settings" && <><section className="ep-group">
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
          <div className="ep-row">
            <div className="ep-row-label">{t("set.closeAction")}<span className="ep-row-description">{t("set.closeActionHelp")}</span></div>
            <div className="ep-row-value" />
            <div className="ep-row-actions"><ChannelPicker value={cfg?.closeAction ?? "tray"} onChange={saveClose} options={closeActions(t)} disabled={cfg === null} hideDesc /></div>
          </div>
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
      </section></>}
    </div>
  );
}

/** Full settings workspace; the underlying chat remains mounted. */
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
  // The capsule remembers the last page; explicit tray/log entries keep their destination.
  const loadInitialTab = (): Tab => {
    if (initialTab === "settings" && localStorage.getItem("epRememberTab") !== "0") {
      const last = localStorage.getItem("epLastTab");
      if (last !== null && TAB_IDS.includes(last)) return last as Tab;
    }
    return initialTab;
  };
  const [tab, setTabState] = useState<Tab>(loadInitialTab);
  const switchTab = (t: Tab) => {
    setTabState(t);
    setMoreOpen(false);
    setRestartMenuOpen(false);
    if (localStorage.getItem("epRememberTab") !== "0") localStorage.setItem("epLastTab", t);
  };
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [restartMenuOpen, setRestartMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);

  // Esc closes; focus starts in the search box (spec: keyboard support).
  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab" && !document.querySelector(".ep-select-menu")) {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  // Dismiss the 更多 dropdown on outside clicks.
  useEffect(() => {
    if (!moreOpen && !restartMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      const inMore = moreRef.current?.contains(event.target as Node) ?? false;
      const inRestart = restartRef.current?.contains(event.target as Node) ?? false;
      if (!inMore) setMoreOpen(false);
      if (!inRestart) setRestartMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [moreOpen, restartMenuOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const { t, locale } = useI18n();
  const copy = useCallback(
    (text: string, note?: string) => {
      navigator.clipboard.writeText(text).then(() => setToast(note ?? t("common.copied"))).catch(() => setToast(t("panel.copyFailed")));
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

  const searchResults = q ? TABS.flatMap(item => {
    const keys = item.id === "env" ? (Object.keys(zh) as Parameters<T>[0][]).filter(key => key.startsWith("env.") && !key.includes("Hint") && !key.includes("Placeholder")) : item.keywords;
    const candidates = [t(item.labelKey), ...keys.map(key => t(key))];
    if (item.id === "appearance") candidates.push(...Object.values(appearanceText(locale)).filter(value => value.length < 45));
    if (item.id === "env" && info) {
      const facts: [string, string | null | undefined][] = [
        [t("env.backendVersion"), info.dsh?.webVersion], ["Node.js", info.node?.version],
        [t("env.profileDir"), info.profileDir], [t("env.workDir"), info.workspaceDir],
        [t("env.logDir"), info.logDir], [t("env.customPath"), info.dsh?.customPath],
        ["dsh-desktop-plugin", info.plugins?.dshDesktopPlugin],
      ];
      candidates.push(...facts.filter(([, value]) => value).map(([label, value]) => label + " · " + value));
    }
    return [...new Set(candidates)].filter(label => label.toLowerCase().includes(q)).slice(0, 8).map(label => ({ tab: item, label }));
  }) : [];

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
        ref={dialogRef}
        className="ep-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("panel.dialogAria")}

      >
        <aside className="ep-sidebar">
          <button type="button" className="ep-back" onClick={onClose}><PanelIcon icon={ArrowLeft} /><span>{t("panel.back")}</span></button>
          <div className="ep-search">
            <PanelIcon icon={Search} size={17} />
            <input ref={searchRef} value={query} placeholder={t("panel.search")} aria-label={t("panel.search")} onChange={(event) => setQuery(event.target.value)} />
            {query && <button type="button" className="ep-icon-btn" aria-label={t("log.clearDisplay")} onClick={() => setQuery("")}><PanelIcon icon={X} size={15} /></button>}
          </div>
          <nav className="ep-nav" aria-label={t("panel.dialogAria")}>
            {(["preferences", "application"] as const).map(group => <div className="ep-nav-group" key={group}>
              <div className="ep-nav-heading">{t(group === "preferences" ? "panel.preferences" : "panel.application")}</div>
              {TABS.filter(item => item.group === group).map(item => <button key={item.id} type="button" className={'ep-tab' + (tab === item.id && !q ? ' active' : '')} aria-current={tab === item.id && !q ? "page" : undefined} onClick={() => { setQuery(""); switchTab(item.id); }}><PanelIcon icon={item.icon} /><span>{t(item.labelKey)}</span></button>)}
            </div>)}
          </nav>
          <div className="ep-sidebar-brand"><PanelIcon icon={Monitor} size={17} /><div>DSH Desktop<span>v{info?.app?.version ?? "—"}</span></div></div>
        </aside>
        <div className="ep-body">
          <div className="ep-detail">
            <div className="ep-content" key={q ? "search" : tab}>
              <header className="ep-page-heading"><h1>{q ? t("panel.results") : t(TABS.find(item => item.id === tab)!.labelKey)}</h1><p>{q ? t("panel.searchHint") : t(tab === "settings" ? "panel.generalDesc" : tab === "appearance" ? "panel.appearanceDesc" : tab === "env" ? "panel.envDesc" : tab === "update" ? "panel.updateDesc" : "panel.logDesc")}</p></header>
              {q && <div className="ep-search-results">{searchResults.length ? searchResults.map((result, index) => <button className="ep-search-result" key={result.tab.id + index} onClick={() => { setQuery(""); switchTab(result.tab.id); }}><PanelIcon icon={result.tab.icon} /><span><strong>{result.label}</strong><small>{t(result.tab.labelKey)}</small></span><PanelIcon icon={ArrowLeft} size={16} /></button>) : <div className="ep-empty">{t("panel.noResults")}</div>}</div>}
              {!q && <>

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
                  onBackendUpgraded={onRefresh}
                />
              )}
              {tab === "settings" && <SettingsTab currentTab={tab} />}
              {tab === "appearance" && <Appearance />}
              </> }
            </div>
          </div>

        {/* Context actions belong to environment and logs. */}
        {!q && (tab === "env" || tab === "log") && <div className="ep-bottom">
          <button type="button" className="ep-secondary" disabled={refreshing} onClick={onRefresh}>
            <PanelIcon icon={RefreshCw} size={16} />{refreshing ? t("common.checking") : t("panel.refreshCheck")}
          </button>
          <div className="ep-split" ref={restartRef}>
            <button type="button" className="ep-primary ep-split-main" onClick={restart}>
              <PanelIcon icon={RefreshCw} size={16} />{t("panel.restartBackend")}
            </button>
            <button
              type="button"
              className="ep-primary ep-split-caret"
              aria-haspopup="menu"
              aria-expanded={restartMenuOpen}
              title={t("panel.moreRestarts")}
              onClick={() => setRestartMenuOpen((o) => !o)}
            >
              <PanelIcon icon={restartMenuOpen || moreOpen ? ChevronDown : ChevronUp} size={15} />
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
                <PanelIcon icon={Ellipsis} size={17} />{t("panel.more")}
              </button>
              <button
                type="button"
                className="ep-secondary ep-split-caret"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <PanelIcon icon={restartMenuOpen || moreOpen ? ChevronDown : ChevronUp} size={15} />
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
        </div>}
        </div>

        <Toast message={toast} />
      </div>
    </div>
  );
}
