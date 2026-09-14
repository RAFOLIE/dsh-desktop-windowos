export type Scheme = "light" | "dark";
export type ThemeColors = { accent: string; background: string; foreground: string; contrast: number };
export type Appearance = {
  version: 1; light: ThemeColors; dark: ThemeColors;
  uiFont: string; codeFont: string; uiSize: number; codeSize: number;
  pointer: boolean; translucent: boolean;
};
export const STORAGE_KEY = "dsh.appearance.v1";
export function preset(scheme: Scheme, name: "dsh" | "codex" = "dsh"): ThemeColors {
  return { accent: name === "codex" ? "#3b82f6" : "#4d6bfe", background: scheme === "dark" ? "#191919" : "#fafafa", foreground: scheme === "dark" ? "#ededed" : "#242424", contrast: name === "codex" ? 40 : 50 };
}
export function defaults(): Appearance {
  return { version: 1, light: preset("light"), dark: preset("dark"), uiFont: "system-ui", codeFont: "Consolas", uiSize: 14, codeSize: 13, pointer: true, translucent: false };
}
export function hex(value: unknown): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw new Error("color");
  return value.toLowerCase();
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(k => !keys.includes(k)) || keys.some(k => !(k in record))) throw new Error("fields");
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
  const r = object(value, ["accent", "background", "foreground", "contrast"]);
  const result = { accent: hex(r.accent), background: hex(r.background), foreground: hex(r.foreground), contrast: number(r.contrast, 0, 100) };
  // Prevent imported or edited themes from making the editor unreadable.
  if (contrastRatio(result.background, result.foreground) < 3) throw new Error("contrast");
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
  return { "--ep-bg": t.background, "--ep-text": t.foreground, "--ep-side": blend(.025 + level * .05), "--ep-card": blend(.025 + level * .045), "--ep-hover": blend(.07 + level * .075), "--ep-line": blend(.09 + level * .13), "--ep-muted": blend(.65), "--accent": t.accent, "--on-accent": contrastRatio(t.accent, "#ffffff") >= contrastRatio(t.accent, "#000000") ? "#ffffff" : "#000000" };
}
export function fontStack(name: string, code = false): string {
  return name === "system-ui" ? 'system-ui, "Segoe UI", sans-serif' : `"${font(name)}", ${code ? 'Consolas, "Cascadia Code", monospace' : 'system-ui, "Segoe UI", sans-serif'}`;
}
