use crate::crypto::{CryptoError, FileKey, MasterKey};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::{Sha256, Digest};
use std::fmt;
use zeroize::Zeroizing;

pub mod aether_format;
pub use aether_format::{AetherFile, AetherHeader, AetherError};

/// Constantes pour le format de fichier Aether (V1)
const MAGIC_NUMBER: &[u8] = b"AETH";
const VERSION: u8 = 0x01;
const CIPHER_ID: u8 = 0x02;
const UUID_LEN: usize = 16;
const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const FILE_KEY_INFO: &[u8] = b"aether-drive:file-key:v1";

/// Erreurs du module Storage
#[derive(Debug)]
pub enum StorageError {
    InvalidFormat(String),
    Crypto(CryptoError),
    Io(String),
    InvalidHeader,
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::InvalidFormat(msg) => write!(f, "Invalid file format: {}", msg),
            StorageError::Crypto(e) => write!(f, "Crypto error: {}", e),
            StorageError::Io(msg) => write!(f, "IO error: {}", msg),
            StorageError::InvalidHeader => write!(f, "Invalid Aether file header"),
        }
    }
}

impl From<CryptoError> for StorageError {
    fn from(e: CryptoError) -> Self {
        StorageError::Crypto(e)
    }
}

impl std::error::Error for StorageError {}

/// Chiffre un fichier selon le format Aether V1
///
/// # Arguments
/// * `master_key` - La MasterKey pour dériver la FileKey
/// * `plaintext` - Les données en clair à chiffrer
/// * `logical_path` - Le chemin logique du fichier (utilisé dans l'AAD)
///
/// # Returns
/// Un `AetherFile` contenant l'en-tête et le corps chiffré
pub fn encrypt_file(
    master_key: &MasterKey,
    plaintext: &[u8],
    logical_path: &str,
) -> Result<AetherFile, StorageError> {
    // Génère un UUID unique pour ce fichier
    let mut uuid = [0u8; UUID_LEN];
    OsRng.fill_bytes(&mut uuid);

    // Génère un salt unique pour la dérivation de la FileKey
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    // Dérive la FileKey depuis la MasterKey via HKDF-SHA256
    let master_key_bytes = master_key.as_bytes();
    let master_key_array: [u8; 32] = master_key_bytes
        .try_into()
        .map_err(|_| StorageError::InvalidFormat("MasterKey length invalid".to_string()))?;
    
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), &master_key_array);
    let mut file_key_bytes = [0u8; 32];
    hkdf.expand(FILE_KEY_INFO, &mut file_key_bytes)
        .map_err(|_| StorageError::Crypto(CryptoError::HkdfLength))?;
    
    let file_key = FileKey::from_bytes(&file_key_bytes);

    // Génère un nonce unique pour ce chiffrement
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    // Construit l'AAD (Additional Authenticated Data) avec le chemin logique
    let aad = build_aad(logical_path);

    // Chiffre le plaintext avec XChaCha20-Poly1305
    let cipher = XChaCha20Poly1305::new(Key::from_slice(file_key.as_bytes()));
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|e| StorageError::Crypto(CryptoError::from(e)))?;

    // Calcule le Commitment HMAC (HMAC-SHA256 de l'en-tête sans le HMAC lui-même)
    // L'en-tête complet sera : Magic(4) + Version(1) + CipherID(1) + UUID(16) + Salt(32) + HMAC(32) + Nonce(24)
    // Pour le HMAC, on utilise : Magic + Version + CipherID + UUID + Salt
    let mut hmac_input = Vec::new();
    hmac_input.extend_from_slice(MAGIC_NUMBER);
    hmac_input.push(VERSION);
    hmac_input.push(CIPHER_ID);
    hmac_input.extend_from_slice(&uuid);
    hmac_input.extend_from_slice(&salt);
    
    let mut hmac_hasher = Sha256::new();
    hmac_hasher.update(&hmac_input);
    hmac_hasher.update(file_key.as_bytes()); // Utilise la FileKey comme secret HMAC
    let commitment_hmac = hmac_hasher.finalize();

    // Construit l'en-tête
    let header = AetherHeader {
        magic: MAGIC_NUMBER.try_into().unwrap(),
        version: VERSION,
        cipher_id: CIPHER_ID,
        uuid,
        salt,
        commitment_hmac: commitment_hmac.into(),
        nonce: nonce_bytes,
    };

    Ok(AetherFile {
        header,
        ciphertext: Zeroizing::new(ciphertext),
    })
}

