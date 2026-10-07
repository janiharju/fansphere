FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

RUN mkdir -p /app/data

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["npm", "start"]
