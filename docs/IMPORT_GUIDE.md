# Guide d’import

## Classeur historique

Ouvrir **Paramètres → Import historique XLSX** et déposer `ADetailing Pilotage.xlsx`.

La prévisualisation :

- détecte Prestations, Charges, Objectifs mensuels, Planning capacité, Paramètres, ancien pipeline commercial et Investissements ;
- ignore Dashboard et Synthèses ;
- normalise les dates, téléphones et montants ;
- propose les doublons par e-mail, téléphone et nom ;
- affiche les erreurs avant écriture.

Après validation, le rapport indique les lignes créées, ignorées et à vérifier. `legacy_row` assure l’idempotence locale ; en Supabase, compléter avec `file_hash` et `import_fingerprint`.

## PDF Henrri (historique)

L’import PDF Henrri n’est plus proposé dans le menu : **Factures** affiche uniquement les factures clients Qonto. Les données importées auparavant et leurs liens avec les prestations sont conservés. Le script de prévisualisation ci-dessous reste disponible pour examiner un PDF sans l’importer.

Une facture importée démarre avec un paiement **non payé**. Le moyen de paiement prévu ne vaut jamais preuve d’encaissement.

## Fixtures privées manquantes

Placer les fichiers réels dans `private-fixtures/` (répertoire ignoré par Git), puis exécuter :

```bash
npm run dev
npm run import:preview -- "private-fixtures/DEVIS-I-26-05-17-BRIVE.pdf"
npm run import:preview -- "private-fixtures/FACTURE-26-06-6-DULTEC-2.0.pdf"
npm run import:preview -- "private-fixtures/ADetailing Pilotage.xlsx"
```

Comparer la sortie à la revue attendue avant tout import de production.

