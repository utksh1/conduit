# ---- Stage 1: Build ----
FROM rust:1.80-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release && rm -rf src

# Copy actual source and build
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# ---- Stage 2: Runtime ----
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/chatgpt-to-api-rust /app/chatgpt-to-api-rust

# Copy dashboard if it exists (optional)
COPY dashboard/dist/ /app/dashboard/dist/ 2>/dev/null || true

# Copy env example
COPY .env.example /app/.env.example

EXPOSE 3040

ENV HOST=0.0.0.0
ENV PORT=3040

CMD ["/app/chatgpt-to-api-rust"]
