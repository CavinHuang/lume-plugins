use anyhow::{bail, Result};
use std::io::{Read, Write};

pub fn read_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len > 64 * 1024 * 1024 { bail!("native message too large: {len}"); }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(Some(buf))
}

pub fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> Result<()> {
    if payload.len() > u32::MAX as usize { bail!("message too large for 4-byte length prefix"); }
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()?;
    Ok(())
}
