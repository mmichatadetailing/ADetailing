# Export Excel

L’icône Excel en haut de l’application et le bouton « Exporter les données Excel »
dans Paramètres ouvrent le même téléchargement. Cette action est réservée aux
associés et administrateurs.

Le fichier couvre toutes les périodes des données métier disponibles de
l’entreprise active. En mode connecté, les données sont relues depuis Supabase,
avec pagination et les droits du compte connecté. En démonstration, ce sont les
données du navigateur. Les modifications en attente sont traitées avant l’export.

La synthèse propose des liens vers les onglets. Les tableaux ont des filtres et
des en-têtes figés. Les dates sont de vraies dates Excel, les heures sont celles
de Paris, les montants sont numériques en euros et les téléphones restent du texte.
Les identifiants permettent de relier les tableaux détaillés.

- Paiements : chaque encaissement apparaît une fois, y compris les forfaits payés
  d’avance. La valeur analytique des visites n’ajoute aucun paiement.
- Bilan mensuel : mêmes règles d’objectifs, d’encaissements et de charges que
  l’application. Les charges futures ne sont pas affichées comme déjà décaissées.
- Charges : règles récurrentes et anciens tarifs conservés, avec leurs dates de
  validité. Une ligne récurrente ne représente pas une seule dépense ponctuelle.
- Prestations, affectations, lignes de prestations, formules, tarifs et lignes
  de documents : onglets séparés pour préserver les détails sans multiplier les
  encaissements ni perdre les relations.
- Messages : uniquement les conversations accessibles au compte qui exporte.

Ce fichier contient des coordonnées et des informations confidentielles. Il
n’inclut aucun mot de passe, jeton Google ou clé Supabase. Les PDF, photos,
événements provenant de Google et données définitivement supprimées ne sont pas
inclus. Il s’agit d’un export de consultation, pas d’une sauvegarde restaurable
ni d’un fichier à réimporter avec l’outil d’import historique.

Aucune migration de base de données n’est nécessaire pour cette fonctionnalité.
