use anyhow::{anyhow, Result};
use std::{collections::HashMap, fs::File, io::Write, path::{Path,PathBuf}};
use uuid::Uuid;

struct OpenAsset { file:File, path:PathBuf, expected_size:Option<u64>, written:u64 }
pub struct AssetStore { root:PathBuf, open:HashMap<String,OpenAsset>, completed:HashMap<String,PathBuf> }
impl AssetStore {
    pub fn new(root:PathBuf)->Result<Self>{std::fs::create_dir_all(&root)?;Ok(Self{root,open:HashMap::new(),completed:HashMap::new()})}
    fn safe_name(name:&str)->String{Path::new(name).file_name().and_then(|v|v.to_str()).unwrap_or("asset.bin").chars().map(|c|if c.is_ascii_alphanumeric()||".-_".contains(c){c}else{'_'}).collect()}
    pub fn create(&mut self,name:&str,expected_size:Option<u64>)->Result<(String,PathBuf)>{
        let id=Uuid::new_v4().to_string();let filename=format!("{}-{}",id,Self::safe_name(name));let path=self.root.join(filename);let file=File::create(&path)?;
        self.open.insert(id.clone(),OpenAsset{file,path:path.clone(),expected_size,written:0});Ok((id,path))
    }
    pub fn append(&mut self,id:&str,bytes:&[u8])->Result<u64>{let entry=self.open.get_mut(id).ok_or_else(||anyhow!("unknown open asset {id}"))?;entry.file.write_all(bytes)?;entry.written+=bytes.len() as u64;Ok(entry.written)}
    pub fn finish(&mut self,id:&str)->Result<PathBuf>{let mut entry=self.open.remove(id).ok_or_else(||anyhow!("unknown open asset {id}"))?;entry.file.flush()?;if let Some(expected)=entry.expected_size{if expected!=entry.written{return Err(anyhow!("asset size mismatch: expected {expected}, wrote {}",entry.written));}}self.completed.insert(id.to_string(),entry.path.clone());Ok(entry.path)}
    pub fn abort(&mut self,id:&str){if let Some(entry)=self.open.remove(id){let _=std::fs::remove_file(entry.path);}}
    pub fn remove(&mut self,id:&str){self.abort(id);if let Some(path)=self.completed.remove(id){let _=std::fs::remove_file(path);}}
}
