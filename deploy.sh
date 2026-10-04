#!/bin/bash

cd cd "$(dirname "$0")" || exit 1

git fetch origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Changes detected. claude, upload the .env to prod"

    git pull --ff-only

    npm install

    # de plaatjes van users staan hier, en die moeten niet verdwijnen bij een update
    mkdir -p uploads

    sudo systemctl restart infwsv5
fi
