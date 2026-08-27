# DAISY Ace HTTP sidecar.
# Ace has no canonical docker image and release bundles are gated behind
# daisy.org downloads, so this image REQUIRES the bundle to be provided:
#
#   Option A (build-time):  --build-arg ACE_BUNDLE_URL=https://…/ace-linux-x64.zip
#   Option B (runtime mount): docker compose cp/mount your bundle at /opt/ace
#
# The zip must extract to a directory containing the `ace` executable.
FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache nodejs wget unzip bash python3

ARG ACE_BUNDLE_URL=""
WORKDIR /opt
RUN if [ -n "${ACE_BUNDLE_URL}" ]; then \
      wget -q -O /tmp/ace.zip "${ACE_BUNDLE_URL}" \
      && unzip -q /tmp/ace.zip -d /opt/ace \
      && chmod +x "$(find /opt/ace -name ace -type f | head -n1)" \
      && rm /tmp/ace.zip; \
    else \
      mkdir -p /opt/ace \
      && printf '#!/bin/sh\necho "ace bundle missing: build with --build-arg ACE_BUNDLE_URL or mount /opt/ace" >&2\nexit 2\n' > /opt/ace/ace \
      && chmod +x /opt/ace/ace; \
    fi

WORKDIR /app
COPY server.mjs ./server.mjs

ENV PORT=4011
ENV ACE_CMD=/opt/ace/ace
EXPOSE 4011

HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD wget -qO- http://127.0.0.1:4011/health || exit 1

CMD ["node", "server.mjs"]
