#!/bin/sh
# Erzeugt die .env (Adresse abfragen, Geheimnisse und Admin-Passwort würfeln).
# Nutzt Node.js, falls installiert, sonst einen kurzen Docker-Container.
set -e
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  exec node scripts/setup.mjs "$@"
elif command -v docker >/dev/null 2>&1; then
  exec docker run --rm -it -u "$(id -u):$(id -g)" -v "$PWD":/work -w /work node:22-alpine node scripts/setup.mjs "$@"
else
  echo "Weder Node.js noch Docker gefunden. Installiere eines von beiden oder kopiere .env.example nach .env und fülle sie von Hand aus." >&2
  exit 1
fi
