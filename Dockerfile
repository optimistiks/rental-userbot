FROM node:26.9.0-trixie-slim

WORKDIR /app

RUN npm i -g pnpm@12.4.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
RUN node -e "require('better-sqlite3')"

COPY src ./src

USER node

ENTRYPOINT ["node", "--import", "tsx", "src/main.ts"]
