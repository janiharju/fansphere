FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Declare persistent data volume mount point for store.json
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["npm", "start"]
