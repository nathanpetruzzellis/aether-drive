use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::config::Config;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::error::ProvideErrorMetadata;
use std::fmt;

// Le module client est défini directement ici pour simplifier

/// Configuration pour le client Storj DCS.
///
/// Storj DCS utilise une API compatible S3, donc nous utilisons les identifiants S3 :
/// - Access Key ID
/// - Secret Access Key
/// - Endpoint (ex: https://gateway.storjshare.io)
/// - Bucket name
#[derive(Debug, Clone)]
pub struct StorjConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub endpoint: String,
    pub bucket_name: String,
    pub region: String,
}

impl StorjConfig {
    pub fn new(
        access_key_id: String,
        secret_access_key: String,
        endpoint: String,
        bucket_name: String,
    ) -> Self {
        Self {
            access_key_id,
            secret_access_key,
            endpoint,
            bucket_name,
            region: "us-east-1".to_string(), // Storj utilise généralement us-east-1
        }
    }
}

/// Erreurs du module Storj.
#[derive(Debug)]
pub enum StorjError {
    Config(String),
    S3(String),
    Io(String),
    NotFound,
}

impl fmt::Display for StorjError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorjError::Config(msg) => write!(f, "Configuration error: {}", msg),
            StorjError::S3(msg) => write!(f, "S3/Storj error: {}", msg),
            StorjError::Io(msg) => write!(f, "IO error: {}", msg),
            StorjError::NotFound => write!(f, "Object not found"),
        }
    }
}

impl std::error::Error for StorjError {}

/// Client Storj pour upload/download de fichiers chiffrés au format Aether.
pub struct StorjClient {
    s3_client: S3Client,
    bucket_name: String,
}

impl StorjClient {
    /// Crée un nouveau client Storj à partir d'une configuration.
    pub async fn new(config: StorjConfig) -> Result<Self, StorjError> {
        use aws_sdk_s3::config::Credentials;
        use aws_sdk_s3::config::Region;

        let credentials = Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "storj",
        );

        use aws_sdk_s3::config::BehaviorVersion;

        let s3_config = Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .credentials_provider(credentials)
            .region(Region::new(config.region.clone()))
            .endpoint_url(&config.endpoint)
            .force_path_style(true) // Storj nécessite souvent path-style
            .build();

        let s3_client = S3Client::from_conf(s3_config);

