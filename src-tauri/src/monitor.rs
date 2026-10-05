//! Listens to the DSH web event stream and fires a Windows notification when a
//! session finishes (running true→false) while the main window is hidden, minimized or not focused.
//!
//! dsh 0.1.2 moved every Remote stream onto one mux WebSocket
//! (`/api/remote.mux`, issue #18) behind BrowserAuth: the shell exchanges the
//! child's launch token for a browser-session cookie (see dsh.rs) and this
//! module opens the gateway's `$events` logical stream on the mux with that
//! cookie. Session edges arrive as `emit` frames — `api-session/status`
//! (sessionId, running), `api-session/added` (summary), `api-session/removed`
//! (sessionId) — and only the true→false edge fires, so steady idle never
//! re-fires.

use std::collections::HashMap;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_winrt_notification::{Duration as ToastDuration, Toast};
use tungstenite::client::IntoClientRequest;
use tungstenite::{connect, Message};
use uuid::Uuid;

const MUX_URL: &str = "ws://127.0.0.1:3080/api/remote.mux";
const HOST_ORIGIN: &str = "http://127.0.0.1:3080";
const DSH_BASE: &str = "http://127.0.0.1:3080";

/// One session-relevant item unpacked from a mux `emit` frame.
#[derive(Debug, PartialEq, Eq)]
enum SessionEvent {
    Status { session_id: String, running: bool },
    Added { session_id: String, running: Option<bool> },
    Removed { session_id: String },
}

/// What one mux text frame asks of us: a session event, closing our logical
/// stream, or nothing (ready frames, other streams, unknown shapes).
#[derive(Debug, PartialEq, Eq)]
enum FrameOutcome {
    Event(SessionEvent),
    End,
    Ready(String),
    Passive(String),
    Failed,
    Ignore,
}

/// Run the monitor until the app exits. Reconnects with capped backoff; the WS
/// connection succeeding doubles as the shared "DSH is alive" signal — no second
/// health-check is needed alongside the lifecycle probe.
pub fn run(app: AppHandle) {
    let baseline: Mutex<HashMap<String, Option<bool>>> = Mutex::new(HashMap::new());
    let mut attempt: u32 = 0;
    // A missing/stale browser-session cookie (401/403 handshake) flips us into
    // a quiet poll instead of a hot reconnect loop — the cookie arrives with
    // the webchat auth flow and we pick it up on the next attempt.
    let mut auth_silenced = false;
    // One Warn line per failure streak, not one per retry: a dsh restart
    // would otherwise log its whole downtime twice a second.
    let mut failure_logged = false;
    loop {
        attempt = attempt.saturating_add(1);
        let Some(cookie) = crate::dsh::session_cookie_pair() else {
            if !auth_silenced {
                auth_silenced = true;
                crate::dsh::log_write(
                    crate::dsh::LogLevel::Info,
                    "monitor: no browser-session cookie yet; session toasts paused until webchat auth plants one",
                );
            }
            thread::sleep(Duration::from_secs(15));
            continue;
        };
        match connect_and_listen(&app, &baseline, &cookie) {
            Ok(()) => {
                // Orderly close — reset and reconnect fresh.
                attempt = 0;
                auth_silenced = false;
                failure_logged = false;
                baseline.lock().unwrap().clear();
            }
            Err(err) => {
                // DSH gone (or not up yet) — drop the baseline so the next first
                // wave rebuilds it without mis-firing an edge.
                baseline.lock().unwrap().clear();
                let unauthorized = err
                    .downcast_ref::<tungstenite::Error>()
                    .is_some_and(|e| {
                        matches!(e, tungstenite::Error::Http(resp)
                            if matches!(resp.status().as_u16(), 401 | 403))
                    });
                if unauthorized {
                    if !auth_silenced {
                        auth_silenced = true;
                        crate::dsh::log_write(
                            crate::dsh::LogLevel::Info,
                            "monitor: dsh web rejected the session cookie; session toasts paused until webchat auth refreshes it",
                        );
                    }
                } else if !failure_logged {
                    // Never swallow protocol/IO breakage again (issue #18: the
                    // dead events.host route hung up without an HTTP response,
                    // so the old 401-only classifier said nothing for months).
                    failure_logged = true;
                    crate::dsh::log_write(
                        crate::dsh::LogLevel::Warn,
                        &format!("monitor: event stream unavailable ({err}); retrying"),
                    );
                }
            }
        }
        let delay = if auth_silenced {
            // Still a poll — webchat auth usually lands within the first minute.
            Duration::from_secs(15)
        } else {
            // Backoff: 0.5s, 1s, 2s, 4s, 8s, capped at 10s.
            let exp = attempt.saturating_sub(1).min(4);
            Duration::from_millis((500u64 * 2u64.pow(exp)).min(10_000))
        };
        thread::sleep(delay);
    }
}

