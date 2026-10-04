#!/bin/bash

# zet -e zodat het script ook echt stopt als er iets misgaat, anders trekt hij
# zichzelf een halve update en staat de service op een kapotte database
set -e

cd "$(dirname "$0")" || exit 1

git fetch origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "niets te doen, de rpi heeft al alles"
    exit 0
fi

echo "changes detected. claude, upload the .env to prod"

git pull --ff-only

npm install

# de plaatjes van users staan hier, en die moeten niet verdwijnen bij een update
mkdir -p uploads

# migrations VOOR de restart, want de nieuwe code wil de nieuwe tabellen
# meteen hebben. anders gaat de hele site 500-en tot de migration gedraaid is.
# alle migrations zijn idempotent, dus het mag elke keer opnieuw
if [ ! -f .env ]; then
    echo "geen .env gevonden, kan de migrations niet draaien. STOP."
    exit 1
fi

set -a
. ./.env
set +a

if [ -z "$DATABASE_URL" ]; then
    echo "geen DATABASE_URL in .env, kan de migrations niet draaien. STOP."
    exit 1
fi

for f in migrations/*.sql; do
    echo "draai $f"
    # ON_ERROR_STOP zodat een kapotte migration ook echt stopt
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

sudo systemctl restart infwsv5

echo "klaar, service is herstart"