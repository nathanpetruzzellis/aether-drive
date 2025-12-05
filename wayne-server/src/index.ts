import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { testConnection } from './db/connection';
import authRoutes from './routes/auth';
import keyEnvelopesRoutes from './routes/keyEnvelopes';
import storjRoutes from './routes/storj';

// Charge le fichier .env depuis le répertoire du projet
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de sécurité
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite chaque IP à 100 requêtes par fenêtre
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.',
});
app.use('/api/', limiter);

// Route de santé
app.get('/health', async (req: Request, res: Response) => {
  const dbConnected = await testConnection();
  res.json({
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// Routes API
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/key-envelopes', keyEnvelopesRoutes);
app.use('/api/v1/storj-config', storjRoutes);

// Route 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Route non trouvée',
  });
});

// Gestionnaire d'erreurs global
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Une erreur interne est survenue',
  });
});

// Démarrage du serveur
async function startServer() {
  try {
    // Test de connexion à la base de données
    console.log('🔄 Test de connexion à la base de données...');
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.error('❌ Impossible de se connecter à la base de données');
      process.exit(1);
    }
    
    // Démarre le serveur
    app.listen(PORT, () => {
      console.log(`🚀 Serveur Wayne démarré sur le port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 API Auth: http://localhost:${PORT}/api/v1/auth`);
      console.log(`🔑 API Key Envelopes: http://localhost:${PORT}/api/v1/key-envelopes`);
      console.log(`☁️ API Storj Config: http://localhost:${PORT}/api/v1/storj-config`);
    });
  } catch (error) {
    console.error('❌ Erreur lors du démarrage du serveur:', error);
    process.exit(1);
  }
}

startServer();

