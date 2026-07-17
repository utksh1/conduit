use crate::config::SecurityConfig;
use crate::tools::registry::ToolResult;
use std::fs;
use std::path::{Path, PathBuf};

pub struct FilesystemTool {
    config: SecurityConfig,
}

impl FilesystemTool {
    pub fn new(config: SecurityConfig) -> Self {
        Self { config }
    }

    fn is_path_allowed(&self, path: &Path) -> Result<PathBuf, String> {
        let mut check_path = path.to_path_buf();
        let mut suffix = PathBuf::new();
        
        let canonical = loop {
            match check_path.canonicalize() {
                Ok(p) => {
                    if suffix.as_os_str().is_empty() {
                        break p;
                    } else {
                        break p.join(&suffix);
                    }
                }
                Err(e) => {
                    if let Some(parent) = check_path.parent() {
                        if let Some(file_name) = check_path.file_name() {
                            let mut new_suffix = PathBuf::from(file_name);
                            if !suffix.as_os_str().is_empty() {
                                new_suffix.push(&suffix);
                            }
                            suffix = new_suffix;
                        }
                        check_path = parent.to_path_buf();
                        
                        // Break if we reach the root and it still doesn't exist (unlikely)
                        if check_path.as_os_str().is_empty() {
                            return Err(format!("Could not canonicalize path: {}", e));
                        }
                    } else {
                        return Err(format!("Could not canonicalize path: {}", e));
                    }
                }
            }
        };

        if self.config.allowed_directories.is_empty() {
            return Err("No allowed directories configured in security settings.".to_string());
        }

        let canonical_str = canonical.to_string_lossy();
        
        for allowed in &self.config.allowed_directories {
            let allowed_path = Path::new(allowed).canonicalize().unwrap_or_else(|_| PathBuf::from(allowed));
            if canonical.starts_with(&allowed_path) {
                return Ok(canonical);
            }
        }

        Err(format!("Path {} is outside allowed directories.", canonical_str))
    }

    pub fn read(&self, path: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        if let Ok(metadata) = fs::metadata(&safe_path) {
            if metadata.len() as usize > self.config.max_file_size {
                return ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("File exceeds maximum allowed size of {} bytes", self.config.max_file_size)),
                };
            }
        }

        match fs::read_to_string(&safe_path) {
            Ok(content) => ToolResult { success: true, output: content, error: None },
            Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
        }
    }

    pub fn write(&self, path: &str, content: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        if content.len() > self.config.max_file_size {
            return ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Content exceeds maximum allowed size of {} bytes", self.config.max_file_size)),
            };
        }

        println!("Safe path: {:?}", safe_path);

        match fs::write(&safe_path, content) {
            Ok(_) => ToolResult { success: true, output: "File written successfully.".to_string(), error: None },
            Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
        }
    }

    pub fn list(&self, path: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        match fs::read_dir(&safe_path) {
            Ok(entries) => {
                let mut contents = Vec::new();
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().into_owned();
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    if is_dir {
                        contents.push(format!("{}/", file_name));
                    } else {
                        contents.push(file_name);
                    }
                }
                ToolResult { success: true, output: contents.join("\n"), error: None }
            }
            Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
        }
    }

    pub fn delete(&self, path: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        let metadata = match fs::metadata(&safe_path) {
            Ok(m) => m,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
        };

        if metadata.is_dir() {
            match fs::remove_dir_all(&safe_path) {
                Ok(_) => ToolResult { success: true, output: "Directory deleted successfully.".to_string(), error: None },
                Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
            }
        } else {
            match fs::remove_file(&safe_path) {
                Ok(_) => ToolResult { success: true, output: "File deleted successfully.".to_string(), error: None },
                Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
            }
        }
    }

    pub fn mkdir(&self, path: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        match fs::create_dir_all(&safe_path) {
            Ok(_) => ToolResult { success: true, output: "Directory created successfully.".to_string(), error: None },
            Err(e) => ToolResult { success: false, output: String::new(), error: Some(e.to_string()) },
        }
    }

    pub fn exists(&self, path: &str) -> ToolResult {
        let p = Path::new(path);
        let safe_path = match self.is_path_allowed(p) {
            Ok(p) => p,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        let exists = safe_path.exists();
        ToolResult { success: true, output: exists.to_string(), error: None }
    }
}
