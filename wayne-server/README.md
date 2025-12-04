# Wayne Server - Control Plane pour Aether Drive V1

Serveur backend pour le Control Plane "Wayne" d'Aether Drive V1.

## Installation

1. Installer les dépendances :
```bash
npm install
```

2. Configurer les variables d'environnement :
```bash
cp .env.example .env
# Éditer .env avec tes valeurs
```

3. Exécuter les migrations de base de données :
```bash
npm run migrate
```

4. Démarrer le serveur :
```bash
# Mode développement
npm run dev

# Mode production
npm run build
npm start
```

## API Endpoints

### Authentification

- `POST /api/v1/auth/register` - Inscription d'un nouvel utilisateur
- `POST /api/v1/auth/login` - Connexion d'un utilisateur

### Enveloppes de clés (MKEK)

- `POST /api/v1/key-envelopes` - Sauvegarder une enveloppe de clés (authentifié)
- `GET /api/v1/key-envelopes/me` - Récupérer l'enveloppe de l'utilisateur connecté
- `GET /api/v1/key-envelopes/:id` - Récupérer une enveloppe par ID (authentifié)

### Santé

- `GET /health` - Vérifier l'état du serveur et de la base de données

## Déploiement

Voir les instructions de déploiement dans le dossier `deploy/`.

