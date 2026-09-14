export type Scheme = "light" | "dark";
export type ThemeColors = { accent: string; background: string; foreground: string; contrast: number; frame?: string; surface?: string };
export type Appearance = {
  version: 1; light: ThemeColors; dark: ThemeColors;
  uiFont: string; codeFont: string; uiSize: number; codeSize: number;
  pointer: boolean; translucent: boolean;
};
export const STORAGE_KEY = "dsh.appearance.v1";
export const PRESET_IDS = ["dsh", "ocean", "forest", "violet", "amber", "rose"] as const;
export type PresetId = typeof PRESET_IDS[number];
const palettes: Record<PresetId, Record<Scheme, ThemeColors>> = {
  dsh: { light: { accent: "#4d6bfe", background: "#fafafa", foreground: "#242424", contrast: 50 }, dark: { accent: "#4d6bfe", background: "#191919", foreground: "#ededed", contrast: 50 } },
  ocean: { light: { accent: "#0369a1", background: "#f1f8fc", foreground: "#193448", contrast: 45 }, dark: { accent: "#38bdf8", background: "#101e2b", foreground: "#e1eff8", contrast: 45 } },
  forest: { light: { accent: "#28734a", background: "#f3f8f2", foreground: "#243b2b", contrast: 45 }, dark: { accent: "#70c994", background: "#14231b", foreground: "#e3f0e5", contrast: 45 } },
  violet: { light: { accent: "#7c3aed", background: "#f8f5fc", foreground: "#352849", contrast: 45 }, dark: { accent: "#b49afa", background: "#201a2e", foreground: "#eee7fa", contrast: 45 } },
  amber: { light: { accent: "#a65b13", background: "#fcf7ee", foreground: "#453323", contrast: 45 }, dark: { accent: "#e9b36a", background: "#292017", foreground: "#f5eadb", contrast: 45 } },
  rose: { light: { accent: "#b33f69", background: "#fcf3f5", foreground: "#492c36", contrast: 45 }, dark: { accent: "#ed94b2", background: "#2b1b23", foreground: "#f6e5eb", contrast: 45 } },
};
export function preset(scheme: Scheme, name: PresetId = "dsh"): ThemeColors {
  return { ...(palettes[name] ?? palettes.dsh)[scheme] };
}
export function matchingPreset(scheme: Scheme, theme: ThemeColors): PresetId | "custom" {
  if (theme.frame !== undefined || theme.surface !== undefined) return "custom";
  return PRESET_IDS.find(name => {
    const colors = palettes[name][scheme];
    return (Object.keys(colors) as (keyof ThemeColors)[]).every(key => colors[key] === theme[key]);
  }) ?? "custom";
}
export function defaults(): Appearance {
  return { version: 1, light: preset("light"), dark: preset("dark"), uiFont: "system-ui", codeFont: "Consolas", uiSize: 14, codeSize: 13, pointer: true, translucent: false };
}
export function hex(value: unknown): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw new Error("color");
  return value.toLowerCase();
}
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(k => !keys.includes(k) && !optional.includes(k)) || keys.some(k => !(k in record))) throw new Error("fields");
  return record;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("range");
  return value;
}
export function font(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || !/^[\p{L}\p{N} _.-]+$/u.test(value)) throw new Error("font");
  return value.trim();
}
export function validateTheme(value: unknown): ThemeColors {
  const r = object(value, ["accent", "background", "foreground", "contrast"], ["frame", "surface"]);
  const result: ThemeColors = { accent: hex(r.accent), background: hex(r.background), foreground: hex(r.foreground), contrast: number(r.contrast, 0, 100) };
  if (r.frame !== undefined) result.frame = hex(r.frame);
  if (r.surface !== undefined) result.surface = hex(r.surface);
  return result;
}
export function validateAppearance(value: unknown): Appearance {
  const r = object(value, ["version", "light", "dark", "uiFont", "codeFont", "uiSize", "codeSize", "pointer", "translucent"]);
  if (r.version !== 1 || typeof r.pointer !== "boolean" || typeof r.translucent !== "boolean") throw new Error("version");
  return { version: 1, light: validateTheme(r.light), dark: validateTheme(r.dark), uiFont: font(r.uiFont), codeFont: font(r.codeFont), uiSize: number(r.uiSize, 12, 20), codeSize: number(r.codeSize, 11, 22), pointer: r.pointer, translucent: r.translucent };
}
export function exportTheme(scheme: Scheme, theme: ThemeColors): string {
  return JSON.stringify({ format: "dsh-theme", version: 1, scheme, theme: validateTheme(theme) }, null, 2);
}
export function importTheme(text: string): { scheme: Scheme; theme: ThemeColors } {
  if (text.length > 8192) throw new Error("size");
  const r = object(JSON.parse(text), ["format", "version", "scheme", "theme"]);
  if (r.format !== "dsh-theme" || r.version !== 1 || (r.scheme !== "light" && r.scheme !== "dark")) throw new Error("version");
  return { scheme: r.scheme, theme: validateTheme(r.theme) };
}
function rgb(color: string) { return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); }
export function mix(a: string, b: string, amount: number): string {
  const other = rgb(b);
  return "#" + rgb(a).map((v, i) => Math.round(v + (other[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}
function luminance(color: string): number {
  const c = rgb(color).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function tokens(t: ThemeColors): Record<string, string> {
  const blend = (n: number) => mix(t.background, t.foreground, n);
  const level = t.contrast / 100;
  const surface = t.surface ?? blend(.025 + level * .045);
  const surfaceText = t.foreground;
  const frame = t.frame ?? blend(.025 + level * .05);
  const frameText = t.foreground;
  return { "--surface-text": surfaceText, "--surface-muted": mix(surface, surfaceText, .72), "--surface-hover": mix(surface, surfaceText, .10), "--surface-line": mix(surface, surfaceText, .20), "--frame-bg": frame, "--frame-title": t.frame ?? blend(.025 + level * .045), "--frame-text": frameText,
    "--frame-muted": mix(frame, frameText, .75), "--frame-hover": mix(frame, frameText, .12), "--ep-bg": t.background, "--ep-text": t.foreground, "--ep-side": blend(.025 + level * .05), "--ep-card": surface, "--ep-hover": blend(.07 + level * .075), "--ep-line": blend(.09 + level * .13), "--ep-muted": blend(.65), "--accent": t.accent, "--on-accent": contrastRatio(t.accent, "#ffffff") >= contrastRatio(t.accent, "#000000") ? "#ffffff" : "#000000" };
}
export function fontStack(name: string, code = false): string {
  return name === "system-ui" ? 'system-ui, "Segoe UI", sans-serif' : `"${font(name)}", ${code ? 'Consolas, "Cascadia Code", monospace' : 'system-ui, "Segoe UI", sans-serif'}`;
}
