FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node data ./data

RUN chown -R node:node /app

USER node

EXPOSE 3100

CMD ["node", "dist/index.js"]
