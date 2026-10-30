FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY . .
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
