# Production PostgreSQL. Official 18-alpine, then Alpine's brotli-libs
# 1.2.1-r0 (CVE-2026-111497). The Hub image still ships 1.2.0-r1; pin the
# fixed package so a missing apk index fails the build. Drop this RUN when
# the FROM digest already has brotli-libs 1.2.1-r0 or newer. The FROM digest
# is the same pin as docker-compose.dev.yml and CI's postgres service; move
# all three together.
FROM postgres:18-alpine@sha256:898c60cb390d1085bc97bdd6a1ae968757421df394b071848b52b1c09c89d6a5

RUN apk add --no-cache 'brotli-libs=1.2.1-r0'
RUN apk add --no-cache 'libcurl=8.23.0-r0'
