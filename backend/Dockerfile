FROM node:20-slim

# python3 + pip: needed so this container can spawn cuisineaz_scraper.py
# for single-recipe imports (POST /api/recipes/import) — see
# scraper/cuisineaz_scraper.py's --import-url mode. Build context is the
# repo root (see docker-compose.yml) so this Dockerfile can reach both
# backend/ and the sibling scraper/ directory.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY scraper/requirements.txt /scraper/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /scraper/requirements.txt

COPY scraper/cuisineaz_scraper.py /scraper/cuisineaz_scraper.py
COPY backend/src ./src

EXPOSE 3000

CMD ["node", "src/index.js"]
