use anyhow::{Context,Result};
use std::{path::PathBuf,process::Stdio,time::Duration};
use tokio::{net::TcpStream,process::{Child,Command},sync::Mutex};
use tokio_tungstenite::{connect_async,MaybeTlsStream,WebSocketStream};

pub type AppSocket=WebSocketStream<MaybeTlsStream<TcpStream>>;
pub struct AppServerClient { url:String, command:Option<PathBuf>, args:Vec<String>, child:Mutex<Option<Child>> }
impl AppServerClient {
    pub fn new(url:String,command:Option<PathBuf>,args:Vec<String>)->Self{Self{url,command,args,child:Mutex::new(None)}}
    async fn ensure_spawned(&self)->Result<()>{
        if self.command.is_none(){return Ok(());}let mut guard=self.child.lock().await;
        if let Some(child)=guard.as_mut(){if child.try_wait()?.is_none(){return Ok(());}}
        let mut cmd=Command::new(self.command.as_ref().unwrap());cmd.args(&self.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());*guard=Some(cmd.spawn().context("failed to start Lume app server")?);tokio::time::sleep(Duration::from_millis(350)).await;Ok(())
    }
    pub async fn connect(&self)->Result<AppSocket>{self.ensure_spawned().await?;let(socket,_)=connect_async(&self.url).await.with_context(||format!("failed to connect to {}",self.url))?;Ok(socket)}
}
