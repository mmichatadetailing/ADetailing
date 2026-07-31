# ADetailing Pilotage

Application interne de pilotage opérationnel et financier pour ADetailing Orange. Henrri reste la source légale des devis, factures et numéros de documents ; l’application centralise la relation client, le planning, les coûts, les paiements et la rentabilité.

## Démarrage rapide

Prérequis : Node.js 22 ou 24 et npm 11.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Ouvrir `http://localhost:3000`. Sans variables Supabase, l’application démarre en **mode démonstration** : toutes les actions principales fonctionnent et sont persistées dans le navigateur. Les données peuvent être réinitialisées dans Paramètres.

## Commandes

```bash
npm run dev           # développement
npm run lint          # ESLint
npm run typecheck     # TypeScript strict
npm run test          # tests unitaires et d’intégration
npm run test:e2e      # parcours Playwright desktop/mobile
npm run build         # build de production
npm run verify        # lint + typecheck + tests + build
npm run import:preview -- "chemin/vers/fichier.pdf"
```

Le script de prévisualisation nécessite que `npm run dev` soit lancé. Il accepte les PDF Henrri et les classeurs XLSX.

## Architecture

- `src/app` : routes App Router, pages et endpoints serveur.
- `src/lib/domain` : types, calculs en centimes, statuts et rapprochements.
- `src/lib/demo` : données fictives et store Zustand persistant.
- `src/lib/import` : parseur Henrri déterministe et importateur XLSX.
- `src/lib/supabase` : clients Supabase navigateur/serveur.
- `supabase/migrations` : schéma, contraintes, RLS, audit, storage privé.
- `docs` : déploiement, Google Calendar, import historique et périmètre.

## Variables d’environnement

Voir `.env.example`. Les variables `NEXT_PUBLIC_*` sont les seules exposables au navigateur. `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` et `OAUTH_TOKEN_ENCRYPTION_KEY` restent strictement côté serveur.

Pour générer la clé de chiffrement OAuth :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Base Supabase

Avec la CLI Supabase :

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Les migrations créent les tables métier, les index, les buckets privés, les politiques RLS, les triggers d’audit et le provisionnement sécurisé des nouveaux comptes. Les rôles initiaux sont `admin`, `partner` et `employee` ; seuls les administrateurs et associés gèrent l’équipe.

Une fois les variables Supabase renseignées et les migrations appliquées :

1. le premier utilisateur ouvre `/connexion` puis « Créer un compte » ;
2. il invite ses collaborateurs depuis `/equipe` ;
3. chaque collaborateur utilise son lien personnel, avec l’adresse e-mail invitée, pour créer son compte ou connecter un compte existant.

Tous les membres d’une entreprise chargent les mêmes clients, documents, prestations, réglages et indicateurs. Le canal de discussion général est partagé ; les conversations rattachées à un dossier sont filtrées par participants. Un compte invité dans plusieurs entreprises peut changer d’espace depuis le menu de compte.

## Données et confidentialité

Les données de démonstration sont fictives. Les fichiers `.pdf`, `.xlsx` et `private-fixtures/` sont ignorés par Git. Ne placez jamais les PDF clients réels dans un dépôt public.

Voir [fonctionnalités et limites](docs/FEATURES.md), [déploiement Vercel](docs/DEPLOYMENT.md), [Google Calendar](docs/GOOGLE_CALENDAR.md) et [import historique](docs/IMPORT_GUIDE.md).
