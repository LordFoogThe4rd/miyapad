# Docker

## docker-compose (recommended)

```bash
cp server/.env.example server/.env
# Edit server/.env — set a strong password for MIYAPAD_PASSWORD
docker compose -f server/docker-compose.yml up --build -d
```

Visit [http://localhost:3000](http://localhost:3000). The server restarts automatically unless stopped.

### Stop

```bash
docker compose -f server/docker-compose.yml down
```

## Building manually

```bash
docker build -t miyapad -f server/Dockerfile .
docker run -p 3000:3000 miyapad
```

## Configuration

Copy `server/.env.example` to `server/.env` and configure:

| Variable | Description |
|---|---|
| `MIYAPAD_LOGIN` | Username for authentication |
| `MIYAPAD_PASSWORD` | **Set a strong password** — anyone with access can store/load sessions and proxy requests |
| `MIYAPAD_STORAGE_PATH` | SQLite database path (default: `/storage/web-session-storage.db`) |

See [Backend Server](backend-server.md) for all options.

## Persistence

The compose file mounts a named volume `storage` at `/storage`. The SQLite database lives there by default.

## HTTPS

Add an nginx reverse proxy for TLS:

```bash
cp server/docker-compose.override.example.yml server/docker-compose.override.yml
```

Uncomment the `services:` line and the `ADD HTTPS SUPPORT` block. Place your certificate files in `server/https/`:

```
server/https/
  nginx.conf
  public.crt
  private.key
```

Restart to serve on `https://localhost:3443`.

## Accessing localhost AI servers from Docker

When running AI backends (Ollama, etc.) on the host, use `host.docker.internal` instead of `localhost`:

- **macOS/Windows**: works out of the box — set endpoint to `http://host.docker.internal:11434`
- **Linux**: uncomment the `ADD LOCALHOST AI SERVER SUPPORT FOR LINUX USERS` block in `docker-compose.override.yml` to add `host.docker.internal:host-gateway` to `extra_hosts`
