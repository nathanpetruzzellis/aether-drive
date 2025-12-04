# État Actuel du Projet "Aether Drive V1"

## 1. Dépôt et Configuration
* **Nom du Dépôt** : nathanpetruzzellis/aether-drive
* **Statut Git** : Squelette Tauri/React initialisé.
* **Environnement IDE** : Cursor, Terminal (zsh).
* **Règles IA** : Fichiers de contexte en place.

## 2. État Technique
* **Phase de Développement** : PHASE 1 — Crypto Core.
* **Travail Effectué** : Dépôt configuré, stack Tauri (React + Rust) initialisée, dépendances crypto ajoutées, module `crypto` (Argon2id → MasterKey → FileKey → MKEK) implémenté et couvert par des tests unitaires.
* **Travail Restant (Prochaine Micro-Étape)** : Intégrer les commandes crypto Tauri (`crypto_bootstrap`/`crypto_unlock`) dans le frontend React pour un flux local de création / déverrouillage de coffre.

## 3. Non-Régression
* Tests initiaux Tauri (dev server) validés.
* Tests unitaires Rust du Crypto Core (`cargo test`) validés.
