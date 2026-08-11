FROM node:22.22.0-bookworm-slim

ARG CODEX_VERSION=0.146.0
ARG CLAUDE_CODE_VERSION=2.1.220

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --ignore-scripts "@openai/codex@${CODEX_VERSION}" \
  && npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm cache clean --force \
  && codex --version \
  && claude --version

WORKDIR /workspace

LABEL org.opencontainers.image.title="Skiller evaluation sandbox" \
      org.opencontainers.image.description="Disposable Codex and Claude harness for reviewed Skiller quality plans" \
      org.opencontainers.image.source="https://github.com/beautyfree/skiller"
