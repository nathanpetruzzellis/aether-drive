import { pool } from '../db/connection';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

export interface CreateRefreshTokenInput {
  user_id: string;
  expires_in_days?: number; // Par défaut 30 jours
}

export class RefreshTokenModel {
  // Génère un token aléatoire sécurisé (64 octets = 512 bits)
  private static generateToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  // Hash le token avec bcrypt avant stockage
  private static async hashToken(token: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(token, saltRounds);
  }

  // Vérifie si un token correspond au hash stocké
  private static async verifyToken(token: string, hash: string): Promise<boolean> {
    return bcrypt.compare(token, hash);
  }

  // Crée un nouveau refresh token pour un utilisateur
  static async create(input: CreateRefreshTokenInput): Promise<{ token: string; refreshToken: RefreshToken }> {
    const token = this.generateToken();
    const tokenHash = await this.hashToken(token);
    const expiresInDays = input.expires_in_days || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const result = await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, token_hash, expires_at, created_at`,
      [input.user_id, tokenHash, expiresAt]
    );

    return {
      token, // Token en clair (à retourner au client UNIQUEMENT lors de la création)
      refreshToken: result.rows[0],
    };
  }

  // Trouve un refresh token par sa valeur (en vérifiant le hash)
  static async findByToken(token: string): Promise<RefreshToken | null> {
    // On doit vérifier tous les tokens non expirés
    const result = await pool.query(
      `SELECT id, user_id, token_hash, expires_at, created_at
       FROM refresh_tokens
       WHERE expires_at > NOW()`
    );

    // Vérifie chaque token avec bcrypt
    for (const row of result.rows) {
      const isValid = await this.verifyToken(token, row.token_hash);
      if (isValid) {
        return row;
      }
    }

    return null;
  }

  // Trouve tous les refresh tokens d'un utilisateur (pour gestion/révocation)
  static async findByUserId(userId: string): Promise<RefreshToken[]> {
    const result = await pool.query(
      `SELECT id, user_id, token_hash, expires_at, created_at
       FROM refresh_tokens
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  // Révoque un refresh token (supprime de la base)
  static async revoke(tokenId: string): Promise<void> {
    await pool.query(
      `DELETE FROM refresh_tokens WHERE id = $1`,
      [tokenId]
    );
  }

  // Révoque tous les refresh tokens d'un utilisateur (déconnexion de tous les appareils)
  static async revokeAllForUser(userId: string): Promise<void> {
    await pool.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );
  }

  // Nettoie les tokens expirés (à appeler périodiquement)
  static async cleanupExpired(): Promise<number> {
    const result = await pool.query(
      `DELETE FROM refresh_tokens WHERE expires_at <= NOW()`
    );
    return result.rowCount || 0;
  }
}

