ENRG local data directory.

The SQLite store created by the oracle (`server.js`) when no DATABASE_URL is set
lives here, mounted as ./data by docker-compose. `.gitkeep` keeps the directory in
the repository so a fresh clone does not end up with Docker creating a *directory*
called `enrg.db` (which used to break the container at startup).

    data/enrg.db      — oracle storage (devnet/dev)
    data/*.db-wal     — SQLite journal files, safe to delete while stopped
