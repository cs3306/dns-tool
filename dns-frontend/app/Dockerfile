FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

FROM node:18-alpine AS production

RUN apk add --no-cache curl tini
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder --chown=nodejs:nodejs /app .
RUN chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
