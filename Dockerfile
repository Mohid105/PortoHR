# docker build -t portohr . && docker run -d --name portohr -p 5000:5000 --env-file .env portohr
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "src/server.js"]
