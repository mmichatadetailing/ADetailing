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

## Planning : fiches latérales

Les prestations, événements internes et événements Google s’ouvrent dans une fiche à droite du calendrier sur ordinateur, ou en plein écran avec un bouton de retour sur mobile. Les flèches de la fiche parcourent chronologiquement les événements de la période et des filtres affichés. Le calendrier reste monté pendant la consultation et l’enregistrement.

Les brouillons sont protégés lors de la fermeture ou du changement de fiche et avant de recharger l’onglet. Chaque section conserve son propre état de saisie : enregistrer les détails ne valide pas un paiement en cours de saisie. Fermer l’édition masque les champs sans abandonner le brouillon. Les événements Google restent en lecture seule. Le déplacement à la souris est suspendu tant qu’une fiche est ouverte pour ne pas écraser son créneau en cours d’édition.

Les prestations sans créneau sont regroupées dans un tiroir horizontal repliable au-dessus du calendrier. Son état est mémorisé, le compteur de la barre d’outils permet de le retrouver même avec un filtre incompatible, et les cartes peuvent être ouvertes ou glissées vers la timeline sans réduire la largeur du planning.

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
