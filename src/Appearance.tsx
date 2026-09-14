import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MorphIcon } from "morphicons/react";
import { Sun, Moon, Copy, RotateCcw, Upload, Plus, MessageSquare, type IconNode } from "lucide";
import { useI18n } from "./i18n";
import { appearanceText } from "./appearanceI18n";
import { defaults, exportTheme, importTheme, preset, tokens, font, fontStack, validateTheme, type Appearance as Config, type Scheme, type ThemeColors } from "./appearanceModel";
import { applySkin, currentPref, getAppearance, loadUiTheme, resolveSkin, saveAppearance, type UiTheme } from "./theme";

const Icon = ({ icon }: { icon: IconNode }) => <MorphIcon icon={icon} size={16} reducedMotion="user" aria-hidden="true" />;
function Row({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <div className="ap-row"><div><span className="ap-label">{title}</span>{help && <p>{help}</p>}</div><div className="ap-control">{children}</div></div>;
}
function TextField({ value, label, list, onSave }: { value: string; label: string; list?: string; onSave: (v: string) => boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="ap-text-input" aria-label={label} value={draft} list={list} spellCheck={false} maxLength={80}
    onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value && !onSave(draft)) setDraft(value); }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.stopPropagation(); setDraft(value); } }} />;
}
export default function Appearance() {
  const { t, locale } = useI18n();
  const m = appearanceText(locale);
  const [config, setConfig] = useState(getAppearance);
  const [mode, setMode] = useState<UiTheme>(currentPref);
  const [active, setActive] = useState(() => resolveSkin(currentPref()));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transfer, setTransfer] = useState<"import" | "copy" | null>(null);
  const [json, setJson] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { let mounted = true; loadUiTheme().then(v => { if (mounted) { setMode(v); setActive(resolveSkin(v)); } }); return () => { mounted = false; }; }, []);
  useEffect(() => { const mq = window.matchMedia("(prefers-color-scheme: dark)"); const cb = () => setActive(resolveSkin(mode)); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); }, [mode]);
  function commit(next: Config): boolean {
    try { saveAppearance(next); setConfig(next); setError(""); setNotice(""); return true; }
    catch { setError(m.saveError); return false; }
  }
  function changeTheme(scheme: Scheme, patch: Partial<ThemeColors>): boolean {
    try { return commit({ ...config, [scheme]: validateTheme({ ...config[scheme], ...patch }) }); }
    catch { setError(m.invalidColor); return false; }
  }
  async function changeMode(value: UiTheme) {
    setBusy(true);
    try { await invoke("app_set_ui_theme", { theme: value }); setMode(value); setActive(applySkin(value)); setError(""); }
    catch { setError(m.saveError); }
    finally { setBusy(false); }
  }
  async function copy(scheme: Scheme) {
    const text = exportTheme(scheme, config[scheme]);
    try { await navigator.clipboard.writeText(text); setNotice(m.copied); setError(""); }
    catch { setJson(text); setTransfer("copy"); setError(m.copyError); }
  }
  const toggle = (key: "pointer" | "translucent", title: string) => <button type="button" role="switch" aria-label={title} aria-checked={config[key]} className={`ep-switch${config[key] ? " on" : ""}`} onClick={() => commit({ ...config, [key]: !config[key] })} />;
  return <div className="ep-content-inner ap-settings">
    <div className="ep-card"><Row title={t("set.theme")} help={m.scope}><div className="ep-seg" role="radiogroup" aria-label={t("set.theme")}>
      {(["system", "light", "dark"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={busy} className={`ep-seg-btn${mode === value ? " active" : ""}`} onClick={() => void changeMode(value)}>{t(value === "system" ? "set.themeSystem" : value === "light" ? "set.themeLight" : "set.themeDark")}</button>)}
    </div></Row></div>
    <section className="ep-group ap-themes"><div className="ap-section-heading"><h2>{m.themes}</h2><span>{m.saved}</span></div>
      <div className="ap-theme-grid">{(["light", "dark"] as const).map(scheme => {
        const theme = config[scheme];
        const selectedPreset = (["dsh", "codex"] as const).find(name => JSON.stringify(theme) === JSON.stringify(preset(scheme, name))) ?? "custom";
        return <article className="ap-theme-card" key={scheme} aria-label={m[scheme]}>
          <header><h3><Icon icon={scheme === "light" ? Sun : Moon} />{m[scheme]}</h3><span className={active === scheme ? "ap-active" : ""}>{active === scheme ? m.active : m.editing}</span></header>
          <div className="ap-preview" aria-label={`${m[scheme]} ${m.preview}`} style={{ ...tokens(theme), fontFamily: fontStack(config.uiFont), fontSize: `${config.uiSize}px` } as CSSProperties}>
            <aside><div className="ap-preview-dot"/><div className="ap-preview-selected"><Icon icon={MessageSquare} /><span>DSH</span></div><div className="ap-preview-line"/><div className="ap-preview-line short"/></aside>
            <div className="ap-preview-main"><strong>{m.sample}</strong><code style={{ fontFamily: fontStack(config.codeFont, true), fontSize: `${config.codeSize}px` }}>console.log("Hello, DSH")</code><div className="ap-preview-bottom"><span className="ap-preview-button"><Icon icon={Plus}/>{m.task}</span><span className="ap-preview-switch"/></div></div>
          </div>
          <div className="ap-theme-fields">
            <Row title={m.preset}><select aria-label={`${m[scheme]} ${m.preset}`} value={selectedPreset} onChange={e => commit({ ...config, [scheme]: preset(scheme, e.target.value as "dsh" | "codex") })}><option value="dsh">DSH</option><option value="codex">Codex</option><option value="custom" disabled>{m.custom}</option></select></Row>
            {(["accent", "background", "foreground"] as const).map(key => <Row title={m[key]} key={key}><div className="ap-color"><input type="color" aria-label={`${m[scheme]} ${m[key]} picker`} value={theme[key]} onChange={e => changeTheme(scheme, { [key]: e.target.value })}/><TextField label={`${m[scheme]} ${m[key]} HEX`} value={theme[key]} onSave={v => changeTheme(scheme, { [key]: v })}/></div></Row>)}
            <Row title={m.contrast}><div className="ap-range"><input type="range" aria-label={`${m[scheme]} ${m.contrast}`} min={0} max={100} value={theme.contrast} onChange={e => changeTheme(scheme, { contrast: Number(e.target.value) })}/><output>{theme.contrast}</output></div></Row>
          </div>
          <footer><button className="ep-secondary" onClick={() => void copy(scheme)}><Icon icon={Copy}/>{m.copy}</button><button className="ep-secondary" onClick={() => commit({ ...config, [scheme]: preset(scheme) })}><Icon icon={RotateCcw}/>{m.reset}</button></footer>
        </article>;
      })}</div>
      <div className="ap-import-action"><button className="ep-secondary" onClick={() => { setTransfer("import"); setJson(""); setError(""); }}><Icon icon={Upload}/>{m.import}</button></div>
      {transfer && <div className="ep-card ap-transfer"><label htmlFor="ap-json">{m.themeFormat}</label><p>{transfer === "import" ? m.importHelp : m.copyError}</p><textarea id="ap-json" autoFocus value={json} readOnly={transfer === "copy"} maxLength={8192} onChange={e => setJson(e.target.value)} onFocus={e => { if (transfer === "copy") e.target.select(); }}/><div className="ap-actions">{transfer === "import" && <button className="ep-primary" disabled={!json.trim()} onClick={() => { try { const value = importTheme(json); if (commit({ ...config, [value.scheme]: value.theme })) { setTransfer(null); setNotice(m.imported); } } catch { setError(m.invalid); } }}>{m.apply}</button>}<button className="ep-secondary" onClick={() => { setTransfer(null); setError(""); }}>{m.cancel}</button></div></div>}
    </section>
    <section className="ep-group"><h2>{m.fonts}</h2><p className="ap-help">{m.fontHelp}</p><div className="ep-card">
      {(["uiFont", "codeFont"] as const).map(key => <Row key={key} title={m[key]}><TextField label={m[key]} value={config[key]} list={`ap-${key}`} onSave={v => { try { return commit({ ...config, [key]: font(v) }); } catch { setError(m.fontInvalid); return false; } }}/><datalist id={`ap-${key}`}>{(key === "uiFont" ? ["system-ui", "Segoe UI", "Microsoft YaHei", "Arial"] : ["Consolas", "Cascadia Code", "Cascadia Mono", "Courier New"]).map(name => <option key={name} value={name}>{name === "system-ui" ? m.system : name}</option>)}</datalist></Row>)}
      {(["uiSize", "codeSize"] as const).map(key => <Row key={key} title={m[key]}><select aria-label={m[key]} value={config[key]} onChange={e => commit({ ...config, [key]: Number(e.target.value) })}>{Array.from({ length: key === "uiSize" ? 9 : 12 }, (_, i) => i + (key === "uiSize" ? 12 : 11)).map(n => <option key={n} value={n}>{n} px</option>)}</select></Row>)}
    </div></section>
    <section className="ep-group"><h2>{m.behavior}</h2><div className="ep-card"><Row title={m.pointer} help={m.pointerHelp}>{toggle("pointer", m.pointer)}</Row><Row title={m.translucent} help={m.translucentHelp}>{toggle("translucent", m.translucent)}</Row></div></section>
    <div className="ap-reset">{confirmReset ? <><p>{m.confirmReset}</p><div className="ap-actions"><button className="ep-primary" onClick={() => { if (commit(defaults())) { setConfirmReset(false); setNotice(m.resetDone); } }}>{m.confirm}</button><button className="ep-secondary" onClick={() => setConfirmReset(false)}>{m.cancel}</button></div></> : <button className="ep-secondary" onClick={() => setConfirmReset(true)}><Icon icon={RotateCcw}/>{m.resetAll}</button>}</div>
    {(notice || error) && <div className={`ap-feedback${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}
  </div>;
}
