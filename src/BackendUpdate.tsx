import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChannelPicker } from "./EnvPanel";
import { useI18n } from "./i18n";
import { backendText } from "./backendUpdateI18n";
import { jobBusy, manualCommand, versionRelation, type BackendJob, type BackendSource, type Channel } from "./backendUpdateModel";

type Channels = Partial<Record<Channel, string>> & { checkedAt?: string };
export default function BackendUpdate({ onChanged }: { onChanged: () => void }) {
  const { locale } = useI18n();
  const text = backendText(locale);
  const [source, setSource] = useState<BackendSource | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [job, setJob] = useState<BackendJob | null>(null);
  const [jobReady, setJobReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState<Channel>(() => {
    const value = localStorage.getItem("dshBackendChannel");
    return value === "next" || value === "alpha" ? value : "latest";
  });
  const [advanced, setAdvanced] = useState(channel === "alpha");
  const completed = useRef("");
  const refreshGeneration = useRef(0);
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setChecking(true); setCheckFailed(false); setChannels(null);
    const [versions, origin] = await Promise.allSettled([
      invoke<Channels | null>("dsh_npm_channels"),
      invoke<BackendSource>("dsh_backend_source"),
    ]);
    if (!mounted.current || generation !== refreshGeneration.current) return;
    if (versions.status === "fulfilled" && versions.value) setChannels(versions.value);
    else setCheckFailed(true);
    setSource(origin.status === "fulfilled" ? origin.value : null);
    setChecking(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // Authoritative Rust snapshot survives tab changes and WebView reloads.
  // Poll serially so a stale request cannot overwrite a newer phase.
  useEffect(() => {
    let cancelled = false; let timer: number;
    const poll = async () => {
      try {
        const latest = await invoke<BackendJob | null>("dsh_backend_update_status");
        if (cancelled) return;
        setJob(latest); setJobReady(true);
        if (latest && !jobBusy(latest) && completed.current !== latest.id) {
          completed.current = latest.id; void refresh(); onChangedRef.current();
        }
      } catch { if (!cancelled) setJobReady(false); }
      if (!cancelled) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh]);
  const target = channels?.[channel];
  const relation = versionRelation(source?.version, target);
  const busy = submitting || jobBusy(job);
  const canInstall = !busy && !checking && jobReady && source?.managed && (relation === "newer" || relation === "ahead");
  const command = target ? manualCommand(source, target) : null;
  const start = async (downgrade: boolean) => {
    if (!canInstall || !target || !source?.path || !source.version) return;
    const message = (downgrade ? text.confirmDowngrade : text.confirmUpdate)
      .replace("{from}", source.version).replace("{to}", target) + "\n\n" + source.path;
    if (!window.confirm(message)) return;
    setSubmitting(true); setNotice("");
    try {
      const accepted = await invoke<BackendJob>("dsh_backend_upgrade", { target, expectedPath: source.path, expectedVersion: source.version, allowDowngrade: downgrade });
      if (mounted.current) setJob(accepted);
    } catch (error) { if (mounted.current) setNotice(String(error)); }
    finally { if (mounted.current) setSubmitting(false); }
  };
  const kinds: Record<string, string> = { global: text.global, local: text.local, custom: text.custom, external: text.external, npx: "npx", unknown: text.unknown };
  const status = checking ? text.checking : checkFailed ? text.checkFailed : !target ? text.unavailable : text[relation];
  return <section className="ep-group bu-section">
    <div className="ep-version-heading">DeepSeek Harness <span className="ep-badge">{status}</span></div>
    <div className="ep-card">
      <div className="ep-row"><div className="ep-row-label">{text.running}</div><div className="ep-row-value mono">{source?.version ?? text.unknown}</div><div /></div>
      <div className="ep-row"><div className="ep-row-label">{text.source}</div><div className="ep-row-value">{source ? kinds[source.kind] ?? text.unknown : text.unknown}</div><div /></div>
      <div className="ep-row"><div className="ep-row-label">{text.path}</div><div className="ep-row-value mono" title={source?.path ?? ""}>{source?.path ?? "—"}</div><div /></div>
      <div className="ep-row"><div className="ep-row-label">{text.target}</div><div className="ep-row-value mono">{checking ? text.checking : target ?? "—"}</div><div /></div>
      <div className="ep-row"><div className="ep-row-label">{text.lastCheck}</div><div className="ep-row-value">{channels?.checkedAt ?? "—"}</div><button className="ep-tool-btn" disabled={checking || busy} onClick={() => void refresh()}>{text.check}</button></div>
    </div>
    <div className="ep-card ep-channel-card ep-update-choice">
      <div className="ep-channel-title">{text.channel}<span className="ep-row-description">{text.channelHelp}</span></div>
      <ChannelPicker value={channel} disabled={busy || checking} onChange={id => { setChannel(id as Channel); localStorage.setItem("dshBackendChannel", id); setNotice(""); }} options={[
        { id: "latest", title: text.latest, desc: text.latestHelp },
        { id: "next", title: text.next, desc: text.nextHelp },
        ...(advanced ? [{ id: "alpha", title: text.alpha, desc: text.alphaHelp }] : []),
      ]} />
      <div className="ep-upgrade-row bu-actions">
        <button className="ep-tool-btn" aria-expanded={advanced} disabled={busy} onClick={() => { if (channel !== "alpha") setAdvanced(v => !v); }}>{text.advanced}</button>
        <span className="ep-log-spacer" />
        <button className="ep-secondary" disabled={!command || checking} onClick={() => { if (command) navigator.clipboard.writeText(command).then(() => setNotice(text.copied)).catch(() => setNotice(text.copyFailed)); }}>{text.copy}</button>
        <button className="ep-primary" disabled={!canInstall || relation !== "newer"} onClick={() => void start(false)}>{relation === "newer" && target ? text.updateTo.replace("{to}", target) : text.update}</button>
      </div>
    </div>
    {!checking && !source?.managed && <p className="ep-row-description bu-guidance">{text.unmanaged} {source?.kind === "local" ? text.localHelp : source?.kind === "npx" ? text.npxHelp : source?.kind === "external" ? text.externalHelp : source?.kind === "custom" ? text.customHelp : text.unknownHelp}</p>}
    {relation === "ahead" && !checking && <details className="bu-advanced"><summary>{text.downgrade}</summary><p>{text.downgradeHelp}</p><button className="ep-secondary" disabled={!canInstall} onClick={() => void start(true)}>{text.downgradeTo.replace("{to}", target ?? "")}</button></details>}
    {job && <div role="status" className={'bu-job ' + job.phase}><strong>{text[job.phase]} · {job.target}</strong>{job.error && <p>{job.error}</p>}</div>}
    {!jobReady && <p role="status" className="ep-row-description">{text.jobUnavailable}</p>}
    {notice && <p role="status" className="ep-row-description">{notice}</p>}
  </section>;
}