/// Connect to the mux, open the `$events` stream and read until the socket or
/// the logical stream closes. Err when the handshake or the transport fails.
fn connect_and_listen(
    app: &AppHandle,
    baseline: &Mutex<HashMap<String, Option<bool>>>,
    cookie: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Build the handshake from the URL via tungstenite's own request type
    // (avoids any http-crate version mismatch), then add Origin to satisfy the
    // /api trust fence and the cookie to pass it. Host is already
    // `127.0.0.1:3080` from the URL; a non-browser client carries no
    // sec-fetch-site, so Host+Origin suffices.
    let mut request = MUX_URL.into_client_request()?;
    request.headers_mut().insert(
        http::header::ORIGIN,
        http::HeaderValue::from_str(HOST_ORIGIN)?,
    );
    request.headers_mut().insert(
        http::header::COOKIE,
        http::HeaderValue::from_str(&cookie)?,
    );

    let (mut socket, _response) = connect(request)?;
    // Open the gateway-internal forwarded-event stream: one logical stream
    // carrying `ready` + `emit` items (verified live against dsh web).
    let stream_id = Uuid::new_v4().to_string();
    let open = json!({
        "type": "open",
        "streamId": stream_id,
        "endpoint": "$events",
        "payload": { "args": {} }
    });
    socket.send(Message::text(open.to_string()))?;
    socket.flush()?;
    let mut client_id = None;
    loop {
        match socket.read()? {
            Message::Text(text) => match frame_outcome(&text, &stream_id) {
                FrameOutcome::Event(event) => {
                    if let Some(finished) = apply_event(baseline, event) {
                        on_task_finished(app, &finished);
                    }
                }
                FrameOutcome::Ready(id) => {
                    client_id = Some(id);
                    crate::dsh::log_write(crate::dsh::LogLevel::Info, "monitor: event stream ready");
                },
                FrameOutcome::Passive(event_id) => {
                    let id = client_id.as_deref().ok_or("event arrived before ready")?;
                    // A notification observer must decline interactive waterfall
                    // events, otherwise it can hold up the real web client's flow.
                    ureq::post(&format!("{DSH_BASE}/api/$events/result"))
                        .set("Origin", HOST_ORIGIN).set("Cookie", cookie)
                        .timeout(Duration::from_secs(3))
                        .send_json(json!({"type":"client-request","rpcId":Uuid::new_v4().to_string(),"method":"$events/result",
                            "payload":{"args":{"clientId":id,"eventId":event_id,"outcome":{"kind":"next"}}}}))
                        .map_err(|_| "unable to decline non-notification event")?;
                },
                FrameOutcome::Failed => return Err("logical event stream rejected".into()),
                FrameOutcome::End => break,
                FrameOutcome::Ignore => {}
            },
            Message::Close(_) => break,
            _ => {}
        }
    }
    Ok(())
}

