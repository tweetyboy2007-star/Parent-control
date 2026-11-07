FROM node:20-alpine

RUN apk add --no-cache ffmpeg sqlite

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 7000
CMD ["node", "index.js"]
