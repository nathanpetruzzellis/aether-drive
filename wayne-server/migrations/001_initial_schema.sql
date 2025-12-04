-- Migration initiale : Schéma de base de données pour Wayne
-- Aether Drive V1 - Control Plane

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour recherche rapide par email
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Table des enveloppes de clés (MKEK)
CREATE TABLE IF NOT EXISTS key_envelopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    password_salt BYTEA NOT NULL, -- 16 octets
    mkek_nonce BYTEA NOT NULL,   -- 24 octets
    mkek_payload BYTEA NOT NULL,  -- Ciphertext de la MasterKey
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id) -- Un utilisateur ne peut avoir qu'une seule enveloppe
);

-- Index pour recherche rapide par user_id
CREATE INDEX IF NOT EXISTS idx_key_envelopes_user_id ON key_envelopes(user_id);

-- Table des tokens de rafraîchissement (pour JWT refresh)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour recherche rapide par user_id
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
-- Index pour nettoyage des tokens expirés
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Fonction pour mettre à jour automatiquement updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers pour mettre à jour updated_at automatiquement
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_key_envelopes_updated_at ON key_envelopes;
CREATE TRIGGER update_key_envelopes_updated_at
    BEFORE UPDATE ON key_envelopes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

