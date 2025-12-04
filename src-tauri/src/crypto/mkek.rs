use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};

use super::{CryptoError, Kek, MasterKey};

const MKEK_AAD: &[u8] = b"aether-drive:mkek:v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MkekCiphertext {
    pub nonce: [u8; 24],
    pub payload: Vec<u8>,
}

impl MkekCiphertext {
    pub fn new(nonce: [u8; 24], payload: Vec<u8>) -> Self {
        Self { nonce, payload }
    }
}

pub fn encrypt_master_key(
    kek: &Kek,
    master_key: &MasterKey,
) -> Result<MkekCiphertext, CryptoError> {
    let cipher = build_cipher(kek);
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: master_key.as_bytes(),
                aad: MKEK_AAD,
            },
        )
        .map_err(CryptoError::from)?;
    Ok(MkekCiphertext::new(nonce, ciphertext))
}

pub fn decrypt_master_key(kek: &Kek, mkek: &MkekCiphertext) -> Result<MasterKey, CryptoError> {
    let cipher = build_cipher(kek);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&mkek.nonce),
            Payload {
                msg: mkek.payload.as_ref(),
                aad: MKEK_AAD,
            },
        )
        .map_err(CryptoError::from)?;
    Ok(MasterKey::from_vec(plaintext))
}

fn build_cipher(kek: &Kek) -> XChaCha20Poly1305 {
    let key = Key::from_slice(kek.as_bytes());
    XChaCha20Poly1305::new(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{CryptoCore, PasswordSecret};

    #[test]
    fn mkek_encrypt_decrypt_roundtrip() {
        let core = CryptoCore::default();
        let password = PasswordSecret::new("mkek-test");
        let salt = [9u8; 16];
        let hierarchy = crate::crypto::KeyHierarchy::bootstrap(&password, salt).unwrap();

        let mk_before = hierarchy.master_key().as_bytes().to_vec();
        let mkek = encrypt_master_key(hierarchy.kek(), hierarchy.master_key()).unwrap();

        let decrypted_mk = decrypt_master_key(hierarchy.kek(), &mkek).unwrap();
        let mk_after = decrypted_mk.as_bytes().to_vec();

        assert_eq!(mk_before, mk_after);
    }

    #[test]
    fn mkek_decrypt_with_wrong_kek_fails() {
        let password = PasswordSecret::new("mkek-test");
        let salt = [10u8; 16];

        let hierarchy = crate::crypto::KeyHierarchy::bootstrap(&password, salt).unwrap();
        let mkek = encrypt_master_key(hierarchy.kek(), hierarchy.master_key()).unwrap();

        // Nouveau KEK (mot de passe différent) : doit échouer.
        let wrong_password = PasswordSecret::new("mkek-test-wrong");
        let wrong_kek = CryptoCore::default()
            .derive_kek(&wrong_password, &salt)
            .expect("derive_kek should succeed");

        let result = decrypt_master_key(&wrong_kek, &mkek);
        assert!(result.is_err());
    }
}
