import { pool } from '../db/connection';

export interface StorjBucket {
  id: string;
  user_id: string;
  bucket_name: string;
  access_key_id_encrypted: Buffer;
  secret_access_key_encrypted: Buffer;
  endpoint: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateStorjBucketInput {
  user_id: string;
  bucket_name: string;
  access_key_id_encrypted: number[]; // ByteArray depuis le client
  secret_access_key_encrypted: number[]; // ByteArray depuis le client
  endpoint?: string;
}

export class StorjBucketModel {
  // Créer un bucket Storj pour un utilisateur
  static async create(input: CreateStorjBucketInput): Promise<StorjBucket> {
    const access_key_id_encrypted = Buffer.from(input.access_key_id_encrypted);
    const secret_access_key_encrypted = Buffer.from(input.secret_access_key_encrypted);
    const endpoint = input.endpoint || 'https://gateway.storjshare.io';
    
    const result = await pool.query(
      `INSERT INTO storj_buckets (user_id, bucket_name, access_key_id_encrypted, secret_access_key_encrypted, endpoint)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, bucket_name, access_key_id_encrypted, secret_access_key_encrypted, endpoint, created_at, updated_at`,
      [input.user_id, input.bucket_name, access_key_id_encrypted, secret_access_key_encrypted, endpoint]
    );
    
    return result.rows[0];
  }
  
  // Récupérer un bucket par user_id
  static async findByUserId(userId: string): Promise<StorjBucket | null> {
    const result = await pool.query(
      `SELECT id, user_id, bucket_name, access_key_id_encrypted, secret_access_key_encrypted, endpoint, created_at, updated_at
       FROM storj_buckets
       WHERE user_id = $1`,
      [userId]
    );
    
    return result.rows[0] || null;
  }
  
  // Récupérer un bucket par ID
  static async findById(id: string): Promise<StorjBucket | null> {
    const result = await pool.query(
      `SELECT id, user_id, bucket_name, access_key_id_encrypted, secret_access_key_encrypted, endpoint, created_at, updated_at
       FROM storj_buckets
       WHERE id = $1`,
      [id]
    );
    
    return result.rows[0] || null;
  }
  
  // Supprimer un bucket
  static async delete(userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM storj_buckets WHERE user_id = $1`,
      [userId]
    );
    
    return (result.rowCount || 0) > 0;
  }
}

