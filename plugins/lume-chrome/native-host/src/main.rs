mod app_server;mod assets;mod config;mod diagnostics;mod framing;mod protocol;
use anyhow::{anyhow,Result};
use base64::{engine::general_purpose::STANDARD,Engine};
use futures_util::{SinkExt,StreamExt};
use serde_json::{json,Value};
use std::{io::{stdin,stdout},sync::Arc,time::Duration};
use tokio::{sync::{mpsc,oneshot,Mutex},time::Instant};
use tokio_tungstenite::tungstenite::Message;
use protocol::{APP_SERVER_PROTOCOL_VERSION,NATIVE_HOST_PROTOCOL_VERSION};

const INITIAL_APP_SERVER_WAIT:Duration=Duration::from_secs(5);
const APP_SERVER_RETRY_DELAY:Duration=Duration::from_millis(250);

#[tokio::main]
async fn main()->Result<()> {
    let config=config::HostConfig::load().unwrap_or(config::HostConfig{schema_version:1,channel:"dev".into(),extension_id:String::new(),app_server_url:Some("ws://127.0.0.1:43127/browser".into()),app_server_command:None,app_server_args:None,browser_client_path:None,lume_cli_path:None,proxy_host:None,proxy_port:None,asset_root:None});
    let app=app_server::AppServerClient::new(config.app_server_url.clone().unwrap_or_else(||"ws://127.0.0.1:43127/browser".into()),config.app_server_command.clone(),config.app_server_args.clone().unwrap_or_default());
    let assets=Arc::new(Mutex::new(assets::AssetStore::new(config.default_asset_root())?));
    let(native_tx,mut native_rx)=mpsc::channel::<Value>(128);let(out_tx,mut out_rx)=mpsc::channel::<Value>(128);
    let(stdin_closed_tx,mut stdin_closed_rx)=oneshot::channel::<()>();
    std::thread::spawn(move||{let mut input=stdin().lock();loop{match framing::read_message(&mut input){Ok(Some(bytes))=>match serde_json::from_slice::<Value>(&bytes){Ok(value)=>{if native_tx.blocking_send(value).is_err(){break;}},Err(error)=>{let _=native_tx.blocking_send(json!({"jsonrpc":"2.0","method":"host.decode_error","params":{"message":error.to_string()}}));}},Ok(None)=>break,Err(_)=>break}}let _=stdin_closed_tx.send(());});
    std::thread::spawn(move||{let mut output=stdout().lock();while let Some(value)=out_rx.blocking_recv(){if let Ok(bytes)=serde_json::to_vec(&value){if framing::write_message(&mut output,&bytes).is_err(){break;}}}});
    let connect_deadline=Instant::now()+INITIAL_APP_SERVER_WAIT;
    let socket=loop{
        let remaining=connect_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero(){return Ok(())}
        let connect=tokio::time::timeout(remaining,app.connect());
        match tokio::select!{_=&mut stdin_closed_rx=>return Ok(()),result=connect=>result}{
            Ok(Ok(socket))=>break socket,
            Ok(Err(error))=>{let _=out_tx.send(status_notification("reconnecting",Some(error.to_string()))).await;},
            Err(_)=>return Ok(())
        }
        let remaining=connect_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero(){return Ok(())}
        tokio::select!{_=&mut stdin_closed_rx=>return Ok(()),_=tokio::time::sleep(APP_SERVER_RETRY_DELAY.min(remaining))=>{}}
    };
    let _=out_tx.send(status_notification("connected",None)).await;
    let(mut ws_write,mut ws_read)=socket.split();
    loop{
        tokio::select!{
            _=&mut stdin_closed_rx=>return Ok(()),
            maybe_native=native_rx.recv()=>{
                let Some(message)=maybe_native else{return Ok(())};
                if is_local_method(&message){let response=handle_local(&assets,&config,message).await;let _=out_tx.send(response).await;continue;}
                if ws_write.send(Message::Text(serde_json::to_string(&message)?.into())).await.is_err(){return Ok(())}
            }
            maybe_frame=ws_read.next()=>{
                match maybe_frame{
                    Some(Ok(Message::Text(text)))=>{if let Ok(value)=serde_json::from_str::<Value>(&text){let _=out_tx.send(value).await;}},
                    Some(Ok(Message::Binary(bytes)))=>{if let Ok(value)=serde_json::from_slice::<Value>(&bytes){let _=out_tx.send(value).await;}},
                    Some(Ok(Message::Ping(data)))=>{if ws_write.send(Message::Pong(data)).await.is_err(){return Ok(())}},
                    Some(Ok(Message::Close(_)))|None=>return Ok(()),
                    Some(Err(error))=>{let _=out_tx.send(status_notification("disconnected",Some(error.to_string()))).await;return Ok(())},
                    _=>{}
                }
            }
        }
    }
}
fn is_local_method(message:&Value)->bool{message.get("method").and_then(Value::as_str).map(|m|matches!(m,"host.ping"|"host.hello"|"host.asset.create"|"host.asset.append"|"host.asset.finish"|"host.asset.abort"|"host.asset.remove")).unwrap_or(false)}
fn status_notification(status:&str,error:Option<String>)->Value{json!({"jsonrpc":"2.0","method":"host.status","params":{"status":status,"error":error,"at":chrono_like_now()}})}
fn chrono_like_now()->u128{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()}
async fn handle_local(assets:&Arc<Mutex<assets::AssetStore>>,config:&config::HostConfig,message:Value)->Value{
    let id=message.get("id").cloned().unwrap_or(Value::Null);let method=message.get("method").and_then(Value::as_str).unwrap_or("");let params=message.get("params").cloned().unwrap_or_else(||json!({}));
    let result:Result<Value>=async{match method{
        "host.ping"|"host.hello"=>Ok(json!({"nativeHostProtocolVersion":NATIVE_HOST_PROTOCOL_VERSION,"appServerProtocolVersion":APP_SERVER_PROTOCOL_VERSION,"host":"com.lume.browser","channel":config.channel,"configuredAppServer":config.app_server_url.is_some()})),
        "host.asset.create"=>{let name=params.get("name").and_then(Value::as_str).unwrap_or("asset.bin");let size=params.get("size").and_then(Value::as_u64);let(id,path)=assets.lock().await.create(name,size)?;Ok(json!({"assetId":id,"path":path}))},
        "host.asset.append"=>{let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;let data=params.get("dataBase64").and_then(Value::as_str).ok_or_else(||anyhow!("dataBase64 is required"))?;let bytes=STANDARD.decode(data)?;let written=assets.lock().await.append(asset_id,&bytes)?;Ok(json!({"assetId":asset_id,"written":written}))},
        "host.asset.finish"=>{let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;let path=assets.lock().await.finish(asset_id)?;Ok(json!({"assetId":asset_id,"path":path}))},
        "host.asset.abort"=>{let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;assets.lock().await.abort(asset_id);Ok(json!({"assetId":asset_id,"aborted":true}))},
        "host.asset.remove"=>{let asset_id=params.get("assetId").and_then(Value::as_str).ok_or_else(||anyhow!("assetId is required"))?;assets.lock().await.remove(asset_id);Ok(json!({"assetId":asset_id,"removed":true}))},
        _=>Err(anyhow!("unsupported local host method: {method}"))
    }}.await;
    match result{Ok(value)=>json!({"jsonrpc":"2.0","id":id,"result":value}),Err(error)=>json!({"jsonrpc":"2.0","id":id,"error":{"code":"E_NATIVE_HOST","message":error.to_string(),"recoverable":true}})}
}
