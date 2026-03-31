FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build Express backend
FROM deps AS backend
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build:backend

# Build Next.js frontend
FROM deps AS frontend
COPY --from=backend /app/dist/ dist/
COPY web/ web/
RUN npm run build:web

# Production image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/dist/ dist/
COPY --from=frontend /app/web/.next/standalone/web/.next web/.next
COPY --from=frontend /app/web/.next/static web/.next/static
COPY --from=frontend /app/web/public web/public
COPY server.js ./
COPY public/ public/
COPY src/quiz/public/ src/quiz/public/
EXPOSE 3000
CMD ["node", "server.js"]
