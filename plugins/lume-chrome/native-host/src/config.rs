use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub schema_version: u32,
    pub channel: String,
    pub extension_id: String,
    pub app_server_url: Option<String>,
    pub app_server_command: Option<PathBuf>,
    pub app_server_args: Option<Vec<String>>,
    pub browser_client_path: Option<PathBuf>,
    pub lume_cli_path: Option<PathBuf>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub asset_root: Option<PathBuf>,
}
impl HostConfig {
    pub fn load() -> anyhow::Result<Self> {
        let exe=std::env::current_exe()?;
        let path=std::env::var_os("LUME_CHROME_HOST_CONFIG").map(PathBuf::from).unwrap_or_else(||exe.parent().unwrap().join("extension-host-config.json"));
        let raw=std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn default_asset_root(&self)->PathBuf{
        self.asset_root.clone().unwrap_or_else(||std::env::temp_dir().join("lume-browser-assets"))
    }
}
