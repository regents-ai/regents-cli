# The image Model Climb's model-free M0 check runs in (contract model-climb-v1, 7.4 step 1):
# prime-rl at its pinned commit with its locked dependencies, and Qwen3.5-9B's tokenizer and
# configuration at the pinned revision. No weights: the model is built on PyTorch's meta device.
#
# On Linux, prime-rl's base dependencies bring no PyTorch: PyTorch and the trainer's kernels come
# with its `gpu`, `flash-attn` and `kernels` extras, which also bring vLLM and serving libraries
# this check never imports. So only the packages the trainer modules import are installed, with
# prime-rl's lock as constraints and its own dependency overrides as overrides, as `uv sync`
# applies them, so every version and wheel is the locked one. Nothing here runs a model. It is
# built on this machine only (`make model-climb-image`) and is never published.

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

COPY --from=ghcr.io/astral-sh/uv:0.12.7@sha256:95f2aa1fe59274951cfe9b0cbc7972e879ff1004bc8945d130a32eb0dbd85945 /uv /uvx /usr/local/bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG PRIME_RL_REVISION=1e5318108da29d10960e91e54b80305f597de39d
ENV UV_PROJECT_ENVIRONMENT=/opt/prime-rl/.venv UV_LINK_MODE=copy UV_NO_CACHE=1
WORKDIR /opt/prime-rl
# Three submodules are named by SSH address; all five repositories are public, so HTTPS reads them.
RUN git init -q . \
    && git remote add origin https://github.com/PrimeIntellect-ai/prime-rl \
    && git fetch -q --depth 1 origin "$PRIME_RL_REVISION" \
    && git checkout -q FETCH_HEAD \
    && git config --global url."https://github.com/".insteadOf git@github.com: \
    && git submodule update -q --init --depth 1 \
        deps/verifiers deps/renderers deps/pydantic-config deps/prime-envs \
    && test "$(git rev-parse HEAD)" = "$PRIME_RL_REVISION"
RUN uv sync --locked --no-dev
RUN uv export --locked --no-dev --no-emit-workspace --no-hashes -q \
        --extra gpu --extra flash-attn --extra kernels \
        | grep -v '^-e ' > /tmp/locked.txt \
    && .venv/bin/python -c "import tomllib; \
print('\n'.join(tomllib.load(open('pyproject.toml', 'rb'))['tool']['uv']['override-dependencies']))" \
        > /tmp/overrides.txt \
    && cd /tmp \
    && uv pip install --no-config --python /opt/prime-rl/.venv/bin/python \
        --constraint /tmp/locked.txt --override /tmp/overrides.txt \
        --extra-index-url https://download.pytorch.org/whl/cu130 --index-strategy unsafe-best-match \
        torch torchdata triton flash-linear-attention ring-flash-attn flash-attn prime-kernels torchao \
    && rm /tmp/locked.txt /tmp/overrides.txt

ARG MODEL_ID=Qwen/Qwen3.5-9B
ARG MODEL_REVISION=c202236235762e1c871ad0ccb60c8ee5ba337b9a
ENV MODEL_DIR=/opt/model
RUN .venv/bin/python -c "import sys; from huggingface_hub import snapshot_download; \
snapshot_download(sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], \
allow_patterns=['*.json', '*.jinja', '*.txt', '*.model'], ignore_patterns=['*.safetensors*', '*.bin', '*.pt'])" \
        "$MODEL_ID" "$MODEL_REVISION" "$MODEL_DIR" \
    && ! ls "$MODEL_DIR" | grep -E '\.(safetensors|bin|pt)$' \
    && printf '%s\n%s\n' "$MODEL_ID" "$MODEL_REVISION" > "$MODEL_DIR/PINNED"

COPY check.py fixtures.jsonl model_climb_fixture.py /opt/m0/
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PRL_OUTPUT_DIR=/tmp/prl PYTHONPATH=/opt/m0
ENTRYPOINT ["/opt/prime-rl/.venv/bin/python", "/opt/m0/check.py"]
