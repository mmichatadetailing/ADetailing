# Configurer Qonto dans ADetailing

## Ce que fait la connexion

Le logiciel consulte les comptes Qonto en euros de votre entreprise. Il importe
leurs transactions et propose leur rapprochement avec les paiements, prestations,
factures facultatives, entretiens et échéances de charges du logiciel.

Il ne déclenche aucun virement et ne modifie aucune opération dans Qonto.
Les appels à Qonto sont exclusivement des lectures effectuées par le serveur.

Une transaction importée ne devient pas automatiquement du chiffre d’affaires ou
une nouvelle charge. Un paiement existant est relié, pas recréé. Une règle de
charge mensuelle est rapprochée sur une seule échéance, sans ajouter une deuxième
dépense. Les montants et dates de règlement des charges rapprochées sont ensuite
utilisés dans Finances, le dashboard, le bilan mensuel et l’export Excel.

Les identifiants Qonto sont chiffrés dans Supabase. Ils ne sont jamais renvoyés
au navigateur, exportés dans Excel, ni placés dans une variable NEXT_PUBLIC_*.

## 1. Appliquer la migration Supabase

Depuis PowerShell :

```powershell
cd "C:\Users\Malvyn\OneDrive\Bureau\ADetailing"
npx supabase db push
```

Le projet doit être celui déjà lié à votre base de production. Vérifiez le projet
affiché par Supabase avant de valider. La migration attendue est
`202611050025_qonto_banking.sql`.

Ne passez pas cette étape : elle crée les tables bancaires, le suivi des règlements
des charges et les protections contre les doublons. Les anciennes données ne sont
pas remplacées. L’application doit être déployée après l’application de la migration.

## 2. Préparer les variables Vercel

Ouvrez votre projet Vercel, puis **Settings → Environment Variables**.
Configurez les valeurs dans l’environnement **Production**. Pour tester un
Preview, configurez aussi cet environnement, idéalement avec une base de test.

| Variable | Valeur à utiliser |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | L’URL Supabase déjà utilisée par l’application. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La clé publique déjà utilisée. |
| `SUPABASE_SERVICE_ROLE_KEY` | La clé serveur `service_role` du même projet Supabase, dans Project Settings → API Keys, section des anciennes clés si nécessaire. Ce n’est pas la clé publique. |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | La clé de chiffrement déjà configurée pour Google Calendar, si elle existe. |
| `CRON_SECRET` | Un nouveau secret aléatoire d’au moins 32 caractères pour protéger la synchronisation planifiée. |

### Générer CRON_SECRET

Dans PowerShell :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiez uniquement le résultat dans la valeur de `CRON_SECRET` sur Vercel.
Ne publiez pas ce résultat et ne l’envoyez pas dans un message.

### Si la clé de chiffrement n’existe pas encore

Générez-la avec cette autre commande :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copiez le résultat dans `OAUTH_TOKEN_ENCRYPTION_KEY`.

**Important : ne remplacez pas une clé de chiffrement existante.** Cela rendrait
illisibles les anciennes connexions Google et Qonto. Conservez la même clé sur
les déploiements qui utilisent la même base. Une modification de variable Vercel
nécessite un nouveau déploiement pour être prise en compte.

## 3. Déployer les modifications

Depuis le dossier du projet :

```powershell
git add .
git commit -m "Ajout connexion Qonto et rapprochement bancaire"
git push
```

Attendez la fin du déploiement Vercel. En cas d’erreur, ouvrez le journal du
déploiement avant de poursuivre. Aucun identifiant Qonto n’est à mettre dans GitHub.

## 4. Retrouver les identifiants Qonto

1. Connectez-vous à Qonto sur le Web avec un compte autorisé à consulter la clé API.
2. Sélectionnez la bonne entreprise si vous en gérez plusieurs.
3. Ouvrez **Paramètres → Intégrations et Avantages → Clé API**. Le libellé peut
   aussi être « Intégrations et partenariats ».
4. Récupérez l’identifiant API et la clé secrète. Sur certains forfaits, il faut
   cliquer sur **Générer** lors de la première utilisation et confirmer sur mobile.
5. Ne cliquez pas sur Régénérer si vous utilisez déjà cette clé dans d’autres outils,
   sauf si vous souhaitez volontairement révoquer ces accès.

