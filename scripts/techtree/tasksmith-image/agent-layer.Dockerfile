# Appended to a Tasksmith task's own environment/Dockerfile to make its agent image: the task's
# environment with Hermes Agent and everything Verifiers would otherwise download at the start of
# every episode already in place, as in scripts/techtree/subject-image.
#
# Verifiers runs the agent as the image's user, so Hermes, the runner and uv's shared folders
# belong to the task's user, `learner` in every Tasksmith task, and the image ends as that user.
# build_tasksmith_images.py composes, builds and pins it.

LABEL org.opencontainers.image.source=https://github.com/regents-ai/regents-cli

COPY --from=ghcr.io/astral-sh/uv:0.12.7@sha256:95f2aa1fe59274951cfe9b0cbc7972e879ff1004bc8945d130a32eb0dbd85945 /uv /uvx /usr/local/bin/

# Shared, not under root's home, so the task's own user can run Hermes.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python UV_CACHE_DIR=/opt/uv/cache

ARG HERMES_VERSION=v2026.9.24
ARG HERMES_DIR=/var/tmp/vf-hermes-agent-${HERMES_VERSION}
ADD --checksum=sha256:15b15ce4e6ec8ea424a081823709d1e17f0943e7b42b59597d24ebb94cbd1742 \
    https://github.com/NousResearch/hermes-agent/archive/refs/tags/${HERMES_VERSION}.tar.gz /tmp/hermes.tar.gz
RUN mkdir -p "$HERMES_DIR" \
    && tar -xzf /tmp/hermes.tar.gz --strip-components=1 -C "$HERMES_DIR" \
    && rm /tmp/hermes.tar.gz \
    && uv sync --project "$HERMES_DIR" --locked --no-dev --extra acp --extra mcp \
    && touch "$HERMES_DIR/.ready"

ADD --checksum=sha256:ccfa3ed995e614c990721843ee737395952b69b1b4f6a881be907aeca5469b73 \
    https://raw.githubusercontent.com/PrimeIntellect-ai/verifiers/fc73e02ea99594407bf7579c53f7711f7434635a/verifiers/v1/acp/runner.py \
    /tmp/vf-scripts/ccfa3ed995e614c990721843ee737395952b69b1b4f6a881be907aeca5469b73.py
# The lock beside the script lets uv check the environment without asking the package index,
# which it otherwise does once its cached index answers are ten minutes old.
RUN uv lock --script /tmp/vf-scripts/ccfa3ed995e614c990721843ee737395952b69b1b4f6a881be907aeca5469b73.py -q \
    && uv sync --script /tmp/vf-scripts/ccfa3ed995e614c990721843ee737395952b69b1b4f6a881be907aeca5469b73.py -q --no-config

RUN chown -R learner:learner "$HERMES_DIR" /tmp/vf-scripts /opt/uv
USER learner
