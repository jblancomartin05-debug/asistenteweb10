# Dockerfile for Atenea (Node >=18)
FROM node:20-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
