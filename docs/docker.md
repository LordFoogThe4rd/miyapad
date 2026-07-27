# Docker

Miyapad can run inside a Docker container with persistent storage via a named volume. The recommended setup uses docker-compose.

## docker-compose (recommended)

The compose file builds the image, configures the environment, and mounts a persistent storage volume.

```bash
cp server/.env.example server/.env
docker compose -f server/docker-compose.yml up --build -d
```

The server is available at [http://localhost:3000](http://localhost:3000) and restarts automatically unless explicitly stopped.

```bash
docker compose -f server/docker-compose.yml down
```

## Building manually

A standalone image can be built and run without docker-compose:

```bash
docker build -t miyapad -f server/Dockerfile .
docker run -p 3000:3000 miyapad
```

## Configuration

Environment variables are set in `server/.env` (copied from `server/.env.example`):

| Variable | Description |
|---|---|
| `MIYAPAD_LOGIN` | Username for authentication |
| `MIYAPAD_PASSWORD` | **A strong password is required** — anyone with access can store/load sessions and proxy requests |
| `MIYAPAD_STORAGE_PATH` | SQLite database path (default: `/storage/web-session-storage.db`) |

See [Backend Server](backend-server.md) for the full list of options.

## Persistence

The compose file mounts a named volume `storage` at `/storage`. The SQLite database resides there by default and persists across container restarts.

## HTTPS

TLS is supported through an nginx reverse proxy via a docker-compose override file.

```bash
cp server/docker-compose.override.example.yml server/docker-compose.override.yml
```

The `services:` line and the `ADD HTTPS SUPPORT` block must be uncommented. Certificate files are placed in `server/https/`:

```
server/https/
  nginx.conf
  public.crt
  private.key
```

After restarting, the server is available at `https://localhost:3443`.

## Accessing host AI servers from Docker

When AI backends (Ollama, etc.) run on the host, `host.docker.internal` should be used instead of `localhost` as the endpoint address:

- **macOS/Windows**: The `host.docker.internal` hostname resolves automatically. Set the endpoint to `http://host.docker.internal:11434`.
- **Linux**: The `ADD LOCALHOST AI SERVER SUPPORT FOR LINUX USERS` block in `docker-compose.override.yml` must be uncommented to add `host.docker.internal:host-gateway` to `extra_hosts`.
