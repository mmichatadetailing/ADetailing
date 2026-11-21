# Configurer Qonto dans ADetailing

## Ce que fait la connexion

Le logiciel consulte les comptes Qonto en euros de votre entreprise. Il importe
leurs transactions et les rapproche automatiquement avec les paiements, prestations,
factures facultatives, entretiens et échéances de charges du logiciel.

Il ne déclenche aucun virement et ne modifie aucune opération dans Qonto.
Les appels à Qonto sont exclusivement des lectures effectuées par le serveur.

Les nouvelles opérations courantes deviennent
des charges réglées ou des prestations avec leur encaissement, sans validation.
Un paiement existant est relié, pas recréé. Une règle de
charge mensuelle est rapprochée sur une seule échéance, sans ajouter une deuxième
dépense. Les montants et dates de règlement des charges rapprochées sont ensuite
utilisés dans Finances, le dashboard, le bilan mensuel et l’export Excel.

Les identifiants Qonto sont chiffrés dans Supabase. Ils ne sont jamais renvoyés
au navigateur, exportés dans Excel, ni placés dans une variable NEXT_PUBLIC_*.

## 1. Appliquer la migration Supabase

Depuis PowerShell :

```powershell
Set-Location "C:\Users\Malvyn\OneDrive\Bureau\ADetailing"
npx supabase db push
```

Le projet doit être celui déjà lié à votre base de production. Vérifiez le projet
affiché par Supabase avant de valider. Appliquez toutes les migrations jusqu’à `202611210032_qonto_credit_services.sql` incluse. La 031 protège les règlements en espèces ; la 032 ajoute la détection des justificatifs et la déclaration de prestations. Au prochain passage, la synchronisation relit progressivement les pages déjà importées, sans modifier la date de début des créations automatiques. Aucune clé à régénérer.

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
2. Ouvrez **Journal bancaire** dans le menu, ou **Paramètres → Configurer Qonto**.
3. Cliquez sur **Connecter Qonto**.
4. Renseignez l’identifiant API et la clé secrète.
5. Choisissez la première date d’import. Pour rapprocher l’existant, choisissez
   une date antérieure aux paiements et charges déjà saisis.
6. Validez. La connexion vérifie les identifiants et démarre l’import. S’il est volumineux, les prochains passages reprennent automatiquement. Le bouton **Synchroniser maintenant** est facultatif.

Tous les comptes Qonto en euros de cette entreprise sont pris en compte. Les
comptes en devises et les comptes externes agrégés à Qonto ne sont pas importés.
Une entreprise interne ne peut pas être reconnectée à une autre entreprise Qonto
en mélangeant leurs historiques.

## 6. Lire les chiffres

### Consulter la trésorerie actuelle sur le dashboard

La carte **Trésorerie actuelle** affiche la somme des soldes comptabilisés des comptes
Qonto actifs en euros de l’entreprise. Le disponible est indiqué séparément lorsque
Qonto le communique pour tous ces comptes. Ce montant est lu directement auprès de
Qonto : il ne dépend ni du filtre de période du dashboard, ni de l’avancement des
rapprochements, ni d’un calcul « recettes moins charges ». Les comptes clôturés,
les devises étrangères et les comptes bancaires externes ne sont pas inclus.

Le solde est relu à l’ouverture du dashboard, toutes les deux minutes tant que
l’onglet est visible, et au retour sur l’onglet après au moins 30 secondes depuis
la dernière tentative. Le bouton **Actualiser** permet de le relire immédiatement.
La date affichée est celle de la consultation réussie de Qonto. En cas d’échec,
le dernier solde reste visible avec un avertissement ; une donnée absente n’est
jamais remplacée par zéro. Une connexion en pause n’est pas interrogée.

Cette carte est réservée aux associés et administrateurs. Elle ne fait aucun appel
bancaire et n’affiche aucun solde fictif en démonstration. Aucun secret, IBAN ou
détail de transaction n’est renvoyé avec le solde. Elle réutilise la connexion
existante : aucune nouvelle migration ni variable d’environnement n’est nécessaire.

