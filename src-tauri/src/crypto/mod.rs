use std::fmt;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead;
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use secrecy::{ExposeSecret, SecretString};
use sha2::Sha256;
use zeroize::Zeroizing;

pub mod mkek;
pub use mkek::MkekCiphertext;

const KEK_LEN: usize = 32;
const MASTER_KEY_LEN: usize = 32;
const FILE_KEY_LEN: usize = 32;
const FILE_KEY_INFO: &[u8] = b"aether-drive:file-key";

/// Erreurs génériques du module Crypto Core (Phase 1).
#[derive(Debug)]
pub enum CryptoError {
    InvalidPassword(String),
    HkdfLength,
    Aead,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidPassword(err) => write!(f, "argon2 failure: {err}"),
            CryptoError::HkdfLength => write!(f, "hkdf output length invalid"),
            CryptoError::Aead => write!(f, "aead failure (xchacha20-poly1305)"),
        }
    }
}
impl From<aead::Error> for CryptoError {
    fn from(_: aead::Error) -> Self {
        CryptoError::Aead
    }
}

impl std::error::Error for CryptoError {}

/// Secret utilisateur (mot de passe) manipulé côté Rust uniquement.
pub struct PasswordSecret(SecretString);

impl PasswordSecret {
    pub fn new<S: Into<String>>(value: S) -> Self {
        let boxed: Box<str> = value.into().into_boxed_str();
        Self(SecretString::new(boxed))
    }

    pub fn expose(&self) -> &str {
        self.0.expose_secret()
    }
}

impl fmt::Debug for PasswordSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("PasswordSecret")
            .field(&"<redacted>")
            .finish()
    }
}

/// Représentation sécurisée de la KEK (Key Encryption Key).
pub struct Kek(Zeroizing<Vec<u8>>);

impl Kek {
    fn from_vec(buffer: Vec<u8>) -> Self {
        Self(Zeroizing::new(buffer))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl fmt::Debug for Kek {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Kek").field(&"<redacted>").finish()
    }
}

/// Master Key 256-bit root of trust.
pub struct MasterKey(Zeroizing<Vec<u8>>);

impl MasterKey {
    pub(crate) fn from_vec(buffer: Vec<u8>) -> Self {
        Self(Zeroizing::new(buffer))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("MasterKey").field(&"<redacted>").finish()
    }
}

/// File key dérivée via HKDF pour chaque objet Aether.
pub struct FileKey(Zeroizing<Vec<u8>>);

impl FileKey {
    fn from_vec(buffer: Vec<u8>) -> Self {
        Self(Zeroizing::new(buffer))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl fmt::Debug for FileKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("FileKey").field(&"<redacted>").finish()
    }
}

/// Paramétrage centralisé de la hiérarchie Argon2id -> MKEK -> MK.
#[derive(Clone)]
pub struct CryptoCore {
    argon2: Argon2<'static>,
}

impl CryptoCore {
    pub fn new() -> Self {
        // Paramètres CIVIL par défaut (64 MiB, 3 itérations, parallélisme 1).
        let params =
            Params::new(64 * 1024, 3, 1, Some(KEK_LEN)).expect("argon2 params must be valid");
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        Self { argon2 }
    }

    pub fn derive_kek(
        &self,
        password: &PasswordSecret,
        salt: &[u8; 16],
    ) -> Result<Kek, CryptoError> {
        let mut output = vec![0u8; KEK_LEN];
        self.argon2
            .hash_password_into(password.expose().as_bytes(), salt, &mut output)
            .map_err(|err| CryptoError::InvalidPassword(err.to_string()))?;
        Ok(Kek::from_vec(output))
    }

    pub fn generate_master_key(&self) -> MasterKey {
        let mut buffer = vec![0u8; MASTER_KEY_LEN];
        OsRng.fill_bytes(&mut buffer);
        MasterKey::from_vec(buffer)
    }

    pub fn derive_file_key(
        &self,
        master_key: &MasterKey,
        file_salt: &[u8; 32],
    ) -> Result<FileKey, CryptoError> {
        let hkdf = Hkdf::<Sha256>::new(Some(file_salt), master_key.as_bytes());
        let mut okm = [0u8; FILE_KEY_LEN];
        hkdf.expand(FILE_KEY_INFO, &mut okm)
            .map_err(|_| CryptoError::HkdfLength)?;
        Ok(FileKey::from_vec(okm.to_vec()))
    }

