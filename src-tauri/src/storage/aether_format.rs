use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroizing;

/// En-tête binaire d'un fichier Aether V1
///
/// Structure :
/// - Magic Number (4 bytes): "AETH"
/// - Version (1 byte): 0x01
/// - Cipher ID (1 byte): 0x02 (XChaCha20-Poly1305 + PQ Hybrid)
/// - UUID (16 bytes): Identifiant unique du fichier
/// - Salt (32 bytes): Salt pour la dérivation de la FileKey
/// - Commitment HMAC (32 bytes): HMAC-SHA256 pour vérifier l'intégrité
/// - Nonce (24 bytes): Nonce pour XChaCha20-Poly1305
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AetherHeader {
    pub magic: [u8; 4],
    pub version: u8,
    pub cipher_id: u8,
    pub uuid: [u8; 16],
    pub salt: [u8; 32],
    pub commitment_hmac: [u8; 32],
    pub nonce: [u8; 24],
}

/// Fichier Aether complet (en-tête + corps chiffré)
#[derive(Debug, Clone)]
pub struct AetherFile {
    pub header: AetherHeader,
    pub ciphertext: Zeroizing<Vec<u8>>,
}

/// Erreurs spécifiques au format Aether
#[derive(Debug)]
pub enum AetherError {
    InvalidMagic,
    UnsupportedVersion,
    UnsupportedCipher,
    InvalidHeader,
    HmacMismatch,
}

impl fmt::Display for AetherError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AetherError::InvalidMagic => write!(f, "Invalid magic number"),
            AetherError::UnsupportedVersion => write!(f, "Unsupported version"),
            AetherError::UnsupportedCipher => write!(f, "Unsupported cipher"),
            AetherError::InvalidHeader => write!(f, "Invalid header"),
            AetherError::HmacMismatch => write!(f, "HMAC mismatch"),
        }
    }
}

impl std::error::Error for AetherError {}

impl AetherFile {
    /// Sérialise le fichier Aether en format binaire pour le stockage
    ///
    /// Format binaire :
    /// [Magic(4)][Version(1)][CipherID(1)][UUID(16)][Salt(32)][HMAC(32)][Nonce(24)][CiphertextLen(8)][Ciphertext(N)]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        // En-tête
        bytes.extend_from_slice(&self.header.magic);
        bytes.push(self.header.version);
        bytes.push(self.header.cipher_id);
        bytes.extend_from_slice(&self.header.uuid);
        bytes.extend_from_slice(&self.header.salt);
        bytes.extend_from_slice(&self.header.commitment_hmac);
        bytes.extend_from_slice(&self.header.nonce);
        
        // Longueur du ciphertext (u64 en little-endian)
        let ciphertext_len = self.ciphertext.len() as u64;
        bytes.extend_from_slice(&ciphertext_len.to_le_bytes());
        
        // Ciphertext
        bytes.extend_from_slice(self.ciphertext.as_ref());
        
        bytes
    }

    /// Désérialise un fichier Aether depuis le format binaire
    pub fn from_bytes(data: &[u8]) -> Result<Self, AetherError> {
        const HEADER_SIZE: usize = 4 + 1 + 1 + 16 + 32 + 32 + 24; // 110 bytes
        const LEN_SIZE: usize = 8; // u64
        
        if data.len() < HEADER_SIZE + LEN_SIZE {
            return Err(AetherError::InvalidHeader);
        }

        let mut offset = 0;
        
        // Magic Number
        let magic: [u8; 4] = data[offset..offset + 4].try_into().unwrap();
        offset += 4;
        
        // Version
        let version = data[offset];
        offset += 1;
        
        // Cipher ID
        let cipher_id = data[offset];
        offset += 1;
        
        // UUID
        let uuid: [u8; 16] = data[offset..offset + 16].try_into().unwrap();
        offset += 16;
        
        // Salt
        let salt: [u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;
        
        // Commitment HMAC
        let commitment_hmac: [u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;
        
        // Nonce
        let nonce: [u8; 24] = data[offset..offset + 24].try_into().unwrap();
        offset += 24;
        
        // Longueur du ciphertext
        let ciphertext_len_bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
        let ciphertext_len = u64::from_le_bytes(ciphertext_len_bytes) as usize;
        offset += 8;
        
        // Vérifie que les données restantes correspondent à la longueur
        if data.len() < offset + ciphertext_len {
            return Err(AetherError::InvalidHeader);
        }
        
        // Ciphertext
        let ciphertext = Zeroizing::new(data[offset..offset + ciphertext_len].to_vec());
        
        Ok(AetherFile {
            header: AetherHeader {
                magic,
                version,
                cipher_id,
                uuid,
                salt,
                commitment_hmac,
                nonce,
            },
            ciphertext,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let header = AetherHeader {
            magic: *b"AETH",
            version: 0x01,
            cipher_id: 0x02,
            uuid: [0x01; 16],
            salt: [0x02; 32],
            commitment_hmac: [0x03; 32],
            nonce: [0x04; 24],
        };
        
        let ciphertext = Zeroizing::new(vec![0x05; 100]);
        let file = AetherFile {
            header,
            ciphertext,
        };
        
        // Sérialise
        let bytes = file.to_bytes();
        
        // Désérialise
        let deserialized = AetherFile::from_bytes(&bytes).unwrap();
        
        // Vérifie
        assert_eq!(deserialized.header.magic, file.header.magic);
        assert_eq!(deserialized.header.version, file.header.version);
        assert_eq!(deserialized.header.cipher_id, file.header.cipher_id);
        assert_eq!(deserialized.header.uuid, file.header.uuid);
        assert_eq!(deserialized.header.salt, file.header.salt);
        assert_eq!(deserialized.header.commitment_hmac, file.header.commitment_hmac);
        assert_eq!(deserialized.header.nonce, file.header.nonce);
        assert_eq!(deserialized.ciphertext.as_ref() as &[u8], file.ciphertext.as_ref() as &[u8]);
    }
}

