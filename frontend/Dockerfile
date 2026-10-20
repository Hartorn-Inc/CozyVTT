# Development Dockerfile
# For production, use Dockerfile.prod (multi-stage, serves via backend static middleware)
FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["npm", "run", "dev"]