    pub fn random_password_salt(&self) -> [u8; 16] {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        salt
    }

    pub fn random_file_salt(&self) -> [u8; 32] {
        let mut salt = [0u8; 32];
        OsRng.fill_bytes(&mut salt);
        salt
    }
}

impl Default for CryptoCore {
    fn default() -> Self {
        Self::new()
    }
}

/// Agrège l'état sensible (KEK + MK) pour la session en cours.
pub struct KeyHierarchy {
    core: CryptoCore,
    kek: Kek,
    master_key: MasterKey,
}

impl KeyHierarchy {
    /// Bootstrap complet : dérive la KEK et génère une nouvelle Master Key.
    pub fn bootstrap(password: &PasswordSecret, salt: [u8; 16]) -> Result<Self, CryptoError> {
        let core = CryptoCore::default();
        let kek = core.derive_kek(password, &salt)?;
        let master_key = core.generate_master_key();
        Ok(Self {
            core,
            kek,
            master_key,
        })
    }

    /// Reconstruction lorsque la Master Key est déjà connue (MKEK déchiffrée).
    pub fn restore(
        password: &PasswordSecret,
        salt: [u8; 16],
        mkek_ciphertext: &MkekCiphertext,
    ) -> Result<Self, CryptoError> {
        let core = CryptoCore::default();
        let kek = core.derive_kek(password, &salt)?;
        let master_key = mkek::decrypt_master_key(&kek, mkek_ciphertext)?;
        Ok(Self {
            core,
            kek,
            master_key,
        })
    }

    pub fn kek(&self) -> &Kek {
        &self.kek
    }

    pub fn master_key(&self) -> &MasterKey {
        &self.master_key
    }

    pub fn derive_file_key(&self, file_salt: &[u8; 32]) -> Result<FileKey, CryptoError> {
        self.core.derive_file_key(&self.master_key, file_salt)
    }

    pub fn seal_master_key(&self) -> Result<MkekCiphertext, CryptoError> {
        mkek::encrypt_master_key(&self.kek, &self.master_key)
    }
}

impl fmt::Debug for KeyHierarchy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyHierarchy")
            .field("core", &"Argon2id(v0x13)")
            .field("kek", &"<redacted>")
            .field("master_key", &"<redacted>")
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_kek_is_deterministic_for_same_password_and_salt() {
        let core = CryptoCore::default();
        let password = PasswordSecret::new("test-password");
        let salt = [7u8; 16];

        let kek1 = core.derive_kek(&password, &salt).unwrap();
        let kek2 = core.derive_kek(&password, &salt).unwrap();

        assert_eq!(kek1.as_bytes(), kek2.as_bytes());
    }

    #[test]
    fn derive_kek_changes_with_different_salt() {
        let core = CryptoCore::default();
        let password = PasswordSecret::new("test-password");
        let salt1 = [1u8; 16];
        let salt2 = [2u8; 16];

        let kek1 = core.derive_kek(&password, &salt1).unwrap();
        let kek2 = core.derive_kek(&password, &salt2).unwrap();

        assert_ne!(kek1.as_bytes(), kek2.as_bytes());
    }

    #[test]
    fn master_key_and_file_key_roundtrip() {
        let core = CryptoCore::default();
        let mk = core.generate_master_key();
        let file_salt = core.random_file_salt();

        let fk1 = core.derive_file_key(&mk, &file_salt).unwrap();
        let fk2 = core.derive_file_key(&mk, &file_salt).unwrap();

        assert_eq!(fk1.as_bytes(), fk2.as_bytes());
    }

    #[test]
    fn key_hierarchy_bootstrap_and_seal_restore_roundtrip() {
        let password = PasswordSecret::new("strong-passphrase");
        let salt = [3u8; 16];

        let hierarchy = KeyHierarchy::bootstrap(&password, salt).unwrap();
        let mk_before = hierarchy.master_key().as_bytes().to_vec();

        let mkek = hierarchy.seal_master_key().unwrap();

        let restored = KeyHierarchy::restore(&password, salt, &mkek).unwrap();
        let mk_after = restored.master_key().as_bytes().to_vec();

        assert_eq!(mk_before, mk_after);
    }
}
