import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'wayne_db',
  user: process.env.DB_USER || 'wayne',
  password: process.env.DB_PASSWORD || 'wayne_secure_password_change_me',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const pool = new Pool(dbConfig);

// Test de connexion au démarrage
pool.on('connect', () => {
  console.log('✅ Connexion PostgreSQL établie');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL:', err);
  process.exit(-1);
});

// Fonction pour tester la connexion
export async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Test de connexion PostgreSQL réussi:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Test de connexion PostgreSQL échoué:', error);
    return false;
  }
}

