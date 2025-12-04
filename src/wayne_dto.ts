// DTO côté client pour communiquer avec le Control Plane "Wayne".
// IMPORTANT : aucun secret (mot de passe, KEK, MasterKey) ne doit être inclus ici.
// Uniquement le sel et le ciphertext MKEK, conformément à la blueprint.

export type ByteArray = number[]

// Représentation sérialisable du ciphertext MKEK issu de Rust.
export interface MkekCiphertextDto {
  // Nonce XChaCha20-Poly1305 (24 octets).
  nonce: ByteArray
  // Ciphertext authentifié de la MasterKey.
  payload: ByteArray
}

// Enveloppe de clés que Wayne est autorisé à stocker.
export interface KeyEnvelopeDto {
  // Version du schéma (doit rester alignée avec le AAD Rust `aether-drive:mkek:v1`).
  version: 1
  // Sel Argon2id utilisé pour dériver la KEK à partir du mot de passe utilisateur (16 octets).
  password_salt: ByteArray
  // Ciphertext MKEK (nonce + payload) produit par le moteur Rust.
  mkek: MkekCiphertextDto
}

// Requête minimale de création/mise à jour d'une enveloppe côté Wayne.
export interface CreateKeyEnvelopeRequest {
  envelope: KeyEnvelopeDto
}

// Réponse minimale de Wayne après persistance.
export interface CreateKeyEnvelopeResponse {
  // Identifiant opaque de l'enveloppe côté Wayne (UUID ou similaire).
  envelope_id: string
}


