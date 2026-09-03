import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import appIcon from "./assets/app-icon.png";
import EnvPanel, { type EnvInfo } from "./EnvPanel";
import {
  LocaleContext,
  loadLocaleSettings,
  applyHtmlLang,
  guessFromNavigator,
  isLocale,
  makeT,
  useI18n,
  type I18n,
  type Locale,
  type LocalePref,
} from "./i18n";
import { applySkin, loadUiTheme, watchSystemSkin } from "./theme";
import "./App.css";

/** Rust→frontend lifecycle payloads emitted on the `dsh-status` channel. */
type DshStatus =
  | { status: "starting"; method?: string }
  | { status: "ready"; attached: boolean; method?: string }
  | { status: "notfound" }
  | { status: "error"; message: string };

/** Rust→frontend payloads emitted on the `app-update` channel by update.rs.
 *  `pending` is the frontend-only state before the first event arrives. */
type AppUpdate =
  | { state: "pending" }
  | { state: "checking" }
  | { state: "downloading"; from?: string; to?: string }
  | { state: "done"; from?: string; to?: string }
  | { state: "none" }
  | { state: "failed"; message?: string };

const WEBCHAT_URL = "http://127.0.0.1:3080/";
const REGISTRY_OFFICIAL = "https://registry.npmjs.org";
const REGISTRY_MIRROR = "https://registry.npmmirror.com";

/** Rust-side parallel speed probe of the two npm registries (ms, null=unreachable). */
type NpmProbe = { npmjsMs: number | null; npmmirrorMs: number | null; fastest: string | null };

/** Which tab of the environment-manager panel is open; null = closed. */
type Overlay = null | "env" | "log";

/** The persistent shell. The window is undecorated; the app's own title bar
 *  rides on top for the whole session. The webchat loads in a same-site
 *  iframe — the shell never navigates away, so the name button and the
 *  blurred environment-manager panel are always one click away without
 *  losing chat state. Env facts are prefetched at startup so the panel opens
 *  instantly. */
