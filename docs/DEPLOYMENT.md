# Déploiement Vercel

1. Créer un projet Supabase dans la région la plus proche des utilisateurs.
2. Appliquer toutes les migrations avec `supabase db push`. Le fichier `supabase/seed.sql` est optionnel et réservé aux référentiels historiques.
3. Créer le premier compte depuis `/connexion`. Le profil, l’organisation, l’établissement et les référentiels initiaux sont provisionnés automatiquement.
4. Importer le dépôt GitHub dans Vercel. Le preset Next.js et les commandes du projet sont détectés automatiquement.
5. Déclarer les variables obligatoires ci-dessous dans les environnements Preview et Production.
6. Définir `NEXT_PUBLIC_APP_URL` avec l’URL publique de production, sans slash final, puis redéployer.
7. Dans Supabase, ouvrir **Authentication → URL Configuration** et renseigner :
   - **Site URL** : l’URL publique de production ;
   - **Redirect URLs** : `<URL_DE_PRODUCTION>/auth/callback` et `<URL_DE_PRODUCTION>/auth/callback?next=/compte`.
8. Vérifier `/connexion`, la confirmation d’inscription, la réinitialisation du mot de passe, `/dashboard` et `/planning`.

## Variables obligatoires en production

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL`

`SUPABASE_SERVICE_ROLE_KEY` n’est pas utilisée par l’application actuelle et ne doit pas être ajoutée à Vercel sans besoin serveur explicite.

Pour Google Calendar, ajouter aussi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `OAUTH_TOKEN_ENCRYPTION_KEY`. L’URL de retour est construite automatiquement depuis le domaine qui lance la connexion.

Ne copiez jamais `.env.local` dans GitHub. Les variables secrètes doivent être ajoutées uniquement dans les paramètres Vercel.

## Contrôles avant mise en ligne

```bash
npm ci
npm run verify
```

Vérifier dans Supabase que RLS est actif, que les buckets `documents` et `intervention-photos` sont privés et qu’un employé ne peut pas lire les tables financières sans permission `finance.read`.
