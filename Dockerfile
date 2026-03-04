# Stage 1: Build the React client
FROM node:20-alpine as build-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build the Node server and copy client build
FROM node:20-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./
COPY --from=build-client /app/client/dist /app/client/dist

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

CMD ["node", "index.js"]
