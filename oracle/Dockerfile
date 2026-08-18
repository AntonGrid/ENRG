FROM node:20-alpine
WORKDIR /app

# P1 (аудит 2026-08-18): build context — КОРЕНЬ репозитория (docker-compose:
# context: ., dockerfile: oracle/Dockerfile). server.js лежит в корне, а не в oracle/.
COPY package*.json ./
COPY server.js policy.js storage.js ./
# IDL для Anchor-клиента (ENRG_IDL_PATH по умолчанию target/idl/enrg_mvp.json).
COPY target/idl/enrg_mvp.json ./target/idl/enrg_mvp.json

RUN npm install --omit=dev

# OTA-образы прошивки (ADR-0008).
RUN mkdir -p ./firmware/updates

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
