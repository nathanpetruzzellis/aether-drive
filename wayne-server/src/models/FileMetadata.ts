import { Pool } from 'pg'
import { getDbPool } from '../db/connection'

export interface FileMetadataInput {
  user_id: string
  file_uuid: string
  encrypted_size: number
  file_type?: string
}

export interface FileMetadata {
  id: string
  user_id: string
  file_uuid: string
  encrypted_size: number
  file_type: string | null
  created_at: Date
  updated_at: Date
}

export interface UserStats {
  total_files: number
  total_size: number
  files_by_type: Record<string, number>
}

export class FileMetadataModel {
  private pool: Pool

  constructor() {
    this.pool = getDbPool()
  }

  /**
   * Crée ou met à jour une métadonnée de fichier
   */
  async upsert(input: FileMetadataInput): Promise<FileMetadata> {
    const query = `
      INSERT INTO file_metadata (user_id, file_uuid, encrypted_size, file_type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, file_uuid)
      DO UPDATE SET
        encrypted_size = EXCLUDED.encrypted_size,
        file_type = EXCLUDED.file_type,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    const values = [input.user_id, input.file_uuid, input.encrypted_size, input.file_type || null]

    const result = await this.pool.query(query, values)
    return this.mapRowToFileMetadata(result.rows[0])
  }

  /**
   * Récupère toutes les métadonnées d'un utilisateur
   */
  async findByUserId(userId: string): Promise<FileMetadata[]> {
    const query = `
      SELECT * FROM file_metadata
      WHERE user_id = $1
      ORDER BY created_at DESC
    `

    const result = await this.pool.query(query, [userId])
    return result.rows.map(row => this.mapRowToFileMetadata(row))
  }

  /**
   * Récupère une métadonnée par UUID de fichier
   */
  async findByFileUuid(userId: string, fileUuid: string): Promise<FileMetadata | null> {
    const query = `
      SELECT * FROM file_metadata
      WHERE user_id = $1 AND file_uuid = $2
    `

    const result = await this.pool.query(query, [userId, fileUuid])
    if (result.rows.length === 0) {
      return null
    }
    return this.mapRowToFileMetadata(result.rows[0])
  }

  /**
   * Supprime une métadonnée de fichier
   */
  async delete(userId: string, fileUuid: string): Promise<boolean> {
    const query = `
      DELETE FROM file_metadata
      WHERE user_id = $1 AND file_uuid = $2
    `

    const result = await this.pool.query(query, [userId, fileUuid])
    return result.rowCount !== null && result.rowCount > 0
  }

  /**
   * Supprime toutes les métadonnées d'un utilisateur
   */
  async deleteAllByUserId(userId: string): Promise<number> {
    const query = `
      DELETE FROM file_metadata
      WHERE user_id = $1
    `

    const result = await this.pool.query(query, [userId])
    return result.rowCount || 0
  }

  /**
   * Récupère les statistiques d'un utilisateur
   */
  async getUserStats(userId: string): Promise<UserStats> {
    const query = `
      SELECT
        COUNT(*) as total_files,
        COALESCE(SUM(encrypted_size), 0) as total_size,
        file_type,
        COUNT(*) as count_by_type
      FROM file_metadata
      WHERE user_id = $1
      GROUP BY file_type
    `

    const result = await this.pool.query(query, [userId])
    
    let totalFiles = 0
    let totalSize = 0
    const filesByType: Record<string, number> = {}

    result.rows.forEach(row => {
      const count = parseInt(row.count_by_type, 10)
      const size = parseInt(row.total_size, 10) || 0
      totalFiles += count
      totalSize += size
      
      const type = row.file_type || 'other'
      filesByType[type] = (filesByType[type] || 0) + count
    })

    // Si aucun fichier, on fait une requête simple
    if (totalFiles === 0) {
      const simpleQuery = `
        SELECT COUNT(*) as total_files, COALESCE(SUM(encrypted_size), 0) as total_size
        FROM file_metadata
        WHERE user_id = $1
      `
      const simpleResult = await this.pool.query(simpleQuery, [userId])
      totalFiles = parseInt(simpleResult.rows[0]?.total_files || '0', 10)
      totalSize = parseInt(simpleResult.rows[0]?.total_size || '0', 10)
    }

    return {
      total_files: totalFiles,
      total_size: totalSize,
      files_by_type: filesByType,
    }
  }

  /**
   * Mappe une ligne de base de données vers un objet FileMetadata
   */
  private mapRowToFileMetadata(row: any): FileMetadata {
    return {
      id: row.id,
      user_id: row.user_id,
      file_uuid: row.file_uuid,
      encrypted_size: parseInt(row.encrypted_size, 10),
      file_type: row.file_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
}

