# Smart Work Book medPrep QCM

Application full-stack pour la préparation aux examens médicaux.

## Fonctionnalités
- **Admin** : Importation de banques de questions (Lange, PreTest) via texte brut.
- **Moteur d'extraction** : Parsing intelligent des questions, options et réponses.
- **Entraînement** : Interface interactive pour les étudiants avec correction immédiate.
- **Base de données** : SQLite géré par Knex.js.

## Installation
1. `npm install`
2. `npm run dev` (lance le serveur Express + Vite)

## Architecture
- `server.ts` : Point d'entrée backend (Express).
- `src/lib/db.ts` : Schéma et initialisation de la base de données.
- `src/lib/parser.ts` : Logique d'extraction des données textuelles.
- `src/components/AdminInterface.tsx` : Interface de gestion.
- `src/components/UserInterface.tsx` : Interface d'entraînement.

## Exemple de Parsing Lange
Le parser détecte les questions commençant par `1.`, les options comme `(A)`, `(B)` et les réponses au format `1. A. Explication...`.
