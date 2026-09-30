# The image Frontier-CS Open-Ended's subject agent runs in: Hello World's subject image, pinned by
# digest, plus Debian's C++ compiler. The agent compiles and tries its program here, and scoring
# compiles each problem's checker and the agent's program here once the agent has finished.
# .github/workflows/techtree-subject-image.yml publishes it; build_fixture_catalog.py pins it.

FROM ghcr.io/regents-ai/techtree-subject@sha256:76ebb4a9390b80bfd5a6584d4229512fea1c858d4a0b73153a25cf1495cca155

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app