Source des soldes : [API officielle des comptes Qonto](https://docs.qonto.com/api-reference/business-api/organization-accounts/organizations/retrieve-the-authenticated-organization-and-list-bank-accounts).

### Consulter les factures clients et leurs retards

Dans le menu **Factures**, les associés et administrateurs peuvent
consulter le numéro, le client, l’émission, l’échéance et le montant des factures
clients. L’onglet réutilise la connexion existante et lit Qonto à l’ouverture,
au retour sur la fenêtre et périodiquement tant que l’onglet est visible.
Le bouton **Actualiser** permet de relire immédiatement les statuts.
Cliquez sur **Aperçu** à côté d’une facture pour lire son PDF Qonto dans le
logiciel, naviguer entre les pages et le télécharger si besoin. Le PDF est
chargé à la demande, sans l’enregistrer dans le logiciel. Si Qonto ne fournit
pas encore le document, réessayez après sa génération dans Qonto.

Une facture est **En retard** uniquement si Qonto la considère à encaisser et
si son échéance est antérieure au jour courant à Paris. L’échéance du jour n’est
pas un retard. Le solde est affiché lorsque Qonto fournit un montant déjà réglé.
La recherche par client ou numéro et le filtre **En retard** permettent de
retrouver les factures à suivre. La liste est séparée de la facturation interne :
aucun paiement, document comptable ou mouvement Qonto n’est créé ou modifié.
Aucune migration supplémentaire n’est nécessaire pour cette vue.

### Journal et résultat d’activité

Dans **Finances**, **Dashboard**, **Pilotage** et le bilan mensuel exporté, les charges d’activité réglées viennent du **registre interne**, au mois de leur règlement. Un paiement confirmé, importé ou saisi, ne compte qu’une fois. Une prévision, un investissement ou un remboursement fournisseur visible seulement sur Qonto ne modifient pas ces charges. Le traitement des encaissements et des remboursements clients est inchangé.

Pour un achat en liquide : dans **Finances → Charges et matériel**, créez ou modifiez la dépense ponctuelle, cochez **Dépense déjà payée**, puis choisissez **Espèces**. Une ancienne charge payée dont le moyen n’est pas précisé est déjà comprise dans le total : corrigez-la si nécessaire, sans la recréer.

**Vérifier les montants avec Qonto** compare, en lecture seule, les totaux des écritures rapprochées. Les espèces, les saisies sans rapprochement, les débits sans charge rattachée, les remboursements fournisseurs et les écarts de virements groupés sont distingués. Un règlement ou un débit à cheval sur deux mois peut produire un écart mensuel ; ce contrôle n’ajuste pas les écritures.

Le détail **Sur Qonto uniquement** utilise uniquement les opérations Qonto en euros terminées à leur date de règlement (Europe/Paris). Il ne cumule pas un relevé et sa copie dans le logiciel. Il ne comprend ni espèces hors Qonto, ni prévisions, ni virements internes ou financements identifiés. Les remboursements identifiés diminuent les dépenses ou les recettes selon leur sens. Les crédits non identifiés comme des ventes sont indiqués séparément. Ce suivi de trésorerie TTC n’est pas un bénéfice comptable.

- **Débit fournisseur** : rattachement à un règlement existant si la correspondance est unique, sinon création d’une charge ponctuelle réglée pour un nouvel achat. Le logiciel utilise la catégorie connue du fournisseur ou un classement par défaut, sans supposer de TVA récupérable.
- **Abonnement** : un prélèvement identifié de manière unique (fournisseur et échéance proches) peut solder le mois au montant réellement débité. Le tarif prévu des autres mois reste inchangé.
- **Un virement pour deux mensualités** : avec une règle activée, le journal conserve une seule sortie et **Finances → Échéances du mois** affiche les deux charges réglées. L’écart entre les tarifs et le virement reste en trésorerie : ce n’est ni une troisième charge ni une augmentation de tarif. Dans le journal, **Deux échéances réglées** ouvre le mois concerné.
- **Virement client** : un paiement déjà enregistré est pointé ; sinon un dossier identifiable (prestation, facture ou échéance d’entretien) est encaissé. À défaut de dossier, un virement client identifiable crée une prestation terminée et un paiement à la date bancaire.
- **Crédit avec pièce jointe** : un crédit d’activité en euros, définitivement reçu, peut créer une prestation terminée et encaissée même si le nom du payeur manque. Le logiciel lit les [identifiants de pièces de la transaction Qonto](https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions), sans télécharger les fichiers. « Sans pièce jointe » ne veut pas dire « non vérifié ». Si un justificatif est ajouté après le virement, le mouvement est réévalué à sa prochaine importation. Le rapprochement d’un paiement ou dossier existant reste prioritaire, et les virements internes, financements et remboursements ne deviennent pas des ventes.
- **Déclarer une prestation** : dans **Journal bancaire → Entrées**, un associé ou un administrateur peut ouvrir un crédit disponible, choisir le client (ou saisir son nom), modifier l’intitulé puis cliquer sur **Créer ou rattacher la prestation**. Aucune facture requise. En l’absence de nom exploitable, la vente est portée sur « Client à identifier (Qonto) ». Un crédit effectivement rattaché n’est pas encaissé une seconde fois.
- **Affectation incertaine** : en cas de dossiers concurrents le mouvement reste au journal sans doublon. Les sorties restent automatiques, sans validation.
- **Historique** : les anciennes opérations antérieures à l’activation ne créent pas de ventes ni de charges rétroactives. Les écritures déjà réglées peuvent être pointées ; les regroupements, exclusions, annulations et anciens brouillons modifiés ou écartés sont conservés.
- **Statistiques de l’historique interne** : avant le **24 juin 2026** (heure de Paris), les encaissements du logiciel, y compris ceux d’une facture sans prestation associée et les espèces, comptent à leur date de paiement dans les objectifs, graphiques et totaux mensuels et annuels. Les charges d’activité réglées au registre sont incluses même sans lien bancaire. Les mouvements uniquement présents chez Qonto et les simples prévisions ne s’ajoutent pas au résultat enregistré.

#### Règle de virement groupé (migration 030)

La règle utilise un virement témoin confirmé, un compte source, le bénéficiaire et la référence normalisés ainsi que les deux séries de charges de la même entreprise. Seul un débit EUR définitif et unique, proche des deux échéances du même mois (7 jours au plus), est retenu. Le total peut être exact ou arrondi **vers le haut** à l’euro ou au multiple de 5 € suivant. Un nouveau tarif s’applique à sa date d’effet. Un montant différent, deux virements concurrents ou une charge déjà enregistrée ne déclenchent pas de nouvelle charge.

La reprise examine aussi les mois antérieurs déjà importés. Elle ne crée rien pour un mois sans virement. Une ancienne exclusion ou une répartition exceptionnelle nécessite une confirmation ciblant ce virement précis ; elle ne modifie pas la règle des mois suivants. Une annulation bancaire rouvre les deux échéances, et relancer la synchronisation ne double pas les montants.

Administration : après avoir vérifié l’entreprise, les identifiants, les montants et les dates, l’opérateur de la base peut appeler `enable_qonto_monthly_split(entreprise, virement_témoin, première_charge, deuxième_charge)`. Pour un historique explicitement confirmé, `confirm_qonto_split_history(entreprise, règle, virement, date_bancaire_Paris, débit_centimes, part_1_centimes, part_2_centimes)` conserve séparément la différence signée. `apply_qonto_split_history(entreprise)` rejoue les correspondances admissibles. Ces opérations ne sont pas des boutons de traitement manuel, ne sont pas accessibles aux utilisateurs de l’API et ne font aucun virement chez Qonto.

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

Les coûts d’hébergement restent soumis à vos abonnements et quotas. Vercel réserve
Hobby aux usages personnels non commerciaux : vérifiez que votre forfait autorise
l’usage professionnel du logiciel. Cette intégration n’achète aucun abonnement.

## 8. Corrections et pause

Un débit ou un crédit corrigé ou annulé dans Qonto invalide son écriture automatique au passage suivant. Un paiement saisi indépendamment ou un regroupement historique n’est pas supprimé. **Mettre en pause** suspend la synchronisation ; **Déconnecter** efface les identifiants sans effacer les données.

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
| Historique incomplet | Le prochain passage reprend automatiquement. L’import est volontairement découpé pour respecter les limites d’exécution. |
| Mouvement sans affectation | Le journal conserve les mouvements incertains sans créer d’écriture en double. Aucun réglage à activer. |

## Sources officielles

- [Authentification API Qonto](https://docs.qonto.com/guides/authentication/api-key)
- [Liste et statuts des transactions](https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions)
- [Configurer un Cron Vercel](https://vercel.com/docs/cron-jobs/quickstart)
- [Sécuriser les tâches Vercel et consulter leurs logs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Conditions du forfait Hobby Vercel](https://vercel.com/docs/plans/hobby)
