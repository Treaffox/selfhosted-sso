FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

RUN addgroup --system --gid 1001 appuser
RUN adduser --system --uid 1001 appuser
RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 8123
ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts"]
