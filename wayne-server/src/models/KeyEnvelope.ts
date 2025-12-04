import { pool } from '../db/connection';

export interface KeyEnvelope {
  id: string;
  user_id: string;
  version: number;
  password_salt: Buffer;
  mkek_nonce: Buffer;
  mkek_payload: Buffer;
  created_at: Date;
  updated_at: Date;
}

export interface CreateKeyEnvelopeInput {
  user_id: string;
  version: number;
  password_salt: number[]; // ByteArray depuis le client
  mkek_nonce: number[];     // ByteArray depuis le client
  mkek_payload: number[];   // ByteArray depuis le client
}

export class KeyEnvelopeModel {
  // Créer ou mettre à jour une enveloppe de clés
  static async upsert(input: CreateKeyEnvelopeInput): Promise<KeyEnvelope> {
    // Convertit les tableaux de nombres en Buffer
    const password_salt = Buffer.from(input.password_salt);
    const mkek_nonce = Buffer.from(input.mkek_nonce);
    const mkek_payload = Buffer.from(input.mkek_payload);
    
    const result = await pool.query(
      `INSERT INTO key_envelopes (user_id, version, password_salt, mkek_nonce, mkek_payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         version = EXCLUDED.version,
         password_salt = EXCLUDED.password_salt,
         mkek_nonce = EXCLUDED.mkek_nonce,
         mkek_payload = EXCLUDED.mkek_payload,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, user_id, version, password_salt, mkek_nonce, mkek_payload, created_at, updated_at`,
      [input.user_id, input.version, password_salt, mkek_nonce, mkek_payload]
    );
    
    return result.rows[0];
  }
  
  // Récupérer une enveloppe par user_id
  static async findByUserId(userId: string): Promise<KeyEnvelope | null> {
    const result = await pool.query(
      `SELECT id, user_id, version, password_salt, mkek_nonce, mkek_payload, created_at, updated_at
       FROM key_envelopes
       WHERE user_id = $1`,
      [userId]
    );
    
    return result.rows[0] || null;
  }
  
  // Récupérer une enveloppe par ID
  static async findById(id: string): Promise<KeyEnvelope | null> {
    const result = await pool.query(
      `SELECT id, user_id, version, password_salt, mkek_nonce, mkek_payload, created_at, updated_at
       FROM key_envelopes
       WHERE id = $1`,
      [id]
    );
    
    return result.rows[0] || null;
  }
  
  // Supprimer une enveloppe
  static async delete(userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM key_envelopes WHERE user_id = $1`,
      [userId]
    );
    
    return (result.rowCount || 0) > 0;
  }
}

