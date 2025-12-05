# Workflow de Connexion - Aether Drive V1

## 📋 Vue d'ensemble

Aether Drive propose **deux modes d'utilisation** :
1. **Mode Wayne** (recommandé) : Synchronisation du MKEK via le serveur Wayne
2. **Mode Local** : Stockage du MKEK uniquement sur l'appareil local

---

## 🔐 WORKFLOW COMPLET - MODE WAYNE (Recommandé)

### Étape 1 : Connexion à Wayne (Control Plane)
**Page : LoginPage**

1. **URL du serveur Wayne** (pré-rempli : `https://eather.io`)
2. **Inscription** (première fois uniquement) :
   - Email
   - Mot de passe Wayne
   - Clic sur "S'inscrire"
3. **Connexion** :
   - Email (même que l'inscription)
   - Mot de passe Wayne (même que l'inscription)
   - Clic sur "Se connecter"
4. **Résultat** : Redirection automatique vers la page Unlock

**Note** : Le mot de passe Wayne est différent du mot de passe maître (voir étape suivante).

---

### Étape 2 : Initialisation ou Déverrouillage du Coffre
**Page : UnlockPage**

#### **Cas A : Nouveau compte (Premier lancement)**

1. **Toggle "Initialiser"** (actif par défaut si nouveau compte)
2. **Mot de passe maître** :
   - Choisir une passphrase robuste et unique
   - ⚠️ **CRITIQUE** : Ce mot de passe ne quitte jamais l'appareil
   - Il sera utilisé pour déchiffrer la Master Key
3. **Clic sur "Initialiser le coffre"**
4. **Résultat** :
   - Génération de la Master Key (256-bit random)
   - Chiffrement de la Master Key → MKEK (via Argon2id)
   - Si Wayne activé : Sauvegarde du MKEK chiffré sur Wayne
   - Si mode local : Sauvegarde du MKEK chiffré dans localStorage
   - Redirection automatique vers le Dashboard

#### **Cas B : Compte existant (Sessions suivantes)**

1. **Toggle "Déverrouiller"** (actif par défaut si coffre existe)
2. **Mot de passe maître** :
   - Entrer le même mot de passe maître utilisé lors de l'initialisation
3. **Clic sur "Déverrouiller le coffre"**
4. **Résultat** :
   - Si Wayne activé : Récupération du MKEK depuis Wayne
   - Si mode local : Récupération du MKEK depuis localStorage
   - Déchiffrement de la Master Key en RAM (ne quitte jamais l'appareil)
   - Redirection automatique vers le Dashboard

---

## 🏠 WORKFLOW COMPLET - MODE LOCAL

### Étape 1 : Passer directement à Unlock
**Page : UnlockPage** (accessible directement si pas de connexion Wayne)

1. **Toggle "Initialiser"** ou **"Déverrouiller"** selon le cas
2. **Mot de passe maître** : Choisir une passphrase robuste
3. **Clic sur le bouton correspondant**
4. **Résultat** : Le MKEK est stocké uniquement dans localStorage (pas de synchronisation)

**Note** : En mode local, pas besoin de se connecter à Wayne. Le workflow est simplifié mais sans synchronisation multi-appareils.

---

## 🔄 WORKFLOW DES SESSIONS SUIVANTES

### Scénario 1 : Utilisateur avec Wayne activé

1. **Lancement de l'app** → Page LoginPage
2. **Connexion Wayne** :
   - Email + Mot de passe Wayne
   - Clic sur "Se connecter"
3. **Déverrouillage** :
   - Mot de passe maître
   - Clic sur "Déverrouiller le coffre"
4. **Dashboard** → Utilisation de l'application

### Scénario 2 : Utilisateur en mode local

1. **Lancement de l'app** → Page UnlockPage (si données locales existent)
2. **Déverrouillage** :
   - Mot de passe maître
   - Clic sur "Déverrouiller le coffre"
3. **Dashboard** → Utilisation de l'application

---

## 🔑 CLARIFICATION DES MOTS DE PASSE

### 1. **Mot de passe Wayne** (Optionnel)
- **Usage** : Authentification sur le serveur Wayne
- **Stockage** : Hashé sur le serveur Wayne (bcrypt)
- **Quand** : Inscription/connexion à Wayne
- **Où** : Page LoginPage

### 2. **Mot de passe maître** (Obligatoire)
- **Usage** : Déchiffrement de la Master Key (via KEK dérivée par Argon2id)
- **Stockage** : Jamais stocké, jamais envoyé
- **Quand** : Initialisation ou déverrouillage du coffre
- **Où** : Page UnlockPage
- **Critique** : Ne quitte jamais l'appareil en clair

---

## 📊 RÉSUMÉ DES ÉTAPES PAR MODE

### Mode Wayne (Recommandé)
1. ✅ Inscription Wayne (email + mot de passe Wayne)
2. ✅ Connexion Wayne (email + mot de passe Wayne)
3. ✅ Initialisation coffre (mot de passe maître)
4. ✅ Utilisation → Dashboard

**Sessions suivantes** :
1. ✅ Connexion Wayne (email + mot de passe Wayne)
2. ✅ Déverrouillage coffre (mot de passe maître)
3. ✅ Utilisation → Dashboard

### Mode Local
1. ✅ Initialisation coffre (mot de passe maître)
2. ✅ Utilisation → Dashboard

**Sessions suivantes** :
1. ✅ Déverrouillage coffre (mot de passe maître)
2. ✅ Utilisation → Dashboard

---

## ⚠️ POINTS IMPORTANTS

1. **Wayne est optionnel** : L'utilisateur peut utiliser Aether Drive en mode local uniquement
2. **Deux mots de passe distincts** :
   - Mot de passe Wayne : Pour l'authentification serveur
   - Mot de passe maître : Pour déchiffrer les données
3. **Sécurité** : Le mot de passe maître ne quitte jamais l'appareil en clair
4. **MKEK** : Seul le MKEK chiffré est synchronisé avec Wayne (pas la Master Key)
5. **Persistance** : Les configurations sont sauvegardées (Wayne envelope_id, Storj config, bootstrap data)

