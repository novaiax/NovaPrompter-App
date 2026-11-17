# Serveur de synchronisation NovaPrompter

L’API facultative permet de synchroniser les scripts entre les clients Windows et web. Le serveur utilise Node.js, Express et PostgreSQL.

## Configuration

- `DATABASE_URL` désigne votre base PostgreSQL.
- `JWT_SECRET` est un secret de signature aléatoire d’au moins 32 caractères. Configurez sa valeur dans votre environnement de déploiement.
- `PORT` vaut 3000 par défaut. `NODE_ENV=production` active la vérification TLS pour la connexion PostgreSQL. Pour le développement local avec PostgreSQL sans TLS, utilisez `PGSSLMODE=disable`.

Pour lancer l’API localement avec les variables ci-dessus renseignées, utilisez les commandes suivantes depuis `backend/`.

```bash
npm ci
node --test
npm start
```

Pour un déploiement Railway, ajoutez un service PostgreSQL, référencez sa connexion via `DATABASE_URL` et renseignez `JWT_SECRET` dans les variables du service API. Une fois le service démarré, configurez son domaine HTTPS.

## Connexion des clients

Dans **Réglages → Intégrations** sur Windows ou **Réglages → Synchronisation** sur le web, renseignez votre adresse HTTPS, puis connectez-vous ou créez un compte. Le client transmet les scripts au serveur lorsque vous déclenchez une synchronisation ou activez l’envoi automatique.

## API

| Méthode | Route | Usage |
| --- | --- | --- |
| POST | `/auth/register` | Créer un compte |
| POST | `/auth/login` | Se connecter |
| GET | `/me` | Consulter le compte authentifié |
| POST | `/sync` | Envoyer et recevoir les scripts, repères et réglages |
| DELETE | `/scripts/:id` | Marquer un script comme supprimé |
| GET | `/health` | Vérifier l’état du service |

Les mots de passe sont hachés avec bcrypt. Les modifications de scripts sont résolues à partir de leur date de mise à jour.
