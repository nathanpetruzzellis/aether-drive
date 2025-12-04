# État Actuel du Projet "Aether Drive V1"

## 1. Dépôt et Configuration
* **Nom du Dépôt** : nathanpetruzzellis/aether-drive
* **Statut Git** : Squelette Tauri/React initialisé.
* **Environnement IDE** : Cursor, Terminal (zsh).
* **Règles IA** : Fichiers de contexte en place.

## 2. État Technique
* **Phase de Développement** : PHASE 1 — Crypto Core.
* **Travail Effectué** : Dépôt configuré, stack Tauri (React + Rust) initialisée, dépendances crypto ajoutées, module `crypto` (Argon2id → MasterKey → FileKey → MKEK) implémenté et couvert par des tests unitaires, commandes Tauri exposées et flux React local (bootstrap/unlock) opérationnel.
* **Travail Restant (Prochaine Micro-Étape)** : Concevoir le contrat d’API avec le Control Plane “Wayne” pour la persistance du couple (`password_salt`, `MkekCiphertext`) et préparer les DTO côté client.

## 3. Non-Régression
* Tests initiaux Tauri (dev server) validés.
* Tests unitaires Rust du Crypto Core (`cargo test`) validés.
* Flux UI local (bootstrap/unlock) testé manuellement avec succès.
