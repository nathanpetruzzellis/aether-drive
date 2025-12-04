import { pool } from '../db/connection';
import bcrypt from 'bcrypt';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
}

export class UserModel {
  // Créer un nouvel utilisateur
  static async create(input: CreateUserInput): Promise<User> {
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(input.password, saltRounds);
    
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, created_at, updated_at`,
      [input.email.toLowerCase(), password_hash]
    );
    
    return result.rows[0];
  }
  
  // Trouver un utilisateur par email
  static async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM users
       WHERE email = $1`,
      [email.toLowerCase()]
    );
    
    return result.rows[0] || null;
  }
  
  // Trouver un utilisateur par ID
  static async findById(id: string): Promise<User | null> {
    const result = await pool.query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [id]
    );
    
    return result.rows[0] || null;
  }
  
  // Vérifier un mot de passe
  static async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }
}

