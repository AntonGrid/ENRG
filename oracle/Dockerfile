FROM node:20-alpine
WORKDIR /app

# P1 (аудит 2026-08-18): build context — КОРЕНЬ репозитория (docker-compose:
# context: ., dockerfile: oracle/Dockerfile). server.js лежит в корне, а не в oracle/.
COPY package*.json ./
COPY server.js policy.js storage.js ./
# IDL для Anchor-клиента. Важно: `target/` в .gitignore, поэтому на свежем клоне
# (и в CI-сборке образа) его нет — берём ТРАССИРУЕМУЮ копию из idls/ и указываем
# её явно. До 2026-09-21 здесь был COPY target/idl/..., из-за чего образ
# собирался только на машине, где уже сделан `anchor build`.
COPY idls/enrg_mvp.json ./idls/enrg_mvp.json
ENV ENRG_IDL_PATH=/app/idls/enrg_mvp.json

RUN npm install --omit=dev

# OTA-образы прошивки (ADR-0008).
RUN mkdir -p ./firmware/updates

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
