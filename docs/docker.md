# Docker

Miyapad can run in a Docker container, with its storage in a named volume. docker-compose is the easiest way to set it up.

## docker-compose (recommended)

The compose file builds the image, sets up the environment and mounts the storage volume.

```bash
cp server/.env.example server/.env
docker compose -f server/docker-compose.yml up --build -d
```

The server is then at [http://localhost:3000](http://localhost:3000). It restarts on its own unless you stopped it.

```bash
docker compose -f server/docker-compose.yml down
```

## Building manually

To build and run a standalone image without docker-compose:

```bash
docker build -t miyapad -f server/Dockerfile .
docker run -p 3000:3000 miyapad
```

## Configuration

Set environment variables in `server/.env`, copied from `server/.env.example`:

| Variable | Description |
|---|---|
| `MIYAPAD_LOGIN` | Username for authentication |
| `MIYAPAD_PASSWORD` | Password for authentication. Use a strong one: anyone who gets in can store and load sessions and proxy requests through your server |
| `MIYAPAD_STORAGE_PATH` | SQLite database path (default: `/storage/web-session-storage.db`) |

See [Backend Server](backend-server.md) for the full list of options.

## Persistence

The compose file mounts a named volume, `storage`, at `/storage`. The SQLite database lives there by default, so it survives container restarts.

## HTTPS

For TLS, put an nginx reverse proxy in front using the docker-compose override file:

```bash
cp server/docker-compose.override.example.yml server/docker-compose.override.yml
```

Uncomment the `services:` line and the `ADD HTTPS SUPPORT` block, then put the certificate files in `server/https/`:

```
server/https/
  nginx.conf
  public.crt
  private.key
```

Restart, and the server answers on `https://localhost:3443`.

## Accessing host AI servers from Docker

If your AI backend (Ollama or similar) runs on the host rather than in the container, point the endpoint at `host.docker.internal` instead of `localhost`:

- **macOS/Windows**: `host.docker.internal` works out of the box. Set the endpoint to `http://host.docker.internal:11434`.
- **Linux**: uncomment the `ADD LOCALHOST AI SERVER SUPPORT FOR LINUX USERS` block in `docker-compose.override.yml`. It adds `host.docker.internal:host-gateway` to `extra_hosts`.
