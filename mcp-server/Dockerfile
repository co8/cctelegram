# Multi-stage Docker build for CCTelegram MCP Server
# Optimized for security, performance, and minimal attack surface

# ===== Build Stage =====
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci --include=dev && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY tests/ ./tests/

# Build the application
RUN npm run build

# Run tests to ensure build quality
RUN npm test -- --coverage --passWithNoTests

# Audit for security vulnerabilities
RUN npm audit --audit-level=moderate || true

# ===== Production Dependencies Stage =====
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --no-audit --no-fund && \
    npm cache clean --force

# ===== Runtime Stage =====
FROM node:20-alpine AS runtime

# Install runtime dependencies for security and monitoring
RUN apk add --no-cache \
    dumb-init \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy production dependencies
COPY --from=deps --chown=mcp:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=mcp:nodejs /app/dist ./dist
COPY --from=builder --chown=mcp:nodejs /app/package*.json ./

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/data && \
    chown -R mcp:nodejs /app/logs /app/data

# Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    MCP_LOG_LEVEL=info \
    MCP_ENABLE_AUTH=true \
    MCP_ENABLE_RATE_LIMIT=true \
    MCP_ENABLE_INPUT_VALIDATION=true \
    MCP_ENABLE_SECURE_LOGGING=true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Switch to non-root user
USER mcp

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# ===== Development Stage =====
FROM builder AS development

# Install additional development tools
RUN npm install -g nodemon tsx

# Set development environment
ENV NODE_ENV=development

# Switch to non-root user
USER mcp

# Expose port and debugger port
EXPOSE 3000 9229

# Start with development server
CMD ["npm", "run", "dev"]

# ===== Testing Stage =====
FROM builder AS testing

# Set test environment
ENV NODE_ENV=test \
    CI=true

# Run comprehensive tests
RUN npm test -- --coverage --watchAll=false

# Copy test results for analysis
COPY --from=builder /app/coverage ./coverage

# Default command for testing
CMD ["npm", "test"]

# ===== Security Scanning Stage =====
FROM runtime AS security

# Install security scanning tools
USER root
RUN apk add --no-cache \
    npm \
    git \
    && npm install -g \
    audit-ci \
    license-checker \
    && rm -rf /var/cache/apk/*

# Copy source for security analysis
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./

# Run security scans
RUN npm audit --audit-level=moderate && \
    audit-ci --moderate && \
    license-checker --onlyAllow 'MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause'

# Switch back to non-root user
USER mcp

# Default command for security scanning
CMD ["npm", "audit"]