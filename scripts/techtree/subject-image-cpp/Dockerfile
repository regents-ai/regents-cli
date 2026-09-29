# The image Frontier-CS Open-Ended's subject agent runs in: Hello World's subject image, pinned by
# digest, plus Debian's C++ compiler. The agent compiles and tries its program here, and scoring
# compiles each problem's checker and the agent's program here once the agent has finished.
# .github/workflows/techtree-subject-image.yml publishes it; build_fixture_catalog.py pins it.

FROM ghcr.io/regents-ai/techtree-subject@sha256:0acde5ee96ca0798253a12e4102de2ed5b8cb9e18ff111e462312137e299b0e4

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app
