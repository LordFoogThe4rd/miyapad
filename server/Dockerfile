FROM node:24.21.0

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit && npm cache clean --force

COPY . .
RUN npm run build

WORKDIR /app/server
RUN npm ci --no-audit && npm cache clean --force

EXPOSE 3000
USER node
ENV NODE_ENV=production
CMD [ "node", "--import", "tsx", "server.ts" ]
