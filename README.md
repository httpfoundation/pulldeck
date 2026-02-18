# Docker Manager

A lightweight REST API that runs on your server and manages Docker containers remotely. It is designed to slot into CI/CD pipelines — push a new image, then tell Docker Manager to pull it and rebuild the affected containers, all over HTTP.

## How It Works

Docker Manager runs as a Docker container on your server with access to the host's Docker socket. When it receives an API request it can:

1. **Pull** the latest version of a container image from a registry (Docker Hub, GHCR, or any OCI-compatible registry).
2. **Find** every container on the host that uses a given image.
3. **Rebuild** those containers in-place using `docker compose`, so the running service is replaced with the updated image.

Authentication is handled via a Bearer token that you define at startup. All `/api/*` endpoints require this token.

## Quick Start

### 1. Create an environment file

Create a `.docker-manager.env` file on your server:

```env
# REQUIRED: Static token for API authentication
# Generate a secure random string (e.g., openssl rand -hex 32)
AUTH_TOKEN=your-secret-token

# OPTIONAL: GitHub Personal Access Token for private GHCR images
# Required scopes: read:packages
# Only needed if pulling private images from ghcr.io
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# OPTIONAL: Username and password used for authenticating with private images
# Used for GHCR if GITHUB_TOKEN is not provided, or for other private registries
DOCKER_USERNAME=myuser
DOCKER_PASSWORD=mypassword

# OPTIONAL: Server port (default: 3000)
PORT=3000
```

### 2. Start with Docker Compose

Create a `docker-compose.yml` (or add the service to an existing one):

```yaml
services:
  docker-manager:
    image: ghcr.io/httpfoundation/docker-manager:latest
    container_name: docker-manager-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # Mount Docker socket to allow container to manage host Docker
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # Mount host directories containing docker-compose files (see note below)
      - /home/user/apps:/home/user/apps:ro
    env_file:
      - .docker-manager.env
```

#### Mounting host paths

Docker Manager rebuilds containers by reading their `docker compose` labels to find the original compose file and project directory on the host. Because Docker Manager itself runs inside a container, it can only access host paths that are bind-mounted into it.

You must mount every host directory that contains a `docker-compose.yml` for a service you want to manage. Critically, the **container path must be identical to the host path** so that the compose-file references stored in container labels resolve correctly.

```yaml
volumes:
  # ✅ Correct — paths match
  - /home/deploy/my-app:/home/deploy/my-app:ro
  - /opt/services:/opt/services:ro

  # ❌ Wrong — container path differs from host path
  - /home/deploy/my-app:/apps/my-app:ro
```

If you keep all your compose projects under a common parent directory you can mount that single directory:

```yaml
volumes:
  - /home/deploy:/home/deploy:ro
```

> The `:ro` (read-only) flag is recommended — Docker Manager only needs to _read_ compose files. The actual `docker compose up` commands are executed via the Docker socket, not the filesystem.

### 3. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Environment Variables

| Variable          | Required | Default | Description                                  |
| ----------------- | -------- | ------- | -------------------------------------------- |
| `AUTH_TOKEN`      | Yes      | —       | Bearer token for API authentication          |
| `GITHUB_TOKEN`    | No       | —       | GitHub PAT for pulling images from GHCR      |
| `DOCKER_USERNAME` | No       | —       | Username for private Docker registries       |
| `DOCKER_PASSWORD` | No       | —       | Password for private Docker registries       |
| `PORT`            | No       | `3000`  | Port the API listens on inside the container |

## Usage with GitHub Actions

