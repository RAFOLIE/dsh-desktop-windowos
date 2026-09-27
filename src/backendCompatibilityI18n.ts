import type { Locale } from "./i18n";
type Text = { verified: string; scope: string; migration: string };
const messages: Record<Locale, Text> = {
  zh: { verified: "桌面连接兼容验证版本：", scope: "桌面更新无需升级内核；第三方插件需单独确认兼容性。", migration: "升级至 DSH 0.1.7 会更换插件设置接口，依赖 settingsScope 的旧插件可能无法加载。请先备份配置和会话，并确认插件已适配 0.1.7。内核运行版本验证不代表所有插件加载成功。" },
  "zh-Hant": { verified: "桌面連線相容驗證版本：", scope: "桌面更新無需升級核心；第三方外掛需另行確認相容性。", migration: "升級至 DSH 0.1.7 會更換外掛設定介面，依賴 settingsScope 的舊外掛可能無法載入。請先備份設定和會話，並確認外掛已適配 0.1.7。核心版本驗證不代表所有外掛載入成功。" },
  en: { verified: "Desktop connection tested with:", scope: "Desktop updates do not require a backend upgrade. Check third-party plugin compatibility separately.", migration: "DSH 0.1.7 changes the plugin settings API. Older plugins requiring settingsScope may fail to load. Back up settings and sessions and check plugin support before upgrading. Running-version verification does not confirm that all plugins loaded." },
  ja: { verified: "デスクトップ接続の検証済みバージョン：", scope: "デスクトップの更新にバックエンド更新は不要です。外部プラグインの互換性は別途確認してください。", migration: "DSH 0.1.7 はプラグイン設定 API を変更します。settingsScope に依存する旧プラグインは読み込めない場合があります。設定と会話をバックアップし、互換性を確認してください。実行バージョンの検証は全プラグインの正常動作を保証しません。" },
  ko: { verified: "데스크톱 연결 검증 버전:", scope: "데스크톱 업데이트에 백엔드 업그레이드는 필요하지 않습니다. 외부 플러그인 호환성은 별도로 확인하세요.", migration: "DSH 0.1.7은 플러그인 설정 API를 변경합니다. settingsScope를 사용하는 이전 플러그인은 로드되지 않을 수 있습니다. 설정과 대화를 백업하고 호환성을 확인하세요. 실행 버전 검증이 모든 플러그인의 로드를 보장하지는 않습니다." },
  ru: { verified: "Подключение проверено с версиями:", scope: "Обновление оболочки не требует обновления ядра. Совместимость сторонних плагинов проверяется отдельно.", migration: "DSH 0.1.7 меняет API настроек плагинов. Старые плагины с settingsScope могут не загрузиться. Сохраните резервную копию настроек и сессий и проверьте совместимость. Проверка версии ядра не подтверждает загрузку всех плагинов." },
};
export const compatibilityText = (locale: Locale) => messages[locale];
