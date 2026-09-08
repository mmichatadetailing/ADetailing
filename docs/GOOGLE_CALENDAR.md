# Connexion Google Calendar

Chaque utilisateur ADetailing peut connecter son propre compte Google. Seules les prestations auxquelles cet utilisateur est affecté sont exportées vers le calendrier qu’il choisit. Les événements créés directement dans ce calendrier Google sont affichés, en lecture seule, sur sa ligne du planning ADetailing. Les associés et administrateurs voient ainsi les calendriers synchronisés de toute l’équipe ; un employé reste limité à son propre planning.

## 1. Configurer Google Cloud

1. Créer ou ouvrir un projet dans Google Cloud Console.
2. Activer **Google Calendar API** dans « API et services ».
3. Configurer l’écran de consentement OAuth. En mode test, ajouter chaque adresse Google autorisée dans les utilisateurs de test.
4. Créer un identifiant **ID client OAuth 2.0** de type **Application Web**.
5. Ajouter ces URI de redirection autorisées, à l’identique :
   - local : `http://localhost:3000/api/integrations/google/callback` ;
   - production : `https://VOTRE-DOMAINE.vercel.app/api/integrations/google/callback`.

Google peut refuser la redirection si le protocole, le domaine, le port ou le chemin diffèrent, même légèrement.

## 2. Configurer les variables

Dans `.env.local` pour le développement et dans **Vercel > Project Settings > Environment Variables** pour la production :

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OAUTH_TOKEN_ENCRYPTION_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Générer une clé de chiffrement de 32 octets encodée en base64 avec PowerShell :

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Utiliser une valeur distincte et secrète en production. Ne jamais exposer `GOOGLE_CLIENT_SECRET` ou `OAUTH_TOKEN_ENCRYPTION_KEY` avec le préfixe `NEXT_PUBLIC_`.

Dans Vercel, le champ **Value** de `OAUTH_TOKEN_ENCRYPTION_KEY` doit contenir uniquement le résultat base64 (généralement 44 caractères). Ne pas y coller `OAUTH_TOKEN_ENCRYPTION_KEY=`. La valeur doit être activée pour l’environnement **Production**, puis un nouveau déploiement doit être lancé.

## 3. Appliquer la migration Supabase

Depuis le dossier du projet :

```powershell
npx supabase db push
```

Les migrations `202608040012_google_calendar_user_connections.sql` et `202609080014_shared_google_calendar_events.sql` isolent chaque jeton à son propriétaire, empêchent les doublons et créent la projection sécurisée des événements visible dans le planning d’équipe.

## 4. Connecter le compte

1. Redémarrer `npm run dev` après toute modification de `.env.local`.
2. Ouvrir **Paramètres > Intégrations**.
3. Cliquer sur **Connecter mon Google Calendar**.
4. Autoriser l’accès chez Google.
5. Choisir un calendrier modifiable puis enregistrer.
6. Cliquer sur **Synchroniser maintenant** pour la première synchronisation.

L’URL de retour OAuth est calculée depuis le domaine courant : `localhost` en développement et le domaine Vercel en production. Il ne faut donc pas définir `GOOGLE_REDIRECT_URI` dans Vercel. Pour une Preview Vercel, son URL exacte doit également être autorisée chez Google ; privilégier le domaine de production pour les tests courants.

La création ou la modification d’une prestation déclenche ensuite une synchronisation en arrière-plan pour l’utilisateur connecté. Le bouton manuel force aussi l’actualisation des événements Google partagés des 60 derniers jours et des 305 jours suivants.

Le planning relit la période Google affichée lors de son ouverture, à chaque changement de jour/semaine/mois, au retour sur l’onglet et toutes les 60 secondes tant que la page reste visible. Cette lecture actualise le cache partagé du membre connecté puis charge les caches autorisés des autres collaborateurs. Le bouton **Actualiser Google** force cette lecture. Les événements ADetailing déjà exportés dans Google sont reconnus et ne sont pas affichés une seconde fois.

## Comportement et sécurité

- le jeton de renouvellement Google est chiffré en AES-256-GCM avant stockage ;
- la clé de chiffrement reste uniquement dans les variables serveur ;
- une connexion, son jeton et ses correspondances techniques restent lisibles uniquement par leur propriétaire grâce aux politiques RLS ;
- seule une projection sans jeton OAuth est partagée : titre, période, disponibilité, calendrier, couleur et lieu ;
- les associés et administrateurs peuvent lire les projections de l’entreprise, tandis qu’un employé ne peut lire que les siennes ;
- l’identifiant aléatoire OAuth est lié à l’utilisateur et à l’entreprise active pendant dix minutes ;
- une prestation annulée, déplanifiée ou retirée de l’utilisateur est supprimée du calendrier à la synchronisation suivante ;
- un événement créé dans Google reste géré dans Google : un clic affiche ses détails ; seul son propriétaire reçoit le lien permettant de l’ouvrir dans Google Calendar ;
- les événements Google ne sont jamais transformés en prestations ; la base conserve uniquement leur projection de planning pour permettre le partage entre collaborateurs ;
- déconnecter un compte révoque l’autorisation, mais conserve dans Google les événements déjà créés pour éviter une suppression surprise.

Les routes utilisées sont `/api/integrations/google/start`, `/callback`, `/calendars`, `/events` et `/sync`.
