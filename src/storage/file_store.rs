use std::path::{Path, PathBuf};
use anyhow::Result;
use tokio::fs;
use tracing::{info, error};

pub struct FileStore {
    base_dir: PathBuf,
}

impl FileStore {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        Self {
            base_dir: base_dir.as_ref().to_path_buf(),
        }
    }

    pub async fn ensure_directories(&self) -> Result<()> {
        let events_dir = self.base_dir.join("events");
        let responses_dir = self.base_dir.join("responses");
        let logs_dir = self.base_dir.join("logs");

        fs::create_dir_all(&events_dir).await?;
        fs::create_dir_all(&responses_dir).await?;
        fs::create_dir_all(&logs_dir).await?;

        info!("Ensured directories exist:");
        info!("  Events: {}", events_dir.display());
        info!("  Responses: {}", responses_dir.display());
        info!("  Logs: {}", logs_dir.display());

        Ok(())
    }

    pub fn events_dir(&self) -> PathBuf {
        self.base_dir.join("events")
    }

    pub fn responses_dir(&self) -> PathBuf {
        self.base_dir.join("responses")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.base_dir.join("logs")
    }

    pub async fn store_json<T: serde::Serialize>(&self, subdir: &str, filename: &str, data: &T) -> Result<PathBuf> {
        let dir = self.base_dir.join(subdir);
        fs::create_dir_all(&dir).await?;
        
        let file_path = dir.join(filename);
        let json_content = serde_json::to_string_pretty(data)?;
        
        fs::write(&file_path, json_content).await?;
        info!("Stored JSON data to: {}", file_path.display());
        
        Ok(file_path)
    }

    pub async fn load_json<T: serde::de::DeserializeOwned>(&self, subdir: &str, filename: &str) -> Result<T> {
        let file_path = self.base_dir.join(subdir).join(filename);
        
        let content = fs::read_to_string(&file_path).await?;
        let data = serde_json::from_str(&content)?;
        
        info!("Loaded JSON data from: {}", file_path.display());
        Ok(data)
    }

    pub async fn list_files(&self, subdir: &str, extension: Option<&str>) -> Result<Vec<PathBuf>> {
        let dir = self.base_dir.join(subdir);
        
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        let mut read_dir = fs::read_dir(&dir).await?;

        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            
            if path.is_file() {
                if let Some(ext) = extension {
                    if path.extension().map_or(false, |e| e == ext) {
                        files.push(path);
                    }
                } else {
                    files.push(path);
                }
            }
        }

        files.sort();
        Ok(files)
    }

    pub async fn delete_file<P: AsRef<Path>>(&self, file_path: P) -> Result<()> {
        let path = file_path.as_ref();
        fs::remove_file(path).await?;
        info!("Deleted file: {}", path.display());
        Ok(())
    }
}