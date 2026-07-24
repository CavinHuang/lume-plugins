mod app_server;
mod assets;
mod config;
mod diagnostics;
mod framing;
mod pairing;
mod protocol;

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use protocol::{APP_SERVER_PROTOCOL_VERSION, NATIVE_HOST_PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::{
    io::{stdin, stdout},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot, Mutex},
    time::Instant,
};
use uuid::Uuid;

const INITIAL_APP_SERVER_WAIT: Duration = Duration::from_secs(5);
const APP_SERVER_RETRY_DELAY: Duration = Duration::from_millis(250);

struct SecureChannel {
    pairing_key: Vec<u8>,
    pairing_id: String,
    generation: u64,
    transcript: Option<String>,
    nonce_main: Option<String>,
    nonce_host: Option<String>,
    session_key: Option<[u8; 32]>,
    send_sequence: u64,
    receive_sequence: u64,
}

impl SecureChannel {
    fn authenticated(&self) -> bool { self.session_key.is_some() }

    fn encode(&mut self, value: &Value) -> Result<Value> {
        let key = self.session_key.as_ref().ok_or_else(|| anyhow!("secure channel is not authenticated"))?;
        self.send_sequence = self.send_sequence.checked_add(1).ok_or_else(|| anyhow!("frame sequence exhausted"))?;
        let payload = serde_json::to_vec(value)?;
        Ok(json!({
            "sequence": self.send_sequence,
            "payload": URL_SAFE_NO_PAD.encode(&payload),
            "mac": pairing::frame_mac(key, self.send_sequence, &payload)?,
        }))
    }

