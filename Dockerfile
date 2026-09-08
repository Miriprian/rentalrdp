FROM oven/bun:1-slim AS base
WORKDIR /app

# Install dependencies (production only)
COPY package.json bun.lockb* ./
RUN bun install --production 2>/dev/null || bun install

# Copy application
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health || exit 1

CMD ["bun", "run", "src/index.ts"]
