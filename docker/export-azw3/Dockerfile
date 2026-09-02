# Kindle (AZW3) conversion sidecar — Calibre's ebook-convert CLI wrapped by a
# tiny node server, mirroring the validator sidecars. Debian ships a full
# calibre package, so no external bundle is needed (unlike DAISY Ace).
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends calibre \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./server.mjs

# ebook-convert is Qt-based; offscreen keeps it happy headless.
ENV PORT=4012 \
    QT_QPA_PLATFORM=offscreen \
    HOME=/tmp
EXPOSE 4012

HEALTHCHECK --interval=15s --timeout=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
