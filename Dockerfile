# Imagem só da API (server/). O frontend é estático e é publicado à parte,
# hoje no GitHub Pages (ver .github/workflows/deploy-pages.yml) — não faz
# sentido buildar o Vite aqui.
#
# Roda via tsx, igual a todo o resto do projeto: sem passo de compilação
# separado para manter o mesmo comportamento de dev e produção.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
COPY tsconfig.json tsconfig.server.json ./

ENV NODE_ENV=production
# Aponta pra fora do container: sem isso, o SQLite mora na camada gravável
# do container e some no próximo deploy. A plataforma de hospedagem monta
# um volume persistente aqui (Fly Volumes, Railway Volumes, disco de uma
# VPS, etc.).
ENV DB_PATH=/data/app.db
VOLUME ["/data"]

EXPOSE 5174
CMD ["npx", "tsx", "server/index.ts"]
