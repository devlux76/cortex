FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/root/.bun
ENV PATH=${BUN_INSTALL}/bin:${PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xauth \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash

WORKDIR /workspace

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

COPY docker/electron-debug/entrypoint.sh /usr/local/bin/cortex-electron-debug
RUN chmod +x /usr/local/bin/cortex-electron-debug

ENV HARNESS_HOST=0.0.0.0 \
    HARNESS_PORT=4173 \
    HARNESS_URL=http://127.0.0.1:4173 \
    CORTEX_OZONE_PLATFORM=x11 \
    CORTEX_DISABLE_VULKAN=1 \
    CORTEX_ELECTRON_HEADLESS=0 \
    CORTEX_ELECTRON_SHOW=0 \
    CORTEX_ENABLE_UNSAFE_WEBGPU=0 \
    CORTEX_IGNORE_GPU_BLOCKLIST=0 \
    CORTEX_DOCKER_MAIN_INSPECT_PORT=9230 \
    CORTEX_DOCKER_RENDERER_DEBUG_PORT=9222

EXPOSE 4173 9222 9230

CMD ["cortex-electron-debug"]
