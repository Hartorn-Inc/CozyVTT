# Development Dockerfile
# For production, use Dockerfile.prod (multi-stage, non-root, compiled output)
FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5

# bash: required by start.sh (#!/bin/bash shebang); not included in alpine by default
# postgresql18-client: pg_dump (backup) and psql (restore). Pinned to the same
# major as the postgres:18 image, for the reason given in Dockerfile.prod.
RUN apk add --no-cache bash postgresql18-client openssl

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dependencies as root (need write access to node_modules)
COPY package*.json .npmrc ./
RUN npm ci

# Copy application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Copy and fix startup script
COPY scripts/start.sh /usr/local/bin/start.sh
COPY scripts/permissions-check.sh /usr/local/bin/permissions-check.sh
RUN sed -i 's/\r$//' /usr/local/bin/start.sh /usr/local/bin/permissions-check.sh \
  && chmod +x /usr/local/bin/start.sh /usr/local/bin/permissions-check.sh

# Create uploads and logs dirs, hand ownership to appuser
RUN mkdir -p /app/uploads /app/logs /app/backups && chown -R appuser:appgroup /app

USER appuser

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/start.sh"]
CMD ["npm", "run", "dev"]