        Ok(Self {
            s3_client,
            bucket_name: config.bucket_name,
        })
    }

    /// Upload un fichier chiffré au format Aether vers Storj.
    ///
    /// # Arguments
    /// * `object_key` - Clé de l'objet dans Storj (généralement l'UUID du fichier)
    /// * `data` - Données chiffrées au format Aether (bytes)
    ///
    /// # Returns
    /// L'ETag de l'objet uploadé (pour vérification)
    pub async fn upload_file(
        &self,
        object_key: &str,
        data: &[u8],
    ) -> Result<String, StorjError> {
        log::info!("StorjClient::upload_file: bucket={}, key={}, data_len={}", self.bucket_name, object_key, data.len());
        
        let body = ByteStream::from(data.to_vec());

        let result = self
            .s3_client
            .put_object()
            .bucket(&self.bucket_name)
            .key(object_key)
            .body(body)
            .send()
            .await
            .map_err(|e| {
                let error_msg = format!("{}", e);
                log::error!("StorjClient::upload_file failed: {}", error_msg);
                // Essaie d'extraire plus de détails de l'erreur
                let code = e.code();
                let message = e.message();
                log::error!("Service error details: code={:?}, message={:?}", code, message);
                let detailed_msg = if let (Some(code), Some(msg)) = (code, message) {
                    format!("Failed to upload file: {} (code: {}, message: {})", error_msg, code, msg)
                } else {
                    format!("Failed to upload file: {}", error_msg)
                };
                StorjError::S3(detailed_msg)
            })?;

        let etag = result
            .e_tag()
            .ok_or_else(|| StorjError::S3("No ETag returned".to_string()))?
            .to_string();

        log::info!("StorjClient::upload_file success: etag={}", etag);
        Ok(etag)
    }

    /// Download un fichier chiffré depuis Storj.
    ///
    /// # Arguments
    /// * `object_key` - Clé de l'objet dans Storj
    ///
    /// # Returns
    /// Les données chiffrées au format Aether
    pub async fn download_file(&self, object_key: &str) -> Result<Vec<u8>, StorjError> {
        let result = self
            .s3_client
            .get_object()
            .bucket(&self.bucket_name)
            .key(object_key)
            .send()
            .await
            .map_err(|e| {
                let error_msg = e.to_string();
                if error_msg.contains("NoSuchKey") || error_msg.contains("404") {
                    StorjError::NotFound
                } else {
                    StorjError::S3(format!("Failed to download file: {}", e))
                }
            })?;

        let data = result
            .body
            .collect()
            .await
            .map_err(|e| StorjError::Io(format!("Failed to read response body: {}", e)))?
            .into_bytes()
            .to_vec();

        Ok(data)
    }

    /// Supprime un fichier depuis Storj.
    ///
    /// # Arguments
    /// * `object_key` - Clé de l'objet à supprimer
    pub async fn delete_file(&self, object_key: &str) -> Result<(), StorjError> {
        self.s3_client
            .delete_object()
            .bucket(&self.bucket_name)
            .key(object_key)
            .send()
            .await
            .map_err(|e| StorjError::S3(format!("Failed to delete file: {}", e)))?;

        Ok(())
    }

    /// Liste tous les objets dans le bucket Storj.
    ///
    /// # Returns
    /// Liste des clés d'objets (fichiers uniquement, pas les préfixes/dossiers)
    pub async fn list_files(&self) -> Result<Vec<String>, StorjError> {
        let result = self
            .s3_client
            .list_objects_v2()
            .bucket(&self.bucket_name)
            .send()
            .await
            .map_err(|e| StorjError::S3(format!("Failed to list files: {}", e)))?;

        // Filtre uniquement les objets réels (pas les préfixes/dossiers)
        // Les objets réels ont une taille > 0 ou sont des fichiers valides
        // On ignore les objets qui se terminent par "/" (qui sont des préfixes/dossiers)
        let keys: Vec<String> = result
            .contents()
            .iter()
            .filter_map(|obj| {
                obj.key().and_then(|k| {
                    let key_str = k.to_string();
                    // Ignore les clés qui se terminent par "/" (préfixes/dossiers)
                    // et ne garde que les fichiers réels
                    if key_str.ends_with('/') {
                        None
                    } else {
                        Some(key_str)
                    }
                })
            })
            .collect();

        Ok(keys)
    }

    /// Vérifie si un objet existe dans Storj.
    ///
    /// # Arguments
    /// * `object_key` - Clé de l'objet à vérifier
    ///
    /// # Returns
    /// `true` si l'objet existe, `false` sinon
    pub async fn file_exists(&self, object_key: &str) -> Result<bool, StorjError> {
        match self
            .s3_client
            .head_object()
            .bucket(&self.bucket_name)
            .key(object_key)
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(e) => {
                let error_msg = e.to_string();
                if error_msg.contains("NotFound") || error_msg.contains("404") {
                    Ok(false)
                } else {
                    Err(StorjError::S3(format!("Failed to check file existence: {}", e)))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Les tests nécessitent des credentials Storj valides.
    // Pour l'instant, on teste juste que le client peut être créé avec une config valide.
    #[test]
    fn test_storj_config() {
        let config = StorjConfig::new(
            "test-access-key".to_string(),
            "test-secret-key".to_string(),
            "https://gateway.storjshare.io".to_string(),
            "test-bucket".to_string(),
        );

        assert_eq!(config.access_key_id, "test-access-key");
        assert_eq!(config.bucket_name, "test-bucket");
        assert_eq!(config.region, "us-east-1");
    }
}

