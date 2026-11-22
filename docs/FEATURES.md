# Fonctionnalités et limites

## Fonctionnel dans la V1

- dashboard avec sept KPI distincts, objectifs fondés sur les encaissements, classement des plus grosses charges de la période, tâches, alertes et activité ;
- clients séparés des véhicules, recherche globale, détection de doublons et suppression rapide sans perdre l’historique légal ;
- création directe de prestations à venir ou déjà réalisées, sans passage obligatoire par un pipeline commercial ;
- catalogue créé, dupliqué, archivé et réordonné depuis l’interface ;
- interventions multi-lignes, heures individuelles, heures-personnes, coûts, marges et suppression rapide avec nettoyage des paiements manuels ;
- calendrier jour/semaine/mois/liste, glisser-déposer, redimensionnement et conflits ;
- import PDF Henrri, scores de confiance, remises implicites et revue humaine ;
- encaissement direct des prestations, paiements partiels et factures facultatives avec rapprochement explicable ;
- charges ponctuelles, mensuelles et annuelles projetées à leurs échéances, calendrier mensuel, prévision glissante sur douze mois, investissements liés, objectifs mensuels avec total annuel automatique, analyses et simulation de recrutement ;
- comptes Supabase, invitations sécurisées par e-mail, rôles et espaces entreprise partagés ;
- canal général d’équipe et conversations de prestations privées par participants ;
- import XLSX avec prévisualisation, erreurs, doublons, rapport et idempotence `legacy_row` ;
- mode responsive/PWA minimal et données de démonstration persistantes ;
- schéma Supabase, Auth, RLS, stockage privé et audit.

## Planning : fiches latérales

Les prestations, événements internes et événements Google s’ouvrent dans une fiche à droite du calendrier sur ordinateur, ou en plein écran avec un bouton de retour sur mobile. Les flèches de la fiche parcourent chronologiquement les événements de la période et des filtres affichés. Le calendrier reste monté pendant la consultation et l’enregistrement.

Les brouillons sont protégés lors de la fermeture ou du changement de fiche et avant de recharger l’onglet. Chaque section conserve son propre état de saisie : enregistrer les détails ne valide pas un paiement en cours de saisie. Fermer l’édition masque les champs sans abandonner le brouillon. Les événements Google restent en lecture seule. Le déplacement à la souris est suspendu tant qu’une fiche est ouverte pour ne pas écraser son créneau en cours d’édition.

Les prestations sans créneau sont regroupées dans un tiroir horizontal repliable au-dessus du calendrier. Son état est mémorisé, le compteur de la barre d’outils permet de le retrouver même avec un filtre incompatible, et les cartes peuvent être ouvertes ou glissées vers la timeline sans réduire la largeur du planning.

Les déplacements sont appliqués immédiatement puis enregistrés en arrière-plan. Une action « Annuler » reste disponible pendant huit secondes. Avant tout chevauchement avec une prestation, un événement interne ou un créneau Google occupé, une confirmation liste précisément les éléments concernés. Sur écran tactile, l’action « Déplacer » de la fiche permet de choisir la date, l’heure, la durée et le collaborateur sans utiliser le glisser-déposer.

Les événements Google synchronisés sont projetés sur la ligne de leur propriétaire. Les associés et administrateurs voient les créneaux Google de tous les membres connectés, alors que les employés restent limités à leur propre calendrier. Les jetons OAuth et les liens privés Google ne sont jamais partagés entre comptes.

## Lire les chiffres d’une période

Le dashboard et Pilotage utilisent le même mois ou la même année. Les liens vers
les prestations réalisées, les échéances et les objectifs ouvrent la période
consultée. Les dates de rattachement sont celles de Paris.

- **Objectif et CA encaissé** : c’est la date du paiement qui compte, espèces et
  contrats d’entretien inclus. Une visite prépayée ne génère pas un deuxième
  encaissement. L’objectif annuel est la somme des douze objectifs mensuels.
- **Panier et marge** : c’est la date de la prestation terminée qui compte. Le
  panier est sa valeur moyenne, même si elle sera payée plus tard. La marge
  déduit les coûts directs ; sa valeur horaire utilise les heures-personnes.
- **Charges de la période** : les dépenses réglées sont datées au paiement, toutes
  familles confondues. Le reste à payer correspond aux échéances de la période
  encore ouvertes aujourd’hui. Un prélèvement estimé n’est pas un paiement.
- **Finances → Prévisions → Abonnements détectés** : distingue une mensualité
  estimée dès le premier débit d’un rythme mensuel confirmé. Le débit réel solde
  l’échéance au lieu de créer une deuxième dépense.
- **Résultat d’activité** : seuls les frais fixes et variables réglés sont déduits
  des encaissements enregistrés, nets des remboursements clients identifiés. Il
  ne s’agit ni de la marge des prestations ni du solde bancaire.

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
