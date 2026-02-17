FROM node:20-alpine

WORKDIR /app

# SSH client is required for MakeMKV host telemetry/update over SSH key auth.
RUN apk add --no-cache openssh-client

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
