import type { Locale } from "./i18n";
const en = {
  confirming: "Confirming target version", elapsed: "Waiting {seconds}s", budget: "Up to {seconds}s",
  stage: "Failed stage", reset: "The npm registry connection was reset (ECONNRESET). Retry when the connection is stable.",
  timeout: "The npm request exceeded its time limit. Check your connection and retry.",
  missing: "The selected version is not available from the official npm registry. Check available versions again.",
  network: "Cannot connect to the official npm registry. Check your network or proxy settings.",
  other: "This update step failed. See the diagnostic details and logs before retrying.",
  unchanged: "Installation has not started. This attempt did not change the installed version.",
  inspect: "Installation was attempted. Check the installed and running versions before retrying.",
  details: "Diagnostic details", retry: "Retry update", logs: "View logs",
  sourceChanged: "The installation or version changed. Check the refreshed information before continuing.",
};
type Messages = typeof en;
const messages: Record<Locale, Messages> = {
  en,
  zh: {
    confirming: "正在确认目标版本", elapsed: "已等待 {seconds} 秒", budget: "最多等待 {seconds} 秒",
    stage: "失败阶段", reset: "连接 npm 官方仓库时被重置（ECONNRESET），请在网络恢复后重试。",
    timeout: "npm 请求超过等待上限，请检查网络后重试。",
    missing: "npm 官方仓库中没有查询到目标版本，请重新检测可用版本。",
    network: "无法连接 npm 官方仓库，请检查网络或代理设置。",
    other: "此更新步骤失败，请查看诊断详情和日志后再重试。",
    unchanged: "尚未开始安装，本次操作未改变已安装版本。",
    inspect: "本次已尝试安装，请核对安装及运行版本后再重试。",
    details: "诊断详情", retry: "重试更新", logs: "查看日志",
    sourceChanged: "安装来源或版本已变化，请核对刷新后的信息再继续。",
  },
  "zh-Hant": {
    confirming: "正在確認目標版本", elapsed: "已等待 {seconds} 秒", budget: "最多等待 {seconds} 秒",
    stage: "失敗階段", reset: "連線 npm 官方倉庫時被重設（ECONNRESET），請在網路恢復後重試。",
    timeout: "npm 請求超過等待上限，請檢查網路後重試。", missing: "npm 官方倉庫中沒有查到目標版本，請重新偵測。",
    network: "無法連線 npm 官方倉庫，請檢查網路或代理設定。", other: "此更新步驟失敗，請查看診斷詳情與日誌後重試。",
    unchanged: "尚未開始安裝，本次操作未變更已安裝版本。", inspect: "本次已嘗試安裝，請核對安裝與執行版本後重試。",
    details: "診斷詳情", retry: "重試更新", logs: "查看日誌", sourceChanged: "安裝來源或版本已變更，請核對重新整理後的資訊。",
  },
  ja: {
    confirming: "対象バージョンを確認中", elapsed: "待機時間 {seconds} 秒", budget: "最大 {seconds} 秒",
    stage: "失敗した段階", reset: "npm 公式レジストリとの接続がリセットされました（ECONNRESET）。接続回復後に再試行してください。",
    timeout: "npm リクエストがタイムアウトしました。接続を確認して再試行してください。", missing: "対象バージョンが npm 公式レジストリに見つかりません。再確認してください。",
    network: "npm 公式レジストリに接続できません。ネットワークやプロキシを確認してください。", other: "更新に失敗しました。診断詳細とログを確認してください。",
    unchanged: "インストールは開始されていません。今回の操作によるバージョン変更はありません。", inspect: "インストールを試行しました。インストール済み・実行中のバージョンを確認してください。",
    details: "診断詳細", retry: "更新を再試行", logs: "ログを表示", sourceChanged: "インストール元またはバージョンが変わりました。最新の情報を確認してください。",
  },
  ko: {
    confirming: "대상 버전 확인 중", elapsed: "{seconds}초 대기", budget: "최대 {seconds}초",
    stage: "실패 단계", reset: "npm 공식 레지스트리 연결이 초기화되었습니다(ECONNRESET). 연결 복구 후 다시 시도하세요.",
    timeout: "npm 요청 시간이 초과되었습니다. 네트워크를 확인하세요.", missing: "npm 공식 레지스트리에서 대상 버전을 찾지 못했습니다. 다시 확인하세요.",
    network: "npm 공식 레지스트리에 연결할 수 없습니다. 네트워크 또는 프록시를 확인하세요.", other: "업데이트 단계가 실패했습니다. 진단 정보와 로그를 확인하세요.",
    unchanged: "설치를 시작하지 않았습니다. 이번 작업으로 설치된 버전은 변경되지 않았습니다.", inspect: "설치를 시도했습니다. 설치 및 실행 버전을 확인한 후 다시 시도하세요.",
    details: "진단 정보", retry: "업데이트 재시도", logs: "로그 보기", sourceChanged: "설치 소스 또는 버전이 변경되었습니다. 갱신된 정보를 확인하세요.",
  },
  ru: {
    confirming: "Проверка целевой версии", elapsed: "Ожидание: {seconds} с", budget: "Не более {seconds} с",
    stage: "Этап сбоя", reset: "Соединение с официальным реестром npm сброшено (ECONNRESET). Повторите после восстановления связи.",
    timeout: "Истекло время ожидания npm. Проверьте соединение и повторите.", missing: "Целевая версия не найдена в официальном реестре npm. Проверьте доступные версии.",
    network: "Нет соединения с официальным реестром npm. Проверьте сеть или прокси.", other: "Ошибка на этом этапе обновления. Проверьте диагностику и журнал.",
    unchanged: "Установка ещё не началась. Эта попытка не изменила установленную версию.", inspect: "Установка была запущена. Проверьте установленную и работающую версии перед повтором.",
    details: "Диагностика", retry: "Повторить обновление", logs: "Открыть журнал", sourceChanged: "Источник установки или версия изменились. Проверьте обновлённые сведения.",
  },
};
export const updateProgressText = (locale: Locale) => messages[locale];
