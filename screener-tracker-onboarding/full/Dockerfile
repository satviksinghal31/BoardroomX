FROM mcr.microsoft.com/playwright:v1.61.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund
COPY --chown=pwuser:pwuser . .
ENV NODE_ENV=production
USER pwuser
CMD ["node", "server.js"]
