# epubcheck HTTP sidecar — java runtime + jar, wrapped by a tiny node server.
# Override the version at build time: --build-arg EPUBCHECK_VERSION=5.2.1
ARG EPUBCHECK_VERSION=5.1.0
FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache nodejs wget unzip

ARG EPUBCHECK_VERSION
RUN wget -q -O /tmp/epubcheck.zip \
      "https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/epubcheck-${EPUBCHECK_VERSION}.zip" \
 && unzip -q /tmp/epubcheck.zip -d /opt \
 && mv "/opt/epubcheck-${EPUBCHECK_VERSION}" /opt/epubcheck \
 && rm /tmp/epubcheck.zip

WORKDIR /app
COPY server.mjs ./server.mjs

ENV PORT=4010
EXPOSE 4010

HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD wget -qO- http://127.0.0.1:4010/health || exit 1

CMD ["node", "server.mjs"]
