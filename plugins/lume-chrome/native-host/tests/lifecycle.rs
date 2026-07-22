use serde_json::json;
use std::{
    fs,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{net::TcpListener, process::Command, time::timeout};
use tokio_tungstenite::accept_async;

#[tokio::test]
async fn exits_when_lume_bridge_closes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let config_path = write_config(format!("ws://{address}"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_lume-chrome-host"))
        .env("LUME_CHROME_HOST_CONFIG", &config_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let _chrome_stdin = child.stdin.take().unwrap();

    let (stream, _) = timeout(Duration::from_secs(2), listener.accept())
        .await
        .expect("Native Host did not connect to the Lume bridge")
        .unwrap();
    let mut socket = accept_async(stream).await.unwrap();
    socket.close(None).await.unwrap();

    let status = timeout(Duration::from_secs(2), child.wait())
        .await
        .expect("Native Host remained alive after the Lume bridge closed")
        .unwrap();
    assert!(status.success());
    fs::remove_file(config_path).unwrap();
}

fn write_config(app_server_url: String) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("lume-chrome-host-lifecycle-{suffix}.json"));
    fs::write(
        &path,
        serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "channel": "test",
            "extensionId": "abcdefghijklmnopabcdefghijklmnop",
            "appServerUrl": app_server_url,
            "appServerCommand": null,
            "appServerArgs": [],
            "browserClientPath": null,
            "lumeCliPath": null,
            "proxyHost": null,
            "proxyPort": null,
            "assetRoot": null
        }))
        .unwrap(),
    )
    .unwrap();
    path
}
