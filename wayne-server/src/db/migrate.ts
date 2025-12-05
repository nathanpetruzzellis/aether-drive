import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool } from './connection';

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Exécution des migrations...');
    
    // Lit tous les fichiers de migration dans l'ordre
    const migrationsDir = join(__dirname, '../../migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Exécute dans l'ordre alphabétique (001, 002, etc.)
    
    await client.query('BEGIN');
    
    for (const file of migrationFiles) {
      console.log(`📝 Exécution de la migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const migrationSQL = readFileSync(migrationPath, 'utf-8');
      await client.query(migrationSQL);
    }
    
    await client.query('COMMIT');
    
    console.log('✅ Migrations exécutées avec succès');
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

