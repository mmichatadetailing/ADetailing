# Fonctionnalités et limites

## Fonctionnel dans la V1

- dashboard avec huit KPI distincts, tâches, alertes, devis, factures et activité ;
- clients séparés des véhicules, recherche globale et détection de doublons ;
- pipeline commercial Kanban avec glisser-déposer et vue tableau ;
- catalogue créé, dupliqué, archivé et réordonné depuis l’interface ;
- interventions multi-lignes, heures individuelles, heures-personnes, coûts et marges ;
- calendrier jour/semaine/mois/liste, glisser-déposer, redimensionnement et conflits ;
- import PDF Henrri, scores de confiance, remises implicites et revue humaine ;
- devis, factures, paiements partiels et rapprochement explicable ;
- charges, investissements liés, objectifs, analyses et simulation de recrutement ;
- comptes Supabase, invitations sécurisées par e-mail, rôles et espaces entreprise partagés ;
- canal général d’équipe et conversations de prestations privées par participants ;
- import XLSX avec prévisualisation, erreurs, doublons, rapport et idempotence `legacy_row` ;
- mode responsive/PWA minimal et données de démonstration persistantes ;
- schéma Supabase, Auth, RLS, stockage privé et audit.

## À configurer

- Supabase pour remplacer la persistance navigateur par PostgreSQL/Storage/Realtime ;
- deux consentements OAuth Google Calendar séparés ;
- domaine et variables Vercel ;
- vrais fichiers `ADetailing Pilotage.xlsx` et PDF privés pour la validation finale des mappings.

## Limites connues

- le mode démonstration n’est pas collaboratif entre navigateurs ;
- le connecteur e-mail et le formulaire du site sont des adaptateurs futurs ;
- le parseur principal traite les PDF texte, pas les scans image sans OCR ;
- aucune facture légale n’est créée ou modifiée dans ADetailing ;
- la synchronisation Google nécessite les identifiants OAuth et une tâche planifiée de réconciliation ;
- les vraies fixtures PDF/XLSX n’étaient pas disponibles pendant l’implémentation, donc leurs variations de mise en page doivent encore être validées.
