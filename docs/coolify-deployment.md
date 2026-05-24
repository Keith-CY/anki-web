# Coolify Deployment Runbook

This runbook is for deploying `anki-web` to Coolify with the included Dockerfile.

## Deployment Target

- Coolify: `https://board.random-walk.co.jp/`
- Git repository: `https://github.com/Keith-CY/anki-web`
- Branch: `main`
- Build pack: `Dockerfile`
- Dockerfile path: `/Dockerfile`
- Exposed port: `3000`
- Persistent data path: `/data`
- Health endpoint: `/health`

## Preflight

1. Confirm the deployer can log in to Coolify.
2. Confirm Coolify can reach the GitHub repository.
3. Confirm the target server has enough disk space for a Node build and a persistent `/data` volume.
4. Decide the public domain. Coolify can generate an `sslip.io` domain, or you can set a real domain before deployment.

If an `anki-web` project or application already exists in Coolify, reuse it instead of creating a duplicate. Verify that it points to the repository and branch above.

## Create The Application

1. Open Coolify and select the target team.
2. Create a project named `anki-web`, or open the existing `anki-web` project.
3. Open the `production` environment.
4. Click `+ Add Resource`.
5. Select `Applications` -> `Git Based` -> `Public Repository`.
6. Set the repository URL to:

   ```text
   https://github.com/Keith-CY/anki-web
   ```

7. Click `Check repository`.
8. Use branch `main`.
9. Select build pack `Dockerfile`.
10. Set base directory to `/`.
11. Set Dockerfile location to `/Dockerfile`.
12. Set exposed port to `3000`.
13. Continue to create the application.
14. Rename the application to `anki-web` and save.

Do not use the `Nixpacks` build pack for production. The Dockerfile intentionally builds native SQLite and Argon2 modules in a Node 22 image.

## Configure Environment Variables

Open the application's `Environment Variables` tab and add the variables below.

Required:

```dotenv
APP_PASSWORD_HASH=<argon2id hash>
SESSION_SECRET=<random string at least 32 characters>
DATA_DIR=/data
DATABASE_URL=/data/anki-web.db
```

Recommended optional defaults:

```dotenv
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
```

Optional, only if AI generation and TTS should be enabled:

```dotenv
OPENAI_API_KEY=<OpenAI or OpenAI-compatible API key>
OPENAI_BASE_URL=<optional OpenAI-compatible base URL>
PITCH_ACCENT_LEXICON_SOURCE=<optional source label>
```

Generate the password hash locally so the cleartext password is not stored in Coolify:

```bash
APP_PASSWORD='replace-with-a-long-private-password'
bun run hash:password -- "$APP_PASSWORD"
```

Copy only the printed `APP_PASSWORD_HASH=...` value into Coolify, then store the cleartext password in the team's password manager. Leave `APP_PASSWORD` unset when `APP_PASSWORD_HASH` is set.

Generate a session secret:

```bash
openssl rand -base64 48
```

The session secret must stay stable across deployments, otherwise existing browser sessions will be signed out.

## Configure Persistent Storage

Open `Persistent Storage` for the application and add a volume:

- Type: Docker volume or Coolify managed volume
- Name: `anki-web-data`
- Mount path: `/data`

The application stores the SQLite database and imported/exported package data under `/data`. If the mount path is wrong or missing, data will be lost when the container is recreated.

## Configure Health Check

The Dockerfile already defines a container health check against:

```text
GET http://127.0.0.1:3000/health
```

If Coolify requires an explicit health check, use:

- Path: `/health`
- Port: `3000`
- Expected status: `200`

The response body should be:

```json
{"ok":true}
```

## Deploy

1. Save all configuration changes.
2. Click `Deploy`.
3. Watch the deployment logs.
4. Wait until the application is marked running or healthy.

## Validate

Use the generated or configured application domain.

1. Open `/health` and confirm it returns `{"ok":true}`.
2. Open `/` and confirm the login screen appears.
3. Log in with the cleartext password used to generate `APP_PASSWORD_HASH`.
4. Confirm the app can create or import a deck.
5. Restart or redeploy the application and confirm the deck still exists. This validates the `/data` volume.

## Troubleshooting

`APP_PASSWORD or APP_PASSWORD_HASH must be set in production.`

Set `APP_PASSWORD_HASH` or `APP_PASSWORD`. Prefer `APP_PASSWORD_HASH`.

`SESSION_SECRET must be at least 32 characters in production.`

Set a longer `SESSION_SECRET` and keep it stable.

The build uses Nixpacks or fails on native modules.

Switch the application build pack to `Dockerfile`. The Dockerfile rebuilds native modules in the build image.

The app starts but data disappears after redeploy.

Check `Persistent Storage` and confirm the volume mount path is exactly `/data`.

The app returns 502 or does not route traffic.

Confirm the exposed port is `3000`, the container is healthy, and Coolify has a domain assigned.

Coolify UI loads as a blank page.

Wait for the page to finish loading, then reload from the Dashboard instead of a deep link. If the UI remains unreliable, create a Coolify API token and use Coolify's API to finish environment variable and deployment operations.
