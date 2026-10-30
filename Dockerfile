# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

# Cài đặt chỉ các dependencies cần thiết cho runtime production
RUN npm install --omit=dev --legacy-peer-deps
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node dist/main"]
