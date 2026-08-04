# Connexion Google Calendar

Chaque utilisateur ADetailing peut connecter son propre compte Google. Seules les prestations auxquelles cet utilisateur est affecté sont exportées vers le calendrier qu’il choisit.

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
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback
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

## 3. Appliquer la migration Supabase

Depuis le dossier du projet :

```powershell
npx supabase db push
```

La migration `202608040012_google_calendar_user_connections.sql` ajoute les règles de suppression, isole chaque jeton à son propriétaire et empêche les doublons de synchronisation.

## 4. Connecter le compte

1. Redémarrer `npm run dev` après toute modification de `.env.local`.
2. Ouvrir **Paramètres > Intégrations**.
3. Cliquer sur **Connecter mon Google Calendar**.
4. Autoriser l’accès chez Google.
5. Choisir un calendrier modifiable puis enregistrer.
6. Cliquer sur **Synchroniser maintenant** pour la première synchronisation.

La création ou la modification d’une prestation déclenche ensuite une synchronisation en arrière-plan pour l’utilisateur connecté. Le bouton manuel permet de forcer une réconciliation.

## Comportement et sécurité

- le jeton de renouvellement Google est chiffré en AES-256-GCM avant stockage ;
- la clé de chiffrement reste uniquement dans les variables serveur ;
- une connexion et ses correspondances d’événements sont lisibles uniquement par leur propriétaire grâce aux politiques RLS ;
- l’identifiant aléatoire OAuth est lié à l’utilisateur et à l’entreprise active pendant dix minutes ;
- une prestation annulée, déplanifiée ou retirée de l’utilisateur est supprimée du calendrier à la synchronisation suivante ;
- déconnecter un compte révoque l’autorisation, mais conserve dans Google les événements déjà créés pour éviter une suppression surprise.

Les routes utilisées sont `/api/integrations/google/start`, `/callback`, `/calendars` et `/sync`.