Il ne s’agit ni de votre e-mail ni de votre mot de passe Qonto.
Ne partagez pas les identifiants dans le chat ou par capture d’écran.

## 5. Connecter le logiciel

1. Ouvrez le site ADetailing déployé, avec un compte associé ou administrateur.
2. Ouvrez **Banque & rapprochement** dans le menu, ou **Paramètres → Configurer Qonto**.
3. Cliquez sur **Connecter Qonto**.
4. Renseignez l’identifiant API et la clé secrète.
5. Choisissez la première date d’import. Pour rapprocher l’existant, choisissez
   une date antérieure aux paiements et charges déjà saisis.
6. Laissez d’abord le rapprochement automatique décoché pour vérifier les premières
   propositions. Vous pourrez l’activer ensuite.
7. Validez. Le logiciel vérifie Qonto et démarre un premier import.
8. Si « Historique incomplet » apparaît, cliquez à nouveau sur **Synchroniser
   maintenant** jusqu’à la fin. Chaque demande poursuit l’import enregistré,
   sans recréer les transactions des demandes précédentes.

Tous les comptes Qonto en euros de cette entreprise sont pris en compte. Les
comptes en devises et les comptes externes agrégés à Qonto ne sont pas importés.
Une entreprise interne ne peut pas être reconnectée à une autre entreprise Qonto
en mélangeant leurs historiques.

## 6. Rapprocher les opérations

Dans la vue **À traiter**, cliquez sur **Rapprocher**.

### Paiement déjà saisi

Choisissez **Paiement existant**. Aucun encaissement supplémentaire n’est créé.
La date saisie dans le paiement est conservée ; la date de règlement bancaire est
visible séparément dans la transaction.

### Prestation, facture ou entretien pas encore payé

Choisissez le dossier correspondant. Le logiciel crée son paiement à la date et
au montant bancaires, puis met à jour les statistiques habituelles.

Une prestation d’entretien n’est jamais encaissée séparément : sélectionnez
l’échéance du contrat. Le règlement doit couvrir exactement cette échéance.
Les prestations ponctuelles et factures permettent un règlement partiel dans
la limite de leur solde.

### Charge déjà prévue

Sélectionnez la charge **et le bon mois**. Exemple : le prélèvement de septembre
doit être rapproché de l’échéance de septembre, même s’il est passé début octobre.
Le montant doit correspondre exactement à l’échéance. Le coût prévu du mois ne
change pas ; le décaissement suit la date bancaire réelle.

Pour une charge à prélèvement automatique, l’ancienne estimation de paiement de
cette échéance est remplacée par son règlement bancaire. Elle n’est pas additionnée
une seconde fois. Les autres mois conservent leur fonctionnement habituel.
Si vous changez le tarif de cet abonnement en cours de mois après son rapprochement,
le mois déjà réglé conserve son ancien montant ; le nouveau tarif s’applique aux
échéances suivantes. Deux versions du même abonnement ne peuvent pas être réglées
deux fois pour le même mois.

### Dépense qui n’existe pas dans l’application

Choisissez **Créer une nouvelle charge ponctuelle**, puis indiquez le libellé et
la catégorie. Faites-le seulement après avoir vérifié la liste des charges
existantes. Cette action ne crée pas un abonnement. La TVA n’est pas déduite
automatiquement et reste à vérifier selon le justificatif.

### Virement interne, apport ou prêt

Utilisez **Hors exploitation** et indiquez le motif. Ces opérations ne doivent pas
créer artificiellement du chiffre d’affaires ou une charge d’exploitation.
Les virements entre IBAN Qonto connus et les opérations signalées comme internes
par Qonto ne sont pas rapprochés automatiquement.

Les remboursements clients, compensations de frais et virements couvrant plusieurs
dossiers ne sont pas ventilés automatiquement dans cette première version.
Laissez-les à traiter pour vérifier les corrections nécessaires. Ne forcez pas
une correspondance avec un mauvais dossier.

## 7. Activer et contrôler la synchronisation automatique

Le fichier `vercel.json` enregistre une tâche quotidienne à **04:00 UTC**, soit
environ 05:00 en hiver et 06:00 en été en France métropolitaine.

