# Docker Dev/Prod Release Flow

Use one topology in both environments:
- `serverthing` calls `arm-bridge` over internal Docker network.
- `arm-bridge` runs in `mock` mode for dev and `live` mode for prod.

Optional dev parity mode:
- Set `ARM_BRIDGE_MODE=ssh` in `.env.dev` to make local bridge read/write DockServer ARM files over SSH.

## 1) Local Dev (Mac mini)

```bash
cd ServerThing
cp .env.dev.example .env.dev
# edit ARM_BRIDGE_API_KEY if desired

docker compose --env-file .env.dev -f compose.dev.yaml up -d --build
```

Quick checks:

```bash
docker compose --env-file .env.dev -f compose.dev.yaml ps
curl -H "X-API-Key: $(grep '^ARM_BRIDGE_API_KEY=' .env.dev | cut -d= -f2-)" http://localhost:8080/healthz
```

If using `ARM_BRIDGE_MODE=ssh`, ensure:
- `ARM_SSH_KEY_HOST_PATH` points to a valid private key on Mac mini.
- The target host/user/path values in `.env.dev` are correct.

## 2) Build + Push Immutable GHCR Tags

From `ServerThing/`:

```bash
export GHCR_OWNER="your-gh-user-or-org"
export VERSION="v1.0.0"
export SHA_TAG="sha-$(git rev-parse --short HEAD)"

echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GHCR_OWNER" --password-stdin

# serverthing image
docker buildx build \
  --platform linux/amd64 \
  -t "ghcr.io/$GHCR_OWNER/serverthing:$VERSION" \
  -t "ghcr.io/$GHCR_OWNER/serverthing:$SHA_TAG" \
  -t "ghcr.io/$GHCR_OWNER/serverthing:latest" \
  --push .

# arm-bridge image
docker buildx build \
  --platform linux/amd64 \
  -f arm-sidecar/Dockerfile \
  -t "ghcr.io/$GHCR_OWNER/arm-bridge:$VERSION" \
  -t "ghcr.io/$GHCR_OWNER/arm-bridge:$SHA_TAG" \
  -t "ghcr.io/$GHCR_OWNER/arm-bridge:latest" \
  --push arm-sidecar
```

Recommended production pin: explicit `vX.Y.Z` tags for **both** images.

## 3) Production Deploy (DockServer)

On DockServer:

```bash
cd /path/to/ServerThing
cp .env.prod.example .env.prod
# edit .env.prod values

docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml up -d
```

## 4) Update Production

Change `.env.prod`:

```env
SERVERTHING_IMAGE_TAG=v1.0.1
ARM_BRIDGE_IMAGE_TAG=v1.0.1
```

Then redeploy:

```bash
docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml up -d
```

## 5) Roll Back

Set both tags to known-good versions in `.env.prod`, then run the same `pull` + `up -d` commands.

## Notes

- In prod, `arm-bridge` reads real ARM data via:
  - `ARM_HOST_SETTINGS_PATH` -> mounted to `/arm/settings/settings.conf`
  - `ARM_HOST_LOGS_PATH` -> mounted to `/arm/logs`
- In dev, `arm-bridge` mock state persists in `ServerThing/data/arm-bridge-state.json`.
- `serverthing` now uses API mode by default in compose (`http://arm-bridge:8080`).
- SSH envs remain as fallback only and are no longer required for normal compose operation.
