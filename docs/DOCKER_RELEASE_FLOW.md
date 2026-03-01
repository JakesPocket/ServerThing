# Docker Dev/Prod Release Flow

Use the Mac mini container as your staging/dev runtime and deploy pinned GHCR tags to DockServer for production.

## 1) Local Dev (Mac mini)

Run ServerThing from source with Docker:

```bash
cd ServerThing
docker compose -f compose.dev.yaml up -d --build
```

The dev compose file uses:
- `.env.dockserver` for app settings.
- `MAKEMKV_SSH_KEY_HOST_PATH` (optional) for host SSH key path override.
- `/run/secrets/makemkv_ssh_key` inside container as the effective key path.

## 2) Build + Push Immutable GHCR Tags

From `ServerThing/`:

```bash
export GHCR_OWNER="your-gh-user-or-org"
export VERSION="v1.0.0"
export SHA_TAG="sha-$(git rev-parse --short HEAD)"

echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GHCR_OWNER" --password-stdin

docker buildx build \
  --platform linux/amd64 \
  -t "ghcr.io/$GHCR_OWNER/serverthing:$VERSION" \
  -t "ghcr.io/$GHCR_OWNER/serverthing:$SHA_TAG" \
  -t "ghcr.io/$GHCR_OWNER/serverthing:latest" \
  --push .
```

Recommended production pin: `vX.Y.Z` (and optionally keep `sha-*` for exact rollback).

## 3) Production Deploy (DockServer)

On DockServer, in your deployment directory:

```bash
cp /path/to/repo/ServerThing/.env.prod.example .env.prod
# edit .env.prod values (GHCR_OWNER, SERVERTHING_IMAGE_TAG, MAKEMKV_SSH_KEY_HOST_PATH)

docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml up -d
```

## 4) Update Production to a New Version

Change only:

```env
SERVERTHING_IMAGE_TAG=v1.0.1
```

Then redeploy:

```bash
docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml up -d
```

## 5) Roll Back

Set:

```env
SERVERTHING_IMAGE_TAG=<previous-tag>
```

Then run the same `pull` + `up -d` commands.

## Notes

- Keep `latest` for convenience in dev; pin explicit tags in production.
- If `.env.dockserver` changes, recreate the container (`up -d` is enough for compose-managed env changes).
- For MakeMKV SSH access inside containers, ensure:
  - Host key exists at `MAKEMKV_SSH_KEY_HOST_PATH`.
  - `.env.dockserver` includes `MAKEMKV_SSH_KEY_PATH=/run/secrets/makemkv_ssh_key`.