1. Dans Vercel, ouvrez **Settings → Cron Jobs**.
2. Vérifiez que `/api/cron/qonto` apparaît et est actif sur le déploiement Production.
3. Vérifiez que `CRON_SECRET` est bien défini en Production et qu’un déploiement
   a été fait après sa création.
4. Utilisez **Run** si cette action est proposée par Vercel, puis consultez les logs.
5. Dans ADetailing, rechargez la page Banque et vérifiez la date de dernière
   synchronisation. Le bouton manuel permet aussi un contrôle immédiat.

La tâche fonctionne même lorsque personne n’a le logiciel ouvert. Elle ne tourne
pas automatiquement sur les déploiements Preview ni en local. Une exécution
interrompue conserve sa progression ; la suivante reprend les pages restantes.
Le nombre de transactions réimportées peut être non nul à chaque passage : le
logiciel revérifie les deux derniers jours pour rattraper les modifications, en
mettant à jour les mêmes lignes plutôt qu’en les ajoutant de nouveau.

Si vous activez **Rapprocher automatiquement**, seuls les paiements déjà saisis et
les échéances de charges connues sont concernés. Il faut un montant exact, des
dates proches, un nom ou une référence explicite et une correspondance unique
dans les deux sens. Un montant identique seul ne suffit jamais.

Les coûts d’hébergement restent soumis à vos abonnements et quotas. Vercel réserve
Hobby aux usages personnels non commerciaux : vérifiez que votre forfait autorise
l’usage professionnel du logiciel. Cette intégration n’achète aucun abonnement.

## 8. Annuler ou corriger

- **Annuler le traitement** d’un paiement existant retire uniquement son lien bancaire.
- Si le rapprochement avait créé le paiement, son annulation retire cet encaissement
  et le dossier redevient à payer. Une confirmation est demandée.
- Pour une charge, l’annulation retire son règlement bancaire, pas la règle de
  dépense. Ses prévisions restent présentes. Si son prélèvement automatique est
  coché, l’estimation habituelle redevient applicable.
- Les écritures rapprochées ne peuvent pas être supprimées ou modifiées financièrement
  depuis d’autres pages avant l’annulation de leur rapprochement.
- Si Qonto annule une transaction déjà rapprochée ou en change le montant, elle
  apparaît dans **À vérifier**. Le logiciel ne supprime pas silencieusement votre
  historique : vérifiez puis annulez/corrigez le traitement concerné.
- **Mettre en pause** arrête la synchronisation sans effacer les données.
- **Déconnecter** arrête la synchronisation et efface les identifiants chiffrés,
  en conservant les transactions et rapprochements historiques.

## Dépannage

| Message ou symptôme | Vérification |
| --- | --- |
| Migration Qonto requise | Exécuter `npx supabase db push` sur le bon projet. |
| Clé de chiffrement manquante | Configurer `OAUTH_TOKEN_ENCRYPTION_KEY`, puis redéployer sans changer une clé existante. |
| Clé serveur Supabase manquante | Configurer `SUPABASE_SERVICE_ROLE_KEY` du même projet, puis redéployer. |
| Qonto refuse l’accès | Vérifier les deux champs API, la bonne entreprise et une éventuelle régénération de clé. |
| Synchronisation déjà en cours | Attendre la fin du traitement. Un verrou expiré est libéré après deux minutes. |
| Limite Qonto atteinte | Attendre quelques minutes puis relancer. Le curseur n’est pas avancé sur une page échouée. |
| Aucun import automatique | Vérifier le déploiement Production, Cron Jobs, `CRON_SECRET`, la connexion active et les journaux. |
| Historique incomplet | Répéter Synchroniser maintenant. L’import est volontairement découpé pour respecter les limites d’exécution. |
| Aucun rapprochement automatique | Vérifier que l’option est cochée. Une ambiguïté, une devise, un statut non terminé ou un nom imprécis empêche le traitement automatique. |

## Sources officielles

- [Authentification API Qonto](https://docs.qonto.com/guides/authentication/api-key)
- [Liste et statuts des transactions](https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions)
- [Configurer un Cron Vercel](https://vercel.com/docs/cron-jobs/quickstart)
- [Sécuriser les tâches Vercel et consulter leurs logs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Conditions du forfait Hobby Vercel](https://vercel.com/docs/plans/hobby)
