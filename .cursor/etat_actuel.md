# État Actuel du Projet "Aether Drive V1"

## 1. Dépôt et Configuration
* **Nom du Dépôt** : nathanpetruzzellis/aether-drive
* **Statut Git** : Squelette Tauri/React initialisé.
* **Environnement IDE** : Cursor, Terminal (zsh).
* **Règles IA** : Fichiers de contexte en place.

## 2. État Technique
* **Phase de Développement** : PHASE 1 — Crypto Core.
* **Travail Effectué** : Dépôt configuré, stack Tauri (React + Rust) initialisée, dépendances crypto ajoutées, module `crypto` (Argon2id → MasterKey → FileKey → MKEK) implémenté et couvert par des tests unitaires, commandes Tauri exposées et flux React local (bootstrap/unlock) opérationnel avec persistance des données du bootstrap via localStorage, contrat d’API Wayne défini (DTO + client HTTP minimal), squelette d’index local (module `index` en mémoire) ajouté côté Rust, module SQLCipher implémenté (`SqlCipherIndex`) avec dérivation de clé via HKDF depuis la MasterKey et tests unitaires validés, intégration SQLCipher dans le flux applicatif terminée (base créée/ouverte automatiquement lors du bootstrap/unlock dans le répertoire de données de l’app), persistance des données du bootstrap implémentée (localStorage) permettant le déverrouillage après redémarrage de l’app.
* **Travail Restant (Prochaine Micro-Étape)** : Exposer des commandes Tauri pour manipuler l’index (ajouter/lister/supprimer des fichiers) et préparer l’intégration avec le stockage Storj pour la Phase 2.

## 3. Non-Régression
* Tests initiaux Tauri (dev server) validés.
* Tests unitaires Rust du Crypto Core (`cargo test`) validés.
* Flux UI local (bootstrap/unlock) testé manuellement avec succès.
* Tests unitaires SQLCipher (`cargo test sqlcipher_index`) validés.
* Persistance des données du bootstrap et déverrouillage après redémarrage validés.