/// Déchiffre un fichier au format Aether V1
///
/// # Arguments
/// * `master_key` - La MasterKey pour dériver la FileKey
/// * `aether_file` - Le fichier chiffré à déchiffrer
/// * `logical_path` - Le chemin logique attendu du fichier (vérifié dans l'AAD)
///
/// # Returns
/// Les données en clair
pub fn decrypt_file(
    master_key: &MasterKey,
    aether_file: &AetherFile,
    logical_path: &str,
) -> Result<Vec<u8>, StorageError> {
    // Vérifie le Magic Number
    if aether_file.header.magic != *MAGIC_NUMBER {
        return Err(StorageError::InvalidFormat("Invalid magic number".to_string()));
    }

    // Vérifie la version
    if aether_file.header.version != VERSION {
        return Err(StorageError::InvalidFormat(format!(
            "Unsupported version: 0x{:02x}",
            aether_file.header.version
        )));
    }

    // Vérifie le Cipher ID
    if aether_file.header.cipher_id != CIPHER_ID {
        return Err(StorageError::InvalidFormat(format!(
            "Unsupported cipher ID: 0x{:02x}",
            aether_file.header.cipher_id
        )));
    }

    // Vérifie le Commitment HMAC
    let mut hmac_input = Vec::new();
    hmac_input.extend_from_slice(&aether_file.header.magic);
    hmac_input.push(aether_file.header.version);
    hmac_input.push(aether_file.header.cipher_id);
    hmac_input.extend_from_slice(&aether_file.header.uuid);
    hmac_input.extend_from_slice(&aether_file.header.salt);

    // Dérive la FileKey pour vérifier le HMAC
    let master_key_bytes = master_key.as_bytes();
    let master_key_array: [u8; 32] = master_key_bytes
        .try_into()
        .map_err(|_| StorageError::InvalidFormat("MasterKey length invalid".to_string()))?;
    
    let hkdf = Hkdf::<Sha256>::new(Some(&aether_file.header.salt), &master_key_array);
    let mut file_key_bytes = [0u8; 32];
    hkdf.expand(FILE_KEY_INFO, &mut file_key_bytes)
        .map_err(|_| StorageError::Crypto(CryptoError::HkdfLength))?;
    
    let file_key = FileKey::from_bytes(&file_key_bytes);

    // Vérifie le HMAC
    let mut hmac_hasher = Sha256::new();
    hmac_hasher.update(&hmac_input);
    hmac_hasher.update(file_key.as_bytes());
    let computed_hmac: [u8; 32] = hmac_hasher.finalize().into();
    
    if computed_hmac != aether_file.header.commitment_hmac {
        return Err(StorageError::InvalidFormat(
            "HMAC verification failed".to_string(),
        ));
    }

    // Construit l'AAD avec le chemin logique
    let aad = build_aad(logical_path);

    // Déchiffre le ciphertext
    let cipher = XChaCha20Poly1305::new(Key::from_slice(file_key.as_bytes()));
    let nonce = XNonce::from_slice(&aether_file.header.nonce);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: aether_file.ciphertext.as_ref(),
                aad: &aad,
            },
        )
        .map_err(|e| StorageError::Crypto(CryptoError::from(e)))?;

    Ok(plaintext)
}

/// Construit l'AAD (Additional Authenticated Data) à partir du chemin logique
fn build_aad(logical_path: &str) -> Vec<u8> {
    let mut aad = Vec::new();
    aad.extend_from_slice(b"aether-drive:aad:v1:");
    aad.extend_from_slice(logical_path.as_bytes());
    aad
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{CryptoCore, KeyHierarchy, PasswordSecret};

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let core = CryptoCore::default();
        let password_secret = PasswordSecret::new("test-password-123");
        let salt = core.random_password_salt();
        let hierarchy = KeyHierarchy::bootstrap(&password_secret, salt).unwrap();
        let master_key = hierarchy.master_key();

        let plaintext = b"Hello, Aether Drive! This is a test file.";
        let logical_path = "/documents/test.txt";

        // Chiffre le fichier
        let aether_file = encrypt_file(master_key, plaintext, logical_path).unwrap();

        // Vérifie l'en-tête
        let expected_magic: [u8; 4] = MAGIC_NUMBER.try_into().unwrap();
        assert_eq!(aether_file.header.magic, expected_magic);
        assert_eq!(aether_file.header.version, VERSION);
        assert_eq!(aether_file.header.cipher_id, CIPHER_ID);

        // Déchiffre le fichier
        let decrypted = decrypt_file(master_key, &aether_file, logical_path).unwrap();

        // Vérifie que le plaintext correspond
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_wrong_path_fails() {
        let core = CryptoCore::default();
        let password_secret = PasswordSecret::new("test-password-123");
        let salt = core.random_password_salt();
        let hierarchy = KeyHierarchy::bootstrap(&password_secret, salt).unwrap();
        let master_key = hierarchy.master_key();

        let plaintext = b"Hello, Aether Drive!";
        let logical_path = "/documents/test.txt";

        // Chiffre avec un chemin
        let aether_file = encrypt_file(master_key, plaintext, logical_path).unwrap();

        // Essaie de déchiffrer avec un chemin différent (doit échouer)
        let wrong_path = "/documents/different.txt";
        let result = decrypt_file(master_key, &aether_file, wrong_path);

        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_wrong_master_key_fails() {
        let core = CryptoCore::default();
        let password_secret1 = PasswordSecret::new("password-1");
        let password_secret2 = PasswordSecret::new("password-2");
        let salt = core.random_password_salt();
        
        let hierarchy1 = KeyHierarchy::bootstrap(&password_secret1, salt).unwrap();
        let hierarchy2 = KeyHierarchy::bootstrap(&password_secret2, salt).unwrap();
        
        let master_key1 = hierarchy1.master_key();
        let master_key2 = hierarchy2.master_key();

        let plaintext = b"Secret data";
        let logical_path = "/documents/secret.txt";

        // Chiffre avec master_key1
        let aether_file = encrypt_file(master_key1, plaintext, logical_path).unwrap();

        // Essaie de déchiffrer avec master_key2 (doit échouer)
        let result = decrypt_file(master_key2, &aether_file, logical_path);

        assert!(result.is_err());
    }
}