/// Classify one mux text frame. `{"type":"item","streamId",…}` on our stream
/// carries a downlink value — only `emit` items with the session event names
/// matter here; `end` on our stream closes it; everything else is noise.
fn frame_outcome(text: &str, stream_id: &str) -> FrameOutcome {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return FrameOutcome::Ignore;
    };
    let frame_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if frame_type == "error" && value.get("streamId").and_then(|v| v.as_str()) == Some(stream_id) {
        return FrameOutcome::Failed;
    }
    if frame_type == "end" && value.get("streamId").and_then(|v| v.as_str()) == Some(stream_id) {
        return FrameOutcome::End;
    }
    if frame_type != "item"
        || value.get("streamId").and_then(|v| v.as_str()) != Some(stream_id)
    {
        return FrameOutcome::Ignore;
    }
    let Some(item) = value.get("value") else {
        return FrameOutcome::Ignore;
    };
    if item.get("type").and_then(|t| t.as_str()) == Some("ready") {
        return item.get("clientId").and_then(Value::as_str)
            .map(|id| FrameOutcome::Ready(id.to_owned())).unwrap_or(FrameOutcome::Failed);
    }
    if item.get("type").and_then(|t| t.as_str()) == Some("waterfall") {
        return item.get("eventId").and_then(Value::as_str)
            .map(|id| FrameOutcome::Passive(id.to_owned())).unwrap_or(FrameOutcome::Failed);
    }
    if item.get("type").and_then(|t| t.as_str()) != Some("emit") {
        return FrameOutcome::Ignore;
    }
    let Some(event) = item.get("event").and_then(|e| e.as_str()) else {
        return FrameOutcome::Ignore;
    };
    let Some(args) = item.get("args").and_then(|a| a.as_array()) else {
        return FrameOutcome::Ignore;
    };
    match event {
        // api-session/status(sessionId: SessionId, running: boolean)
        "api-session/status" => {
            let Some(session_id) = args.first().and_then(|v| v.as_str()) else {
                return FrameOutcome::Ignore;
            };
            let Some(running) = args.get(1).and_then(|v| v.as_bool()) else {
                return FrameOutcome::Ignore;
            };
            FrameOutcome::Event(SessionEvent::Status {
                session_id: session_id.to_string(),
                running,
            })
        }
        // api-session/added(summary: SessionSummary)
        "api-session/added" => {
            let Some(session_id) = args
                .first()
                .and_then(|v| v.get("sessionId"))
                .and_then(|v| v.as_str())
            else {
                return FrameOutcome::Ignore;
            };
            FrameOutcome::Event(SessionEvent::Added {
                running: args.first().and_then(|v| v.get("running")).and_then(Value::as_bool),
                session_id: session_id.to_string(),
            })
        }
        // api-session/removed(sessionId: SessionId)
        "api-session/removed" => {
            let Some(session_id) = args.first().and_then(|v| v.as_str()) else {
                return FrameOutcome::Ignore;
            };
            FrameOutcome::Event(SessionEvent::Removed {
                session_id: session_id.to_string(),
            })
        }
        _ => FrameOutcome::Ignore,
    }
}

/// Update the per-session baseline with one event; `Some(id)` when the event
/// is the true→false edge of a known-running session (a fresh baseline merely
/// records — the first wave after connect never fires).
fn apply_event(
    baseline: &Mutex<HashMap<String, Option<bool>>>,
    event: SessionEvent,
) -> Option<String> {
    match event {
        SessionEvent::Status { session_id, running } => {
            let prev = {
                let mut map = baseline.lock().unwrap();
                let prev = map.get(&session_id).copied().flatten();
                map.insert(session_id.clone(), Some(running));
                prev
            };
            (prev == Some(true) && !running).then_some(session_id)
        }
        SessionEvent::Added { session_id, running } => {
            // This is also emitted on agent availability changes, not only
            // session creation. Never overwrite a known running edge with idle.
            let mut map = baseline.lock().unwrap();
            let current = map.entry(session_id).or_insert(running);
            if running == Some(true) { *current = Some(true); }
            None
        }
        SessionEvent::Removed { session_id } => {
            baseline.lock().unwrap().remove(&session_id);
            None
        }
    }
}

/// A session finished. Notify only if the user isn't already looking at it.
fn suppress_notification(visible: bool, minimized: bool, focused: bool) -> bool {
    visible && !minimized && focused
}

