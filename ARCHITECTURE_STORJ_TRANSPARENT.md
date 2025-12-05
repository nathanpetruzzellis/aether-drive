# Architecture : Storj Transparent (Géré par Aether Drive)

## 🎯 Vision

**L'utilisateur ne voit jamais Storj.** Aether Drive gère complètement le stockage décentralisé en arrière-plan, comme un service intégré.

## 📊 Architecture Proposée

### Modèle "Storj-as-a-Service"

```
Aether Drive (Service)
├── Compte Storj Master (géré par Aether)
│   ├── Bucket par utilisateur (créé automatiquement)
│   └── Credentials gérés par Wayne
└── Utilisateur Final
    └── Ne voit jamais Storj ✅
```

### Workflow Utilisateur (Ultra-Simplifié)

#### **Première utilisation**
1. **Inscription Wayne** :
   - Email
   - Mot de passe Wayne
   - Clic sur "S'inscrire"
   - **En arrière-plan** : Wayne crée automatiquement un bucket Storj pour l'utilisateur
2. **Initialisation coffre** :
   - Mot de passe maître
   - Clic sur "Initialiser"
   - **En arrière-plan** : Storj déjà configuré et prêt

#### **Sessions suivantes**
1. **Connexion Wayne** :
   - Email + Mot de passe Wayne
   - **En arrière-plan** : Récupération MKEK + Config Storj automatique
2. **Déverrouillage coffre** :
   - Mot de passe maître
   - **Résultat** : Tout fonctionne, Storj transparent

**Total** : 2 étapes seulement, Storj invisible ✅

---

## 🔐 Sécurité & Architecture

### Principe "Zero-Knowledge" Préservé

- ✅ **Wayne gère** :
  - Authentification utilisateur
  - MKEK chiffré
  - **Bucket Storj par utilisateur** (créé automatiquement)
  - **Credentials Storj** (gérés par Wayne, jamais vus par l'utilisateur)

- ✅ **Storj stocke** :
  - Fichiers chiffrés (format Aether)
  - Chaque utilisateur a son propre bucket isolé

- ✅ **Utilisateur final** :
  - Ne voit jamais Storj
  - Ne configure jamais Storj
  - Utilise simplement Aether Drive

### Modèle de Données

```
Wayne Database :
├── users (email, password_hash)
├── key_envelopes (MKEK chiffré)
└── storj_buckets (bucket_name, credentials chiffrés) ✅ NOUVEAU

Storj DCS :
└── Bucket par utilisateur (isolé)
    └── Fichiers chiffrés (format Aether)
```

---

## 🛠️ Implémentation

### 1. Compte Storj Master (Aether Drive)

Aether Drive possède un compte Storj avec :
- Access Key ID master
- Secret Access Key master
- Permissions pour créer/gérer des buckets

### 2. Création Automatique de Bucket

Lors de l'inscription Wayne :
1. Utilisateur s'inscrit (email + mot de passe Wayne)
2. Wayne crée automatiquement :
   - Un bucket Storj unique pour l'utilisateur (ex: `aether-user-{user_id}`)
   - Des credentials Storj dédiés pour ce bucket (via Storj API)
   - Stocke les credentials chiffrés dans Wayne

### 3. Gestion Transparente

- **Upload** : L'application utilise automatiquement le bucket de l'utilisateur
- **Download** : Récupération automatique depuis le bon bucket
- **Synchronisation** : Multi-appareils via Wayne qui fournit les credentials

---

## ✅ Avantages

1. **Simplicité maximale** : L'utilisateur ne voit jamais Storj
2. **Sécurité** : Isolation par bucket, credentials chiffrés
3. **Synchronisation** : Multi-appareils automatique
4. **Conforme au blueprint** : Wayne gère tout, utilisateur utilise simplement

---

## ⚠️ Points Techniques

### Option A : Bucket par utilisateur (Recommandé)
- Chaque utilisateur a son propre bucket Storj
- Isolation complète
- Credentials dédiés par bucket

### Option B : Bucket partagé avec préfixes
- Un seul bucket pour tous les utilisateurs
- Préfixe par utilisateur (ex: `{user_id}/file.uuid`)
- Moins d'isolation mais plus simple à gérer

---

## 🎯 Recommandation

**Option A : Bucket par utilisateur** pour une isolation maximale et une sécurité optimale.
