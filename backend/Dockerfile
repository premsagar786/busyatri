FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/schema.sql ./dist/db/schema.sql
# NOTE: build context is backend/ (see fly.toml), so the dashboard is NOT
# bundled into the image. Locally (`npm run dev` in backend/) the server
# auto-serves ../dashboard on the same origin. In production the dashboard
# deploys as a static site (Cloudflare Pages / Netlify) per DEPLOYMENT.md.
EXPOSE 3000
CMD ["node", "dist/server.js"]