fn on_task_finished(app: &AppHandle, session_id: &str) {
    let viewing = app.get_webview_window("main").is_some_and(|w| {
        suppress_notification(w.is_visible().unwrap_or(false),
            w.is_minimized().unwrap_or(false), w.is_focused().unwrap_or(false))
    });
    if viewing {
        crate::dsh::log_write(crate::dsh::LogLevel::Info, "monitor: completion observed; foreground window suppresses toast");
        return;
    }
    crate::dsh::log_write(crate::dsh::LogLevel::Info, "monitor: completion observed; submitting toast");

    let title = resolve_session_title(session_id)
        .unwrap_or_else(|| {
            crate::dsh::ui_txt6("一个会话", "一個會話", "a session", "セッション", "세션", "сеанс")
                .to_string()
        });
    let body = format!(
        "{}:{title}",
        crate::dsh::ui_txt6("任务已完成", "任務已完成", "Task finished", "タスク完了", "작업 완료", "Задача завершена")
    );

    let app2 = app.clone();
    // Short duration: the banner auto-collapses into Action Center if not tapped.
    // "ack" collapses the banner (any action click dismisses it); "open window"
    // restores + focuses the window via the in-process activation callback.
    let result = Toast::new(crate::TOAST_AUMID)
        .title("DSH")
        .text1(&body)
        .duration(ToastDuration::Short)
        .add_button(
            crate::dsh::ui_txt6("打开窗口", "開啟視窗", "Open window", "ウィンドウを開く", "창 열기", "Открыть окно"),
            "open",
        )
        .add_button(
            crate::dsh::ui_txt6("明白", "明白", "Got it", "OK", "확인", "Понятно"),
            "ack",
        )
        .on_activated(move |action| {
            if action.as_deref() == Some("open") {
                crate::show_main_window(&app2);
            }
            Ok(())
        })
        .show();
    if result.is_err() {
        crate::dsh::log_write(crate::dsh::LogLevel::Warn, "monitor: Windows rejected completion toast");
    }
}

