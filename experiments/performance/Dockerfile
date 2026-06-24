FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      osmium-tool time coreutils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