    fn decode(&mut self, envelope: &Value) -> Result<Value> {
        let key = self.session_key.as_ref().ok_or_else(|| anyhow!("secure channel is not authenticated"))?;
        let sequence = envelope.get("sequence").and_then(Value::as_u64).ok_or_else(|| anyhow!("secure frame sequence is required"))?;
        if sequence != self.receive_sequence + 1 { return Err(anyhow!("secure frame replay or gap")); }
        let encoded = envelope.get("payload").and_then(Value::as_str).ok_or_else(|| anyhow!("secure frame payload is required"))?;
        let payload = URL_SAFE_NO_PAD.decode(encoded).context("invalid secure frame payload")?;
        let mac = envelope.get("mac").and_then(Value::as_str).ok_or_else(|| anyhow!("secure frame MAC is required"))?;
        pairing::verify_frame(key, sequence, &payload, mac)?;
        self.receive_sequence = sequence;
        Ok(serde_json::from_slice(&payload)?)
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    if pairing::run_cli_if_requested()? { return Ok(()); }

    let config = config::HostConfig::load().unwrap_or(config::HostConfig {
        schema_version: 3,
        channel: "dev".into(),
        extension_id: String::new(),
        pipe_endpoint: None,
        pairing_id: None,
        generation: None,
        host_sha256: None,
        browser_client_path: None,
        lume_cli_path: None,
        proxy_host: None,
        proxy_port: None,
        asset_root: None,
    });
    verify_dev_host_hash(config.host_sha256.as_deref())?;
    let pairing_id = config.pairing_id.clone().ok_or_else(|| anyhow!("Lume browser pairing is not configured"))?;
    let generation = config.generation.ok_or_else(|| anyhow!("Lume browser pairing generation is not configured"))?;
    let pairing_key = pairing::load(&pairing_id)?;
    let app = app_server::AppServerClient::new(config.pipe_endpoint.clone());
    let assets = Arc::new(Mutex::new(assets::AssetStore::new(config.default_asset_root())?));
    let (native_tx, mut native_rx) = mpsc::channel::<Value>(128);
    let (out_tx, mut out_rx) = mpsc::channel::<Value>(128);
    let (stdin_closed_tx, mut stdin_closed_rx) = oneshot::channel::<()>();

    std::thread::spawn(move || {
        let mut input = stdin().lock();
        loop {
            match framing::read_message(&mut input) {
                Ok(Some(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => { if native_tx.blocking_send(value).is_err() { break; } }
                    Err(error) => { let _ = native_tx.blocking_send(json!({"jsonrpc":"2.0","method":"host.decode_error","params":{"message":error.to_string()}})); }
                },
                Ok(None) | Err(_) => break,
            }
        }
        let _ = stdin_closed_tx.send(());
    });
    std::thread::spawn(move || {
        let mut output = stdout().lock();
        while let Some(value) = out_rx.blocking_recv() {
            if let Ok(bytes) = serde_json::to_vec(&value) {
                if framing::write_message(&mut output, &bytes).is_err() { break; }
            }
        }
    });

    let connect_deadline = Instant::now() + INITIAL_APP_SERVER_WAIT;
    let socket = loop {
        let remaining = connect_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Ok(()); }
        let connect = tokio::time::timeout(remaining, app.connect());
        match tokio::select! {
            _ = &mut stdin_closed_rx => return Ok(()),
            result = connect => result,
        } {
            Ok(Ok(socket)) => break socket,
            Ok(Err(error)) => { let _ = out_tx.send(status_notification("reconnecting", Some(error.to_string()))).await; }
            Err(_) => return Ok(()),
        }
        let remaining = connect_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Ok(()); }
        tokio::select! {
            _ = &mut stdin_closed_rx => return Ok(()),
            _ = tokio::time::sleep(APP_SERVER_RETRY_DELAY.min(remaining)) => {}
        }
    };
    let _ = out_tx.send(status_notification("connected", None)).await;
    let mut secure = SecureChannel {
        pairing_key,
        pairing_id,
        generation,
        transcript: None,
        nonce_main: None,
        nonce_host: None,
        session_key: None,
        send_sequence: 0,
        receive_sequence: 0,
    };
    let (read, mut write) = tokio::io::split(socket);
    let mut lines = BufReader::new(read).lines();
    loop {
        tokio::select! {
            _ = &mut stdin_closed_rx => return Ok(()),
            maybe_native = native_rx.recv() => {
                let Some(message) = maybe_native else { return Ok(()); };
                if is_local_method(&message) {
                    let response = handle_local(&assets, &config, message).await;
                    let _ = out_tx.send(response).await;
                    continue;
                }
                if secure.authenticated() {
                    let envelope = secure.encode(&message)?;
                    write_json_line(&mut write, &envelope).await?;
                }
            }
            maybe_line = lines.next_line() => {
                match maybe_line {
                    Ok(Some(line)) => {
                        if line.len() > 2 * 1024 * 1024 { return Ok(()); }
                        let value: Value = match serde_json::from_str(&line) { Ok(value) => value, Err(_) => return Ok(()) };
                        if !secure.authenticated() {
                            handle_app_handshake(&mut write, &mut secure, &value).await?;
                        } else {
                            let payload = secure.decode(&value)?;
                            let _ = out_tx.send(payload).await;
                        }
                    }
                    Ok(None) => return Ok(()),
                    Err(error) => {
                        let _ = out_tx.send(status_notification("disconnected", Some(error.to_string()))).await;
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn verify_dev_host_hash(expected: Option<&str>) -> Result<()> {
    use sha2::{Digest, Sha256};
    let expected = expected.ok_or_else(|| anyhow!("Native Host build hash is not configured"))?;
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err(anyhow!("Native Host build hash is invalid")); }
    let bytes = std::fs::read(std::env::current_exe()?)?;
    let actual = Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    if actual.eq_ignore_ascii_case(expected) { Ok(()) } else { Err(anyhow!("Native Host build hash mismatch")) }
}

async fn handle_app_handshake<W: AsyncWrite + Unpin>(writer: &mut W, secure: &mut SecureChannel, value: &Value) -> Result<()> {
    if value.get("method").and_then(Value::as_str) == Some("app.challenge") {
        let params = value.get("params").and_then(Value::as_object).ok_or_else(|| anyhow!("challenge params are required"))?;
        let protocol_version = params.get("protocolVersion").and_then(Value::as_u64).ok_or_else(|| anyhow!("challenge protocol version is required"))?;
        let pairing_id = params.get("pairingId").and_then(Value::as_str).ok_or_else(|| anyhow!("challenge pairing id is required"))?;
        let generation = params.get("generation").and_then(Value::as_u64).ok_or_else(|| anyhow!("challenge generation is required"))?;
        let nonce_main = params.get("nonceMain").and_then(Value::as_str).ok_or_else(|| anyhow!("challenge nonce is required"))?;
        if protocol_version != APP_SERVER_PROTOCOL_VERSION as u64 { return Err(anyhow!("app server protocol mismatch")); }
        if pairing_id != secure.pairing_id || generation != secure.generation { return Err(anyhow!("pairing generation mismatch")); }
        if !(16..=128).contains(&nonce_main.len()) || !nonce_main.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') { return Err(anyhow!("challenge nonce is invalid")); }
        let nonce_host = Uuid::new_v4().simple().to_string();
        let host_build = env!("CARGO_PKG_VERSION");
        let transcript = format!("{}|{}|{}|{}|{}|{}", APP_SERVER_PROTOCOL_VERSION, pairing_id, generation, nonce_main, nonce_host, host_build);
        let proof = pairing::sign(&secure.pairing_key, "host", &transcript)?;
        secure.transcript = Some(transcript);
        secure.nonce_main = Some(nonce_main.to_owned());
        secure.nonce_host = Some(nonce_host.clone());
        write_json_line(writer, &json!({
            "jsonrpc": "2.0",
            "id": "native-host-hello",
            "method": "app.hello",
            "params": {
                "pairingId": pairing_id,
                "generation": generation,
                "nonceHost": nonce_host,
                "hostBuild": host_build,
                "proofHost": proof,
                "appServerProtocolVersion": APP_SERVER_PROTOCOL_VERSION,
                "nativeHostProtocolVersion": NATIVE_HOST_PROTOCOL_VERSION,
            }
        })).await?;
        return Ok(());
    }
    if value.get("id").and_then(Value::as_str) == Some("native-host-hello") {
        let result = value.get("result").and_then(Value::as_object).ok_or_else(|| anyhow!("main pairing proof is required"))?;
        let proof = result.get("proofMain").and_then(Value::as_str).ok_or_else(|| anyhow!("main pairing proof is required"))?;
        let transcript = secure.transcript.as_deref().ok_or_else(|| anyhow!("pairing transcript is missing"))?;
        pairing::verify(&secure.pairing_key, "main", transcript, proof)?;
        secure.session_key = Some(pairing::derive_session_key(
            &secure.pairing_key,
            secure.nonce_main.as_deref().unwrap_or_default(),
            secure.nonce_host.as_deref().unwrap_or_default(),
        )?);
        return Ok(());
    }
    Err(anyhow!("unexpected unauthenticated app frame"))
}

async fn write_json_line<W: AsyncWrite + Unpin>(writer: &mut W, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

fn is_local_method(message: &Value) -> bool {
    message.get("method").and_then(Value::as_str).map(|method| matches!(method,
        "host.ping" | "host.hello" | "host.asset.create" | "host.asset.append" |
        "host.asset.finish" | "host.asset.abort" | "host.asset.remove"
    )).unwrap_or(false)
}

fn status_notification(status: &str, error: Option<String>) -> Value {
    json!({"jsonrpc":"2.0","method":"host.status","params":{"status":status,"error":error,"at":chrono_like_now()}})
}

fn chrono_like_now() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()
}

async fn handle_local(assets: &Arc<Mutex<assets::AssetStore>>, config: &config::HostConfig, message: Value) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    let result: Result<Value> = async {
        match method {
            "host.ping" | "host.hello" => Ok(json!({"nativeHostProtocolVersion":NATIVE_HOST_PROTOCOL_VERSION,"appServerProtocolVersion":APP_SERVER_PROTOCOL_VERSION,"host":"com.lume.browser","channel":config.channel,"configuredPipe":config.pipe_endpoint.is_some(),"pairingId":config.pairing_id})),
            "host.asset.create" => { let name=params.get("name").and_then(Value::as_str).unwrap_or("asset.bin");let size=params.get("size").and_then(Value::as_u64);let(id,path)=assets.lock().await.create(name,size)?;Ok(json!({"assetId":id,"path":path})) },
            "host.asset.append" => { let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;let data=params.get("dataBase64").and_then(Value::as_str).ok_or_else(||anyhow!("dataBase64 is required"))?;let bytes=base64::engine::general_purpose::STANDARD.decode(data)?;let written=assets.lock().await.append(asset_id,&bytes)?;Ok(json!({"assetId":asset_id,"written":written})) },
            "host.asset.finish" => { let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;let path=assets.lock().await.finish(asset_id)?;Ok(json!({"assetId":asset_id,"path":path})) },
            "host.asset.abort" => { let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;assets.lock().await.abort(asset_id);Ok(json!({"assetId":asset_id,"aborted":true})) },
            "host.asset.remove" => { let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;assets.lock().await.remove(asset_id);Ok(json!({"assetId":asset_id,"removed":true})) },
            _ => Err(anyhow!("unsupported local host method: {method}")),
        }
    }.await;
    match result {
        Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
        Err(error) => json!({"jsonrpc":"2.0","id":id,"error":{"code":"E_NATIVE_HOST","message":error.to_string(),"recoverable":true}}),
    }
}
