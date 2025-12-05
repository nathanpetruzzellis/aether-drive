-- Migration 002 : Ajout de la gestion transparente des buckets Storj
-- Aether Drive V1 - Control Plane

-- Table des buckets Storj (gérés automatiquement par Wayne)
CREATE TABLE IF NOT EXISTS storj_buckets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bucket_name VARCHAR(255) NOT NULL,
    access_key_id_encrypted BYTEA NOT NULL, -- Credentials Storj chiffrés
    secret_access_key_encrypted BYTEA NOT NULL,
    endpoint VARCHAR(255) NOT NULL DEFAULT 'https://gateway.storjshare.io',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id) -- Un utilisateur ne peut avoir qu'un seul bucket Storj
);

-- Index pour recherche rapide par user_id
CREATE INDEX IF NOT EXISTS idx_storj_buckets_user_id ON storj_buckets(user_id);

-- Trigger pour mettre à jour updated_at automatiquement
DROP TRIGGER IF EXISTS update_storj_buckets_updated_at ON storj_buckets;
CREATE TRIGGER update_storj_buckets_updated_at
    BEFORE UPDATE ON storj_buckets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

