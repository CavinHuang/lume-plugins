use serde::Serialize;
#[derive(Serialize)]
pub struct HostDiagnostics { pub host_name: String, pub protocol_version: u32, pub connected_to_app_server: bool, pub config_loaded: bool }
