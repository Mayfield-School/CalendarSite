# The calendar without GitHub Pages: "builder" builds it every 30 minutes, "web" serves it.
# They share one volume at /site; mount it read-only in "web".

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY lib lib
COPY public public
COPY scripts scripts
COPY test test
RUN node --test && mkdir /site && chown node:node /site
USER node
ENV SITE_DIR=/site
HEALTHCHECK --interval=5m --timeout=10s --start-period=3m --retries=1 CMD ["node", "scripts/publish.js", "--healthy"]
CMD ["node", "scripts/publish.js"]

FROM caddy:2.10-alpine AS web
# The image lets caddy open ports below 1024. Ours uses 8080, and without this it can't start
# when the container has no capabilities.
RUN setcap -r /usr/bin/caddy
# Same owner as the builder, whichever container starts first and sets up the shared volume.
RUN mkdir /site && chown 1000:1000 /site
COPY Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
ENV XDG_DATA_HOME=/tmp XDG_CONFIG_HOME=/tmp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health.json"]
