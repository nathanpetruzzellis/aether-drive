import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './connection';

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Exécution des migrations...');
    
    // Lit le fichier de migration
    const migrationPath = join(__dirname, '../../migrations/001_initial_schema.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Exécute la migration
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');
    
    console.log('✅ Migration exécutée avec succès');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de la migration:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Exécute la migration si le script est appelé directement
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('✅ Migration terminée');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Échec de la migration:', error);
      process.exit(1);
    });
}

export { runMigration };

