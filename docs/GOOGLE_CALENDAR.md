# Connexion Google Calendar

## Projet Google Cloud

1. Créer un projet Google Cloud et activer Google Calendar API.
2. Configurer l’écran de consentement OAuth interne/externe selon le domaine.
3. Créer un client OAuth de type Web.
4. Ajouter l’URI locale `http://localhost:3000/api/integrations/google/callback` puis l’URI Vercel équivalente.
5. Déclarer les identifiants dans `.env.local` ou Vercel.

## Sécurité

Le consentement est demandé séparément à Alban et Melvyn. Le refresh token est chiffré en AES-256-GCM avant stockage ; la clé de chiffrement n’est jamais enregistrée en base. Les événements personnels importés doivent être rendus comme `Indisponible` sans exposer leur titre aux autres utilisateurs.

## Flux implémenté

- `/api/integrations/google/start` : état OAuth HTTP-only et redirection Google ;
- `/api/integrations/google/callback` : validation de l’état, échange du code et stockage chiffré ;
- `/api/integrations/google/calendars` : liste serveur des calendriers disponibles ;
- helpers serveur de lecture des événements et création/mise à jour d’événements ADetailing.

Le calendrier interne reste disponible si l’intégration est absente ou en erreur. Pour la production, planifier la réconciliation périodique via Vercel Cron ou Supabase Cron et journaliser chaque conflit dans `calendar_event_mappings`.

