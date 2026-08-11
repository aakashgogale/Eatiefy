# Deployment (safe process)

## Do not execute shell from HTTP

The `/api/deploy` endpoint **never runs shell commands**.

It only:

1. Verifies `X-Hub-Signature-256` against `DEPLOY_SECRET`
2. Allowlists GitHub event types (`push`, `workflow_run`, `deployment`, `ping`)
3. Returns `202 Accepted` so an external CI/CD system can react

## Recommended production deploy

1. Push to the release branch
2. GitHub Actions / CI builds and runs tests (`npm test`)
3. CI SSHes to the host **or** uses a platform deploy (PM2 pull + restart)
4. Example safe CD step (on the server, triggered by CI — not by Express):

```bash
cd /var/www/eatiefy
git fetch --all
git checkout <release-sha>
cd Backend && npm ci --omit=dev
pm2 reload ecosystem.config.cjs --update-env
```

## Local / Hostinger notes

- Prefer platform-native deploy hooks that run a **fixed** script path owned by the deploy user
- Never pass user-controlled strings into `exec` / `spawn` from request bodies
- Keep `DEPLOY_SECRET` in the environment only; rotate if leaked

## Rollback

1. `git checkout <previous-sha>`
2. `npm ci --omit=dev`
3. `pm2 reload ecosystem.config.cjs`
