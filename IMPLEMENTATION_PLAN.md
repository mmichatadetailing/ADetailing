# ADetailing Pilotage — plan d’implémentation

## Architecture

- **Frontend** : Next.js App Router, React, TypeScript strict, Tailwind CSS, composants accessibles maison inspirés de shadcn/ui.
- **Données** : Supabase (PostgreSQL, Auth, Storage, Realtime) en production. Un adaptateur `demo` persiste dans `localStorage` tant que les variables Supabase ne sont pas configurées.
- **Métier** : types et calculs financiers isolés dans `src/lib/domain`, montants stockés en centimes, validations Zod aux frontières.
- **Sécurité** : toutes les tables métier portent `organization_id`, politiques RLS par adhésion, secrets et jetons OAuth uniquement côté serveur, audit des mutations sensibles.
- **Imports** : pipeline prévisualisation → validation humaine → application idempotente. Import Excel côté serveur et parseur PDF Henrri déterministe avec scores de confiance.

## Phases verticales

1. Socle, navigation, thème, store de démonstration et authentification dégradée.
2. Dashboard, clients/véhicules, catalogue, prestations, CRM et actions quotidiennes.
3. Planning, documents/paiements, finances, objectifs et analyses.
4. Imports XLSX/PDF, rapprochements et rapports d’anomalies.
5. Supabase, migrations, RLS, stockage, Google Calendar dégradé et temps réel.
6. Tests, responsive, PWA, documentation et déploiement Vercel.

## Schéma

Le schéma SQL couvre organisations/établissements, profils et permissions, CRM, catalogue versionné, devis/factures/paiements, interventions et temps-personnes, charges/actifs, objectifs/capacité, calendriers, avis, documents, conversations, notifications et journaux. Les UUID sont internes ; `legacy_id`, `legacy_row` et les empreintes d’import conservent la traçabilité historique.

## Risques et réponses

- **Fichiers sources absents** : l’importateur et les tests synthétiques sont implémentés ; la validation finale sur les vrais PDF/XLSX reste conditionnée à leur ajout.
- **Identifiants externes absents** : l’application reste utilisable en mode démo ; les écrans de configuration indiquent les variables manquantes.
- **Rapprochement incertain** : aucun lien client/devis/facture n’est appliqué sous le seuil sans validation humaine.
- **Données financières** : calculs en centimes/`Decimal`, statuts facture et paiement séparés, mutations auditées.
- **Périmètre large** : priorité aux parcours quotidiens réellement utilisables ; les connecteurs externes restent des adaptateurs documentés.

## Hypothèses

- Orange est le seul établissement actif en V1, mais toutes les données sont multi-établissements.
- Alban et Melvyn sont les deux associés de démonstration.
- Henrri reste la source légale des numéros et documents ; ADetailing ne génère aucune facture officielle.
- Les données de démonstration sont fictives et anonymisées.

## Suivi

- [x] Inspection initiale et lecture du brief
- [x] Socle applicatif
- [x] Tranches métier principales
- [x] Imports et base Supabase
- [x] Tests et documentation
- [x] QA desktop/mobile et build de production

## Validation finale

- ESLint, TypeScript strict et build Next.js de production validés.
- 23 tests unitaires/intégration et le parcours E2E desktop validés.
- Contrôle navigateur réel desktop et mobile : hydratation, ajout global, navigation responsive et calendrier avec événements.
- Validation sur les fichiers privés réels à effectuer dès que le XLSX et les deux PDF Henrri seront ajoutés au workspace.
