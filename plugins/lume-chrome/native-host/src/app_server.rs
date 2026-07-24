use anyhow::{Context,Result};
use tokio::io::{AsyncRead,AsyncWrite};

pub trait AppStream:AsyncRead+AsyncWrite+Unpin+Send{}
impl<T:AsyncRead+AsyncWrite+Unpin+Send> AppStream for T{}
pub type AppSocket=Box<dyn AppStream>;
pub struct AppServerClient { endpoint:Option<String> }
impl AppServerClient {
    pub fn new(endpoint:Option<String>)->Self{Self{endpoint}}
    #[cfg(unix)]
    pub async fn connect(&self)->Result<AppSocket>{let endpoint=self.endpoint.as_deref().ok_or_else(||anyhow::anyhow!("Lume browser pipe is not configured"))?;let socket=tokio::net::UnixStream::connect(endpoint).await.with_context(||"failed to connect to Lume browser socket")?;Ok(Box::new(socket))}
    #[cfg(windows)]
    pub async fn connect(&self)->Result<AppSocket>{let endpoint=self.endpoint.as_deref().ok_or_else(||anyhow::anyhow!("Lume browser pipe is not configured"))?;let socket=tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint).with_context(||"failed to connect to Lume browser named pipe")?;Ok(Box::new(socket))}
}