/// Look up a session's display title for the notification body via the
/// gateway's session/list RPC. Falls back to None when DSH is unreachable,
/// the cookie is missing, or the session is gone.
fn resolve_session_title(session_id: &str) -> Option<String> {
    let cookie = crate::dsh::session_cookie_pair()?;
    let body = json!({
        "type": "client-request",
        "rpcId": Uuid::new_v4().to_string(),
        "method": "session/list",
        // The gateway validates one args object per endpoint descriptor;
        // session/list takes the SessionListRequest under `_request`
        // (a bare `{}` payload answers gateway/arguments-invalid).
        "payload": { "args": { "_request": {} } }
    });
    let response = ureq::post(&format!("{DSH_BASE}/api/session/list"))
        .set("Origin", HOST_ORIGIN)
        .set("Cookie", &cookie)
        .timeout(Duration::from_secs(3))
        .send_json(body)
        .ok()?;
    let value: Value = response.into_json().ok()?;
    let items = value
        .get("result")?
        .get("value")?
        .get("items")?
        .as_array()?;
    for item in items {
        if item.get("sessionId").and_then(|v| v.as_str()) == Some(session_id) {
            return item
                .get("projections")?
                .get("values")?
                .get("title")?
                .as_str()
                .map(|s| s.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emit(event: &str, args: Value) -> String {
        serde_json::json!({
            "type": "item",
            "streamId": "sid",
            "value": { "type": "emit", "event": event, "args": args }
        })
        .to_string()
    }

    #[test]
    fn status_emit_frame_parses_session_and_running() {
        let frame = emit("api-session/status", serde_json::json!(["s1", false]));
        assert_eq!(
            frame_outcome(&frame, "sid"),
            FrameOutcome::Event(SessionEvent::Status {
                session_id: "s1".into(),
                running: false
            })
        );
    }

    #[test]
    fn added_frame_takes_session_id_from_the_summary() {
        let frame = emit(
            "api-session/added",
            serde_json::json!([{ "sessionId": "s2", "running": false }]),
        );
        assert_eq!(
            frame_outcome(&frame, "sid"),
            FrameOutcome::Event(SessionEvent::Added { session_id: "s2".into(), running: Some(false) })
        );
    }

    #[test]
    fn removed_frame_carries_the_session_id() {
        let frame = emit("api-session/removed", serde_json::json!(["s3"]));
        assert_eq!(
            frame_outcome(&frame, "sid"),
            FrameOutcome::Event(SessionEvent::Removed { session_id: "s3".into() })
        );
    }

    #[test]
    fn ready_frames_other_streams_and_garbage_are_ignored() {
        let ready = serde_json::json!({
            "type": "item", "streamId": "sid",
            "value": { "type": "ready", "clientId": "c", "host": { "home": "h" } }
        })
        .to_string();
        assert_eq!(frame_outcome(&ready, "sid"), FrameOutcome::Ready("c".into()));
        let other = emit("api-session/status", serde_json::json!(["x", true]))
            .replace("\"sid\"", "\"other\"");
        assert_eq!(frame_outcome(&other, "sid"), FrameOutcome::Ignore);
        assert_eq!(frame_outcome("not json", "sid"), FrameOutcome::Ignore);
        let waterfall = emit(
            "approval/request",
            serde_json::json!([{}]),
        )
        .replace("\"item\"", "\"waterfall-frame\"");
        assert_eq!(frame_outcome(&waterfall, "sid"), FrameOutcome::Ignore);
    }

    #[test]
    fn end_frame_on_our_stream_closes_the_stream() {
        let end = serde_json::json!({ "type": "end", "streamId": "sid" }).to_string();
        assert_eq!(frame_outcome(&end, "sid"), FrameOutcome::End);
        let end_other = serde_json::json!({ "type": "end", "streamId": "other" }).to_string();
        assert_eq!(frame_outcome(&end_other, "sid"), FrameOutcome::Ignore);
    }

    #[test]
    fn only_the_true_to_false_edge_fires() {
        let baseline = Mutex::new(HashMap::new());
        let status = |id: &str, running: bool| {
            SessionEvent::Status {
                session_id: id.to_string(),
                running,
            }
        };
        // Unknown session: baseline only, no fire — the first wave after
        // connect never toasts.
        assert_eq!(apply_event(&baseline, status("a", false)), None);
        assert_eq!(apply_event(&baseline, status("a", true)), None);
        assert_eq!(apply_event(&baseline, status("a", false)), Some("a".into()));
        // Steady idle never re-fires.
        assert_eq!(apply_event(&baseline, status("a", false)), None);
        // A newly added session starts idle: a later finish still fires.
        assert_eq!(apply_event(&baseline, SessionEvent::Added { session_id: "b".into(), running: Some(false) }), None);
        assert_eq!(apply_event(&baseline, status("b", true)), None);
        assert_eq!(apply_event(&baseline, status("b", false)), Some("b".into()));
        // Removed sessions forget their baseline.
        assert_eq!(apply_event(&baseline, SessionEvent::Removed { session_id: "b".into() }), None);
        assert_eq!(apply_event(&baseline, status("b", false)), None);
    }
    #[test]
    fn availability_refresh_does_not_erase_completion_edge() {
        let baseline = Mutex::new(HashMap::new());
        for frame in [emit("api-session/status", json!(["a", true])),
            emit("api-session/added", json!([{"sessionId":"a","running":false}]))] {
            if let FrameOutcome::Event(event) = frame_outcome(&frame, "sid") {
                assert_eq!(apply_event(&baseline, event), None);
            } else { panic!("official event shape rejected"); }
        }
        let FrameOutcome::Event(done) = frame_outcome(&emit("api-session/status",json!(["a",false])),"sid") else {panic!()};
        assert_eq!(apply_event(&baseline, done), Some("a".into()));
    }
    #[test]
    fn only_visible_unminimized_foreground_suppresses_toast() {
        assert!(suppress_notification(true, false, true));
        assert!(!suppress_notification(true, true, true));
        assert!(!suppress_notification(true, false, false));
        assert!(!suppress_notification(false, false, false));
    }
    #[test]
    fn logical_stream_errors_trigger_reconnect() {
        assert_eq!(frame_outcome(r#"{"type":"error","streamId":"sid"}"#, "sid"),FrameOutcome::Failed);
    }

    #[test]
    fn running_summary_seeds_baseline_and_interactive_events_are_declined() {
        let baseline = Mutex::new(HashMap::new());
        let FrameOutcome::Event(event) = frame_outcome(&emit("api-session/added",json!([{"sessionId":"a","running":true}])),"sid") else {panic!()};
        assert_eq!(apply_event(&baseline,event),None);
        assert_eq!(apply_event(&baseline,SessionEvent::Status{session_id:"a".into(),running:false}),Some("a".into()));
        assert_eq!(frame_outcome(r#"{"type":"item","streamId":"sid","value":{"type":"waterfall","eventId":"evt"}}"#, "sid"),FrameOutcome::Passive("evt".into()));
    }

}
