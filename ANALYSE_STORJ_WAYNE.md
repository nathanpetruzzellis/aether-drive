# Analyse : Intégration Storj dans Wayne

## 🎯 Objectif V1
> "Cette V1 se concentre sur les fonctionnalités essentielles (upload, téléchargement, synchronisation multi-appareils, partage de fichier) tout en assurant un socle de sécurité maximal conforme au triptyque Sécurité – Vitesse – Simplicité."

## 📊 Situation Actuelle

### Workflow actuel (trop complexe)
1. Connexion Wayne (email + mot de passe Wayne)
2. Déverrouillage coffre (mot de passe maître)
3. **Configuration Storj manuelle** (Access Key, Secret Key, Endpoint, Bucket) ❌
4. Utilisation

**Problème** : 3 étapes de connexion + configuration manuelle = trop complexe pour V1

---

## 💡 Solution Proposée : Storj intégré dans Wayne

### Principe
Wayne stocke les credentials Storj **chiffrés** (comme il stocke déjà le MKEK chiffré).

### Workflow simplifié

#### **Première utilisation**
1. **Inscription Wayne** :
   - Email
   - Mot de passe Wayne
   - **Configuration Storj** (une seule fois) :
     - Access Key ID
     - Secret Access Key
     - Endpoint (pré-rempli : `https://gateway.storjshare.io`)
     - Bucket Name
2. **Initialisation coffre** :
   - Mot de passe maître
   - Clic sur "Initialiser"
   - Résultat : MKEK + Storj config sauvegardés sur Wayne

#### **Sessions suivantes**
1. **Connexion Wayne** :
   - Email + Mot de passe Wayne
   - Résultat : Récupération automatique du MKEK + Storj config
2. **Déverrouillage coffre** :
   - Mot de passe maître
   - Résultat : Déverrouillage + Storj configuré automatiquement

**Total** : 2 étapes seulement (Wayne + Mot de passe maître)

---

## 🔐 Sécurité

### Respect du principe "Non Fiable"
- ✅ **Credentials Storj chiffrés** : Stockés sur Wayne en chiffré (comme le MKEK)
- ✅ **Fichiers sur Storj** : Restent décentralisés, chiffrés avec Master Key
- ✅ **Wayne ne voit jamais** :
  - Les fichiers en clair
  - Les credentials Storj en clair
  - La Master Key
- ✅ **Zero-Knowledge préservé** : Seul le client local déchiffre

### Architecture
```
Wayne (Control Plane) :
├── MKEK chiffré ✅
├── Credentials Storj chiffrés ✅ (nouveau)
└── Métadonnées anonymisées ✅

Storj (Data Plane) :
└── Fichiers chiffrés (format Aether) ✅
```

---

## 🛠️ Implémentation

### 1. Schéma Wayne (Migration)
```sql
CREATE TABLE IF NOT EXISTS storj_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_key_id_encrypted BYTEA NOT NULL,
    secret_access_key_encrypted BYTEA NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    bucket_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);
```

### 2. Chiffrement des credentials Storj
- Utiliser la **Master Key** pour chiffrer les credentials Storj
- Stocker le ciphertext sur Wayne
- Déchiffrer uniquement côté client local (en RAM)

### 3. API Wayne
- `POST /api/v1/storj-config` : Sauvegarder la config Storj (chiffrée)
- `GET /api/v1/storj-config/me` : Récupérer la config Storj (chiffrée)

### 4. Client React
- Intégrer la config Storj dans le flux d'inscription Wayne
- Récupération automatique lors de la connexion
- Configuration automatique du client Storj après déverrouillage

---

## ✅ Avantages

1. **Simplicité** : 2 étapes au lieu de 3+ (Wayne + Mot de passe maître)
2. **Synchronisation multi-appareils** : Storj config disponible sur tous les appareils
3. **Sécurité préservée** : Credentials chiffrés, Zero-Knowledge maintenu
4. **Conforme au blueprint** : Wayne gère les métadonnées, Storj reste le Data Plane

---

## ⚠️ Points d'attention

1. **Chiffrement des credentials** : Utiliser la Master Key (déchiffrée uniquement en RAM)
2. **Migration** : Gérer les utilisateurs existants avec Storj config local
3. **Fallback** : Permettre toujours le mode local si Wayne indisponible

---

## 🎯 Recommandation

**Intégrer Storj dans Wayne** pour simplifier l'expérience utilisateur tout en préservant la sécurité Zero-Knowledge.

