# syntax=docker/dockerfile:1
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    software-properties-common \
    git \
    curl \
    ca-certificates \
    patch \
    build-essential \
    pkg-config \
    libusb-1.0-dev \
    libssl-dev \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y \
    python3.8 \
    python3.8-dev \
    python3.8-venv \
    && rm -rf /var/lib/apt/lists/*
curl -fsSL https://claude.ai/install.sh | bash

# macOS Homebrew (수동 업그레이드 필요)
# bun install -y jq 2>/dev/null || true
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -sf /usr/bin/python3.8 /usr/local/bin/python3 && \
    ln -sf /usr/bin/python3.8 /usr/local/bin/python

WORKDIR /repo

# Install build dependencies and build Cython extensions at BASE commit
RUN python -m pip install --no-cache-dir cython==0.29.15 numpy && \
    python setup.py build_ext --inplace -j $(nproc)

# Install runtime dependencies declared in setup.py
RUN python -m pip install --no-cache-dir $(sed -n '/install_requires = \[/,/\]/p' setup.py | grep -o '"[^"]*"' | tr -d '"' | tr '\n' ' ')
# Install missing runtime dependency used by config system
RUN python -m pip install --no-cache-dir ruamel.yaml==0.16.10 ruamel.yaml.clib==0.2.0
