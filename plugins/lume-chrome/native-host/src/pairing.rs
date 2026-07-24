use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use keyring::v1::Entry;
use sha2::Sha256;
use std::io::{Read, Write};

const SERVICE: &str = "com.lume.browser.pairing";
type HmacSha256 = Hmac<Sha256>;

pub fn run_cli_if_requested() -> Result<bool> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("pairing") {
        return Ok(false);
    }
    let operation = args.get(2).map(String::as_str).ok_or_else(|| anyhow!("pairing operation is required"))?;
    let pairing_id = validate_pairing_id(args.get(3).map(String::as_str).ok_or_else(|| anyhow!("pairing id is required"))?)?;
    let entry = Entry::new(SERVICE, pairing_id)?;
    match operation {
        "store" => {
            let mut encoded = String::new();
            std::io::stdin().take(256).read_to_string(&mut encoded)?;
            let secret = URL_SAFE_NO_PAD.decode(encoded.trim()).context("invalid pairing key")?;
            if secret.len() != 32 { return Err(anyhow!("pairing key must be 32 bytes")); }
            entry.set_secret(&secret)?;
        }
        "get" => {
            let secret = entry.get_secret()?;
            if secret.len() != 32 { return Err(anyhow!("stored pairing key has invalid length")); }
            std::io::stdout().write_all(URL_SAFE_NO_PAD.encode(secret).as_bytes())?;
        }
        "delete" => entry.delete_credential()?,
        _ => return Err(anyhow!("unsupported pairing operation")),
    }
    Ok(true)
}

pub fn load(pairing_id: &str) -> Result<Vec<u8>> {
    let entry = Entry::new(SERVICE, validate_pairing_id(pairing_id)?)?;
    let secret = entry.get_secret()?;
    if secret.len() != 32 { return Err(anyhow!("stored pairing key has invalid length")); }
    Ok(secret)
}

pub fn sign(key: &[u8], label: &str, transcript: &str) -> Result<String> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)?;
    mac.update(label.as_bytes());
    mac.update(b"\n");
    mac.update(transcript.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

pub fn verify(key: &[u8], label: &str, transcript: &str, encoded: &str) -> Result<()> {
    let expected = URL_SAFE_NO_PAD.decode(encoded).context("invalid proof encoding")?;
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)?;
    mac.update(label.as_bytes());
    mac.update(b"\n");
    mac.update(transcript.as_bytes());
    mac.verify_slice(&expected).map_err(|_| anyhow!("pairing proof mismatch"))
}

pub fn derive_session_key(key: &[u8], nonce_main: &str, nonce_host: &str) -> Result<[u8; 32]> {
    let mut salt = Vec::with_capacity(nonce_main.len() + nonce_host.len() + 1);
    salt.extend_from_slice(nonce_main.as_bytes());
    salt.push(0);
    salt.extend_from_slice(nonce_host.as_bytes());
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), key);
    let mut output = [0u8; 32];
    hkdf.expand(b"lume-browser-bridge-v1", &mut output).map_err(|_| anyhow!("session key derivation failed"))?;
    Ok(output)
}

pub fn frame_mac(key: &[u8], sequence: u64, payload: &[u8]) -> Result<String> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)?;
    mac.update(&sequence.to_be_bytes());
    mac.update(payload);
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

pub fn verify_frame(key: &[u8], sequence: u64, payload: &[u8], encoded: &str) -> Result<()> {
    let expected = URL_SAFE_NO_PAD.decode(encoded).context("invalid frame MAC encoding")?;
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)?;
    mac.update(&sequence.to_be_bytes());
    mac.update(payload);
    mac.verify_slice(&expected).map_err(|_| anyhow!("frame MAC mismatch"))
}

fn validate_pairing_id(value: &str) -> Result<&str> {
    if (8..=96).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        Ok(value)
    } else {
        Err(anyhow!("invalid pairing id"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proofs_are_directional_and_tamper_evident() {
        let key = [7u8; 32];
        let transcript = "2|pairing-test|9|nonce-main-123456|nonce-host-123456|0.4.0";
        let host = sign(&key, "host", transcript).unwrap();
        assert!(verify(&key, "host", transcript, &host).is_ok());
        assert!(verify(&key, "main", transcript, &host).is_err());
        assert!(verify(&key, "host", "tampered", &host).is_err());
    }

    #[test]
    fn session_key_and_frame_mac_bind_both_nonces_and_sequence() {
        let key = [3u8; 32];
        let session = derive_session_key(&key, "nonce-main-123456", "nonce-host-123456").unwrap();
        let changed = derive_session_key(&key, "nonce-main-123456", "nonce-host-changed").unwrap();
        assert_ne!(session, changed);
        let payload = br#"{"id":"one"}"#;
        let mac = frame_mac(&session, 1, payload).unwrap();
        assert!(verify_frame(&session, 1, payload, &mac).is_ok());
        assert!(verify_frame(&session, 2, payload, &mac).is_err());
        assert!(verify_frame(&session, 1, b"changed", &mac).is_err());
    }
}