function App() {
  const [status, setStatus] = useState<DshStatus>({ status: "starting" });
  // Locale: paint an instant navigator-based guess, then override with the
  // Rust-resolved locale ("system" = Windows UI language, single source of
  // truth). setLocale persists via app_set_ui_locale (which also rebuilds
  // the tray menu and returns the resolved locale).
  const [locale, setLocaleState] = useState<Locale>(guessFromNavigator());
  const [localePref, setLocalePrefState] = useState<LocalePref>("system");
  const [customPath, setCustomPath] = useState("");
  const [pathError, setPathError] = useState("");
  const [update, setUpdate] = useState<AppUpdate>({ state: "pending" });
  const [checkVisible, setCheckVisible] = useState(false);
  const [npmProbe, setNpmProbe] = useState<NpmProbe | null>(null);
  /** The iframe mounts on the first `ready` and stays mounted for the rest of
   *  the session; boot regressions (restart / crash heal) only hide it. */
  const [webchatMounted, setWebchatMounted] = useState(false);
  /** iframe URL: plain 3080 for legacy dsh; `?token=` appended when the
   *  backend enforces BrowserAuth (issue #10) — refreshed on every ready. */
  const [webchatSrc, setWebchatSrc] = useState(WEBCHAT_URL);
  /** Whether the webchat is on screen (boot/error/update-wait views cover it). */
  const [chatVisible, setChatVisible] = useState(false);
  /** Bumped on every ready *transition* after the first mount — remounts the
   *  iframe so a restarted backend gets a fresh webchat instead of a dead page. */
  const [reloadKey, setReloadKey] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null);
  /** Env facts, prefetched at startup (and re-fetched on ready transitions) so
   *  the panel opens with data already in hand — no per-open loading spin. */
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [envError, setEnvError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Collapse emit_ready's 10× re-emit into transitions: only a fresh
  // starting→ready edge (re)mounts or reloads the webchat iframe.
  const wasReady = useRef(false);
  const mountedRef = useRef(false);
  // Focus returns here when the panel closes (spec: keyboard flow).
  const nameBtnRef = useRef<HTMLButtonElement>(null);

  const refreshEnv = useCallback(() => {
    setRefreshing(true);
    setEnvError("");
    invoke<EnvInfo>("env_info")
      .then(setEnvInfo)
      .catch((e: string) => setEnvError(String(e)))
      .finally(() => setRefreshing(false));
  }, []);

  // Prefetch once on mount.
  useEffect(() => {
    refreshEnv();
  }, [refreshEnv]);

  // Shell skin: paint <html data-theme> from the persisted「外观」preference
  // as early as possible; "system" keeps following OS flips live on the shell
  // (the embedded webchat scheme updates on next launch — v1.6.34/#8 notes).
  useEffect(() => {
    let unwatch: (() => void) | null = null;
    loadUiTheme().then((pref) => {
      applySkin(pref);
      unwatch = watchSystemSkin();
    });
    return () => unwatch?.();
  }, []);

  // Locale: load persisted preference, then wrap everything in LocaleContext.
  // setLocale persists via app_set_ui_locale (which also rebuilds the tray
  // menu Rust-side and returns the resolved locale); local state flips only
  // after that succeeds.
  useEffect(() => {
    loadLocaleSettings().then(({ pref, resolved }) => {
      setLocalePrefState(pref);
      setLocaleState(resolved);
      applyHtmlLang(resolved);
    });
  }, []);
  const i18n: I18n = useMemo(() => {
    const setLocale = (pref: LocalePref) => {
      invoke<string>("app_set_ui_locale", { locale: pref })
        .then((resolved) => {
          const r = isLocale(resolved) ? resolved : guessFromNavigator();
          setLocalePrefState(pref);
          setLocaleState(r);
          applyHtmlLang(r);
        })
        .catch(() => {});
    };
    return { t: makeT(locale), locale, localePref, setLocale };
  }, [locale, localePref]);
  const { t } = i18n;


  // Registry speed probe runs once when the notfound chooser appears; the
  // faster source becomes the primary install button, the other stays as an
  // explicit alternative. A failed probe leaves the plain default button.
  useEffect(() => {
    if (status.status !== "notfound" || npmProbe !== null) return;
    invoke<NpmProbe>("dsh_npm_probe")
      .then(setNpmProbe)
      .catch(() => {});
  }, [status.status, npmProbe]);

  useEffect(() => {
    let unlistenStatus: UnlistenFn | undefined;
    let unlistenUpdate: UnlistenFn | undefined;
    let unlistenShowEnv: UnlistenFn | undefined;
    let cancelled = false;

    (async () => {
      unlistenStatus = await listen<DshStatus>("dsh-status", (event) => {
        setStatus(event.payload);
        if (event.payload.status === "ready") {
          if (!wasReady.current) {
            wasReady.current = true;
            if (mountedRef.current) {
              setReloadKey((key) => key + 1);
            } else {
              mountedRef.current = true;
              setWebchatMounted(true);
            }
            // BrowserAuth dsh (issue #10) needs the session token appended to
            // the iframe URL; legacy dsh yields null → plain URL. Refreshed on
            // every ready edge so a restarted backend's fresh token is picked up.
            invoke<string | null>("dsh_browser_session_token")
              .then((token) =>
                setWebchatSrc(
                  token ? `${WEBCHAT_URL}/?token=${encodeURIComponent(token)}` : WEBCHAT_URL,
                ),
              )
              .catch(() => setWebchatSrc(WEBCHAT_URL));
            // The port owner / pid facts only mean something once DSH is up.
            refreshEnv();
          }
        } else {
          wasReady.current = false;
          setChatVisible(false);
        }
      });
      unlistenUpdate = await listen<AppUpdate>("app-update", (event) => {
        setUpdate(event.payload);
      });
      unlistenShowEnv = await listen("show-env", () => {
        setOverlay("env");
      });
      if (cancelled) {
        unlistenStatus();
        unlistenUpdate();
        unlistenShowEnv();
      }
    })();

    return () => {
      cancelled = true;
      unlistenStatus?.();
      unlistenUpdate?.();
      unlistenShowEnv?.();
    };
  }, [refreshEnv]);

  // Fuse: if the update events never arrive (very old build, IPC hiccup),
  // stop holding the handoff on `pending` — startup must never hang.
  useEffect(() => {
    if (update.state !== "pending") return;
    const timer = setTimeout(() => setUpdate({ state: "none" }), 10_000);
    return () => clearTimeout(timer);
  }, [update.state]);

  // The green check appears when the update lands and fades out by itself.
  useEffect(() => {
    if (update.state === "done") {
      setCheckVisible(true);
      const timer = setTimeout(() => setCheckVisible(false), 1_800);
      return () => clearTimeout(timer);
    }
    setCheckVisible(false);
  }, [update]);

  // Reveal the webchat on ready — but let a running update finish first so
  // the transient titlebar indicator is actually seen. After `done` the Rust
  // side restarts the app onto the new exe; switching here is only the
  // fallback if that restart never arrives. `failed`: show why first.
  useEffect(() => {
    if (status.status !== "ready") return;
    const busy =
      update.state === "pending" ||
      update.state === "checking" ||
      update.state === "downloading";
    if (busy) return;
    const delay =
      update.state === "done" ? 8_000 : update.state === "failed" ? 4_000 : 0;
    const timer = setTimeout(() => setChatVisible(true), delay);
    return () => clearTimeout(timer);
  }, [status.status, update.state]);

  const closePanel = useCallback(() => {
    setOverlay(null);
    nameBtnRef.current?.focus();
  }, []);

  const updateBusy =
    update.state === "pending" ||
    update.state === "checking" ||
    update.state === "downloading";

  return (
    <LocaleContext.Provider value={i18n}>
      <main className="shell">
      <TitleBar
        updateState={update.state}
        checkVisible={checkVisible}
        updateBusy={updateBusy}
        panelOpen={overlay !== null}
        onTogglePanel={() => setOverlay((o) => (o === null ? "env" : null))}
        nameBtnRef={nameBtnRef}
      />

      <div className="content">
        {webchatMounted && (
          <iframe
            key={reloadKey}
            src={webchatSrc}
            className="webchat"
            title="DSH webchat"
            allow="clipboard-read; clipboard-write; fullscreen"
            style={{ display: chatVisible || overlay !== null ? "block" : "none" }}
          />
        )}

        {!chatVisible && (
          <div className="boot-wrap">
            {status.status === "starting" && (
              <div className="state">
                <div className="spinner" aria-hidden="true" />
                <div className="text">
                  {t("boot.starting")}
                  {status.method ? `(${status.method})` : ""}
                </div>
                {status.method?.includes("npx") && (
                  <div className="detail">{t("boot.npxFirstRun")}</div>
                )}
                {update.state === "downloading" && (
                  <div className="detail">
                    {t("boot.updateDownloading", { version: update.to ?? "" })}
                  </div>
                )}
                {update.state === "done" && (
                  <div className="detail">{t("boot.updateDoneRestarting", { version: update.to ?? "" })}</div>
                )}
                {update.state === "failed" && (
                  <div className="detail">{t("boot.updateFailedSkipped")}</div>
                )}
                <button
                  type="button"
                  className="boot-log-link"
                  onClick={() => setOverlay("log")}
                >
                  {t("boot.viewLog")}
                </button>
              </div>
            )}

            {status.status === "ready" && (
              <div className="state">
                <div className="spinner" aria-hidden="true" />
                <div className="text">
                  {update.state === "downloading"
                    ? t("boot.waitingUpdate")
                    : update.state === "done"
                      ? t("boot.newReadyRestarting")
                      : t("boot.opening")}
                </div>
                {update.state === "downloading" && (
                  <div className="detail">{t("boot.updateDownloading", { version: update.to ?? "" })}</div>
                )}
                {update.state === "done" && (
                  <div className="detail">{t("boot.newVersionReady", { version: update.to ?? "" })}</div>
                )}
                {update.state === "failed" && update.message !== undefined && (
                  <div className="detail">{t("boot.updateFailedSkipped")}</div>
                )}
                <button
                  type="button"
                  className="boot-log-link"
                  onClick={() => setOverlay("log")}
                >
                  {t("boot.viewLog")}
                </button>
              </div>
            )}

            {status.status === "notfound" && (
              <div className="state">
                <div className="text error">{t("nf.title")}</div>
                <div className="detail">{t("nf.detail")}</div>
                {(() => {
                  const mirrorFastest = npmProbe?.fastest === "npmmirror";
                  const ms = (v: number | null) =>
                    v === null ? t("nf.msUnreachable") : `${v}ms`;
                  const primaryRegistry: string | null = mirrorFastest
                    ? REGISTRY_MIRROR
                    : npmProbe?.fastest === "npmjs"
                      ? REGISTRY_OFFICIAL
                      : null; // probe pending/failed: plain npm default
                  const secondaryRegistry = mirrorFastest ? REGISTRY_OFFICIAL : REGISTRY_MIRROR;
                  const primaryLabel = mirrorFastest
                    ? t("nf.installFastest", {
                        source: t("nf.sourceMirror"),
                        ms: ms(npmProbe?.npmmirrorMs ?? null),
                      })
                    : npmProbe?.fastest === "npmjs"
                      ? t("nf.installFastest", {
                          source: t("nf.sourceOfficial"),
                          ms: ms(npmProbe.npmjsMs),
                        })
                      : t("nf.installPlain");
                  const secondaryLabel = mirrorFastest
                    ? t("nf.switchInstall", {
                        source: t("nf.sourceOfficial"),
                        ms: ms(npmProbe?.npmjsMs ?? null),
                      })
                    : t("nf.switchInstall", {
                        source: t("nf.sourceMirror"),
                        ms: ms(npmProbe?.npmmirrorMs ?? null),
                      });
                  return (
                    <>
                      <button type="button" onClick={() => invoke("dsh_install_npm", { registry: primaryRegistry })}>
                        {primaryLabel}
                      </button>
                      {npmProbe !== null && (
                        <button className="btn-secondary" type="button" onClick={() => invoke("dsh_install_npm", { registry: secondaryRegistry })}>
                          {secondaryLabel}
                        </button>
                      )}
                    </>
                  );
                })()}
                <button type="button" onClick={() => invoke("dsh_download")}>
                  {t("nf.downloadNpx")}
                </button>
                <input
                  className="path-input"
                  value={customPath}
                  placeholder={t("nf.pathPlaceholder")}
                  onChange={(event) => { setCustomPath(event.target.value); setPathError("") }}
                />
                <button
                  type="button"
                  onClick={() => {
                    invoke("dsh_custom_path", { path: customPath })
                      .catch((error: string) => { setPathError(String(error)) })
                  }}
                >
                  {t("nf.usePath")}
                </button>
                {pathError !== "" && <div className="detail">{pathError}</div>}
                <button type="button" onClick={() => invoke("dsh_retry")}>
                  {t("nf.reScan")}
                </button>
                <button type="button" onClick={() => invoke("dsh_exit")}>
                  {t("nf.exit")}
                </button>
                <div className="detail">
                  {t("nf.globalHint")}
                </div>
              </div>
            )}

            {status.status === "error" && (
              <div className="state">
                <div className="text error">{t("err.title")}</div>
                <div className="detail">{status.message}</div>
                <button type="button" onClick={() => invoke("dsh_retry")}>
                  {t("err.retry")}
                </button>
                <button type="button" onClick={() => invoke("dsh_download")}>
                  {t("err.npxFallback")}
                </button>
                <button
                  type="button"
                  className="boot-log-link"
                  onClick={() => setOverlay("log")}
                >
                  {t("boot.viewLog")}
                </button>
              </div>
            )}
          </div>
        )}

        {overlay !== null && (
          <EnvPanel
            initialTab={overlay}
            info={envInfo}
            error={envError}
            refreshing={refreshing}
            onRefresh={refreshEnv}
            onClose={closePanel}
          />
        )}
      </div>
      </main>
    </LocaleContext.Provider>
  );
}

