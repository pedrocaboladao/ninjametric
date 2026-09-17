FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg: remuxa o HLS (.m3u8) dos vídeos "Clips" do Mercado Livre pra um
# mp4 baixável (ver rota /api/clonar-anuncio/video-hls) — só remuxa (-c copy,
# sem recodificar), rápido e leve mesmo sem hardware dedicado.
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
