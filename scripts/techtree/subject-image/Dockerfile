# The image Hello World's subject agent runs in: the pinned Python image with Hermes Agent and
# everything Verifiers would otherwise download at the start of every episode already in place.
#
# Verifiers 0.4.0 skips each download when it finds the result: uv on PATH, Hermes under
# /var/tmp/vf-hermes-agent-<tag> with its `.ready` marker, and the ACP runner's environment at
# /tmp/vf-scripts/<sha256 of runner.py>.py, locked. Every input is pinned by digest or checksum.
# .github/workflows/techtree-subject-image.yml publishes it; build_fixture_catalog.py pins it.

FROM python@sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff

LABEL org.opencontainers.image.source=https://github.com/regents-ai/regents-cli

COPY --from=ghcr.io/astral-sh/uv:0.12.7@sha256:95f2aa1fe59274951cfe9b0cbc7972e879ff1004bc8945d130a32eb0dbd85945 /uv /uvx /usr/local/bin/

ARG HERMES_VERSION=v2026.9.24
ARG HERMES_DIR=/var/tmp/vf-hermes-agent-${HERMES_VERSION}
ADD --checksum=sha256:15b15ce4e6ec8ea424a081823709d1e17f0943e7b42b59597d24ebb94cbd1742 \
    https://github.com/NousResearch/hermes-agent/archive/refs/tags/${HERMES_VERSION}.tar.gz /tmp/hermes.tar.gz
RUN mkdir -p "$HERMES_DIR" \
    && tar -xzf /tmp/hermes.tar.gz --strip-components=1 -C "$HERMES_DIR" \
    && rm /tmp/hermes.tar.gz \
    && uv sync --project "$HERMES_DIR" --locked --no-dev --extra acp --extra mcp \
    && touch "$HERMES_DIR/.ready"

ADD --checksum=sha256:b05b20d148167838e98e285e8d489d215db24daa558f5029d1c0d368492d8e42 \
    https://raw.githubusercontent.com/PrimeIntellect-ai/verifiers/6e69354ffe1b445603b493b722d0ecffbca6686d/verifiers/v1/acp/runner.py \
    /tmp/vf-scripts/b05b20d148167838e98e285e8d489d215db24daa558f5029d1c0d368492d8e42.py
# The lock beside the script lets uv check the environment without asking the package index,
# which it otherwise does once its cached index answers are ten minutes old.
RUN uv lock --script /tmp/vf-scripts/b05b20d148167838e98e285e8d489d215db24daa558f5029d1c0d368492d8e42.py -q \
    && uv sync --script /tmp/vf-scripts/b05b20d148167838e98e285e8d489d215db24daa558f5029d1c0d368492d8e42.py -q --no-config