/** The app's own title bar (window is undecorated): whale icon + name
 *  (click → environment-manager panel) centered, drag regions flanking it,
 *  and native minimize / maximize-restore / close buttons. Window operations
 *  go through app commands (Rust-side calls) — the frontend window-plugin
 *  path silently no-op'd here. Close hides to tray via the Rust
 *  CloseRequested handler. */
function TitleBar({
  updateState,
  checkVisible,
  updateBusy,
  panelOpen,
  onTogglePanel,
  nameBtnRef,
}: {
  updateState: AppUpdate["state"];
  checkVisible: boolean;
  updateBusy: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  nameBtnRef: React.RefObject<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const sync = () => {
      invoke<boolean>("window_is_maximized")
        .then(setMaximized)
        .catch(() => {});
    };
    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const dragHandlers = {
    // Left-drag anywhere in the strip (except on a button) moves the window;
    // double-click toggles maximize — both via Rust commands.
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;
      invoke("window_start_drag").catch(() => {});
    },
    onDoubleClick: (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("button")) return;
      invoke("window_toggle_maximize").catch(() => {});
    },
  };

  return (
    <header className="titlebar">
      <div className="titlebar-drag" {...dragHandlers} />

      {/* Comfy-style capsule control: icon + name + chevron, whole pill
          toggles the environment panel. Update status rides as a transient
          ring/check inside the pill (no version text in the bar). */}
      <div className="tb-identity">
        <button
          type="button"
          ref={nameBtnRef}
          className={`tb-pill${panelOpen ? " open" : ""}`}
          title={t("tb.manage")}
          onClick={onTogglePanel}
        >
          <img className="tb-pill-icon" src={appIcon} alt="" draggable={false} />
          <span className="tb-pill-name">DeepSeek Harness</span>
          {updateBusy && (
            <svg className="update-ring tb-pill-status" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
            </svg>
          )}
          {updateState === "done" && (
            <svg
              className={`check tb-pill-status${checkVisible ? " show" : ""}`}
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M3 8.5 6.5 12 13 4.5" />
            </svg>
          )}
          {!updateBusy && updateState !== "done" && (
            <svg
              className={`tb-pill-chevron${panelOpen ? " up" : ""}`}
              width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
            >
              <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
      </div>

      <div className="titlebar-drag" {...dragHandlers} />

      <button
        type="button"
        className="tb-btn"
        title={t("tb.minimize")}
        onClick={() => invoke("window_minimize").catch(() => {})}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="4.75" width="9" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="tb-btn"
        title={maximized ? t("tb.restore") : t("tb.maximize")}
        onClick={() => invoke("window_toggle_maximize").catch(() => {})}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M2.8 2.2V0.8h6.4v6.4H7.8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="tb-btn tb-close"
        title={t("tb.closeHint")}
        onClick={() => invoke("window_close").catch(() => {})}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.8 0.8 9.2 9.2 M9.2 0.8 0.8 9.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </svg>
      </button>
    </header>
  );
}

export default App;
