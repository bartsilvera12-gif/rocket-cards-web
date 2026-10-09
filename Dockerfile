# Imagen para los hosts que piden un contenedor (Fly, Cloud Run, un VPS con
# Docker). En Railway y Render no hace falta: detectan Node solos y alcanza
# con poner "npm run build" como build y "npm start" como start.
#
# El panel y la API necesitan un proceso que quede vivo, porque sostienen la
# conexión LISTEN contra Postgres y los streams SSE de los navegadores. Por eso
# no van en Vercel, que arranca y mata una función por pedido.

FROM node:22-alpine

WORKDIR /app

# Las dependencias primero, en su propia capa: mientras no cambie el lock,
# un deploy que sólo toca la página no reinstala nada.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN npm run build

# Nada corre como root. El chown es para que un "npm start" dentro del
# contenedor pueda reescribir dist/ en vez de chocar contra permisos.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=4000
ENV DETRAS_DE_TLS=1

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directo, no npm: así las señales de parada llegan al proceso y el
# cierre ordenado (soltar el oyente y el pool) se ejecuta.
CMD ["node", "server/index.mjs"]