The [`httpfoundation/docker-manager-deploy-action`](https://github.com/httpfoundation/docker-manager-deploy-action) GitHub Action wraps the API calls into a single step. It pulls the latest image and rebuilds every container that uses it.

### Minimal Example

By default the action derives the image name from the current repository (`ghcr.io/<owner>/<repo>:latest`):

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ... your build & push steps ...

      - uses: httpfoundation/docker-manager-deploy-action@v1
        with:
          base-url: ${{ secrets.DOCKER_MANAGER_BASE_URL }}
          token: ${{ secrets.DOCKER_MANAGER_TOKEN }}
```

### With an Explicit Image

```yaml
- uses: httpfoundation/docker-manager-deploy-action@v1
  with:
    base-url: ${{ secrets.DOCKER_MANAGER_BASE_URL }}
    token: ${{ secrets.DOCKER_MANAGER_TOKEN }}
    image: ghcr.io/my-org/my-app:latest
```

### Action Inputs

| Input      | Required | Description                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `base-url` | Yes      | The URL where Docker Manager is running (e.g. `https://deploy.example.com`)                                |
| `token`    | Yes      | The `AUTH_TOKEN` you configured on the server                                                              |
| `image`    | No       | Image to rebuild. Defaults to `ghcr.io/<owner>/<repo>:latest` based on the repository running the workflow |

### Secrets Setup

The action requires two secrets: `DOCKER_MANAGER_BASE_URL` and `DOCKER_MANAGER_TOKEN`.

Because these values are typically the same across every repository that deploys to the same server, consider setting them as **organization-level secrets** (Organization Settings → Secrets and variables → Actions) instead of per-repository secrets. Organization secrets can be scoped to all repositories or a subset, and only need to be updated in one place if the server URL or token changes.

Alternatively, add them as repository-level secrets (Repository Settings → Secrets and variables → Actions):

- **`DOCKER_MANAGER_BASE_URL`** — the public URL of your Docker Manager instance (e.g. `https://deploy.example.com`).
- **`DOCKER_MANAGER_TOKEN`** — the value of `AUTH_TOKEN` from your `.docker-manager.env` file.

## API Reference

All endpoints under `/api` require a `Authorization: Bearer <AUTH_TOKEN>` header.

### Health Check

```
GET /health
```

Returns `{"status":"ok"}` — no authentication required. Useful for monitoring and load-balancer probes.

---

### Pull Image

```
POST /api/images/pull
```

Pulls an image from a container registry. Automatically authenticates with registries when a `GITHUB_TOKEN` or `DOCKER_USERNAME`/`DOCKER_PASSWORD` is configured.

**Request body:**

```json
{ "image": "ghcr.io/my-org/my-app:latest" }
```

**Success response:**

```json
{
  "success": true,
  "image": "my-org/my-app",
  "tag": "latest",
  "digest": "sha256:abc123..."
}
```

---

### List Containers

```
POST /api/containers/list
```

Lists all running containers on the host that use a given image.

**Request body:**

```json
{ "image": "ghcr.io/my-org/my-app:latest" }
```

**Success response:**

```json
{
  "success": true,
  "image": "ghcr.io/my-org/my-app:latest",
  "containers": [{ "id": "abc123", "name": "my-app-1", "status": "running" }],
  "count": 1
}
```

---

### Rebuild Container

```
POST /api/containers/rebuild
```

Rebuilds a single container by name. The container must have been started via `docker compose` so that Docker Manager can locate the compose file and service name from container labels.

**Request body:**

```json
{ "container": "my-app-1" }
```

**Success response:**

```json
{
  "success": true,
  "container": "my-app-1",
  "status": "running",
  "message": "Container rebuilt successfully"
}
```

---

### Rebuild Containers by Image

```
POST /api/containers/rebuild-by-image
```

Finds **all** containers (running and stopped) that use a specific image and rebuilds each one via `docker compose`. This is the endpoint used by the GitHub Action.

**Request body:**

```json
{ "image": "ghcr.io/my-org/my-app:latest" }
```

**Success response:**

```json
{
  "success": true,
  "image": "ghcr.io/my-org/my-app:latest",
  "total": 2,
  "successful": 2,
  "failed": 0,
  "skipped": 0,
  "results": [
    { "container": "my-app-1", "status": "success" },
    { "container": "my-app-2", "status": "success" }
  ]
}
```

**Note**: Containers are processed sequentially (one at a time) to avoid resource contention. The operation continues even if some containers fail - check the `results` array for detailed status of each container. Only containers started via docker-compose are rebuilt; others are marked as "skipped" in the response.

---

### Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

| Code                     | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `UNAUTHORIZED`           | Missing or invalid Bearer token                   |
| `INVALID_IMAGE`          | Malformed image name                              |
| `IMAGE_NOT_FOUND`        | Image does not exist in the registry              |
| `REGISTRY_AUTH_FAILED`   | Registry credentials are invalid                  |
| `REGISTRY_TIMEOUT`       | Registry did not respond in time                  |
| `DOCKER_UNAVAILABLE`     | Cannot connect to the Docker daemon               |
| `INVALID_CONTAINER`      | Malformed container identifier                    |
| `CONTAINER_NOT_FOUND`    | No container with that name exists                |
| `COMPOSE_FILE_NOT_FOUND` | The container's compose file could not be located |
| `SERVICE_NOT_FOUND`      | Service not found in the compose file             |
| `BUILD_FAILED`           | `docker compose up` failed                        |
| `PERMISSION_DENIED`      | Insufficient permissions for the operation        |
