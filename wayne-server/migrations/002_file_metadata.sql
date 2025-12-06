-- Migration 002 : Table des métadonnées anonymisées de fichiers
-- Aether Drive V1 - Control Plane
-- Stocke uniquement des métadonnées anonymisées (taille, type, date)
-- Le nom du fichier et le contenu restent dans l'index local SQLCipher

-- Table des métadonnées de fichiers
CREATE TABLE IF NOT EXISTS file_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_uuid VARCHAR(36) NOT NULL, -- UUID du fichier (format standard)
    encrypted_size BIGINT NOT NULL, -- Taille du fichier chiffré en octets
    file_type VARCHAR(50), -- Type de fichier anonymisé (ex: "image", "document", "video", etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, file_uuid) -- Un utilisateur ne peut avoir qu'une seule entrée par fichier
);

-- Index pour recherche rapide par user_id
CREATE INDEX IF NOT EXISTS idx_file_metadata_user_id ON file_metadata(user_id);
-- Index pour recherche rapide par file_uuid
CREATE INDEX IF NOT EXISTS idx_file_metadata_file_uuid ON file_metadata(file_uuid);
-- Index pour recherche par type de fichier
CREATE INDEX IF NOT EXISTS idx_file_metadata_file_type ON file_metadata(file_type);

-- Trigger pour mettre à jour updated_at automatiquement
DROP TRIGGER IF EXISTS update_file_metadata_updated_at ON file_metadata;
CREATE TRIGGER update_file_metadata_updated_at
    BEFORE UPDATE ON file_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

