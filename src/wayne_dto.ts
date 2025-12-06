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

// Requête de récupération d'une enveloppe de clés.
export interface GetKeyEnvelopeRequest {
  envelope_id: string
}

// Réponse contenant l'enveloppe de clés.
export interface GetKeyEnvelopeResponse {
  envelope: KeyEnvelopeDto
}

// Requête d'inscription d'un nouvel utilisateur.
export interface RegisterRequest {
  email: string
  password: string
  remember_me?: boolean // Si true, crée un refresh token pour rester connecté
}

// Réponse d'inscription.
export interface RegisterResponse {
  user_id: string
  access_token: string
  refresh_token: string | null // null si remember_me=false
  expires_in: number
  message: string
}

// Requête de connexion.
export interface LoginRequest {
  email: string
  password: string
  remember_me?: boolean // Si true, crée un refresh token pour rester connecté
}

// Réponse de connexion (contient le token d'authentification).
export interface LoginResponse {
  access_token: string
  refresh_token: string | null // null si remember_me=false
  user_id: string
  expires_in: number
}

// Réponse d'erreur standardisée de Wayne.
export interface WayneErrorResponse {
  error: string
  message: string
  code?: string
}

// Configuration Storj (gérée automatiquement par Wayne).
export interface StorjConfigDto {
  bucket_id: string
  bucket_name: string
  access_key_id: string
  secret_access_key: string
  endpoint: string
}

// Réponse de création de bucket Storj.
export interface CreateStorjBucketResponse {
  bucket_id: string
  bucket_name: string
  endpoint: string
  message: string
}

// Requête de rafraîchissement de token.
export interface RefreshTokenRequest {
  refresh_token: string
}

// Réponse de rafraîchissement de token.
export interface RefreshTokenResponse {
  access_token: string
  expires_in: number
}

// Requête de déconnexion.
export interface LogoutRequest {
  refresh_token: string
}

// Réponse de déconnexion.
export interface LogoutResponse {
  message: string
}

// Requête de changement de mot de passe.
export interface ChangePasswordRequest {
  password_type: 'wayne' | 'master' // Type de mot de passe à changer
  old_password?: string // Requis uniquement pour 'wayne'
  new_password?: string // Requis uniquement pour 'wayne'
  new_password_salt?: number[] // Requis uniquement pour 'master'
  new_mkek?: { // Requis uniquement pour 'master'
    nonce: number[]
    payload: number[]
  }
}

// Réponse de changement de mot de passe.
export interface ChangePasswordResponse {
  message: string
}

// Métadonnées anonymisées de fichier (stockées sur Wayne).
export interface FileMetadataDto {
  id: string
  file_uuid: string
  encrypted_size: number
  file_type: string | null
  created_at: string
  updated_at: string
}

// Requête de sauvegarde de métadonnées.
export interface SaveFileMetadataRequest {
  file_uuid: string
  encrypted_size: number
  file_type?: string
}

// Réponse de sauvegarde de métadonnées.
export interface SaveFileMetadataResponse {
  metadata: FileMetadataDto
}

// Réponse de récupération de métadonnées.
export interface GetFileMetadataResponse {
  metadata: FileMetadataDto[]
}

// Statistiques utilisateur.
export interface UserStatsResponse {
  stats: {
    total_files: number
    total_size: number
    files_by_type: Record<string, number>
  }
}


