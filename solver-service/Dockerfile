FROM rust:1.91-bookworm AS sparrow-build

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/JeroenGar/sparrow.git /sparrow
WORKDIR /sparrow
RUN cargo build --release --features only_final_svg --bin sparrow

# Independent metaheuristic engine retained in the image for later A/B validation.
FROM rust:1.91-bookworm AS unesting-build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /algorithms /foundation \
    && git clone --depth 1 https://github.com/iyulab/u-geometry.git /algorithms/u-geometry \
    && git clone --depth 1 https://github.com/iyulab/u-metaheur.git /algorithms/u-metaheur \
    && git clone --depth 1 https://github.com/iyulab/u-numflow.git /foundation/u-numflow \
    && git clone https://github.com/iyulab/u-nesting.git /u-nesting \
    && cd /u-nesting \
    && git checkout ca6b49a12192e664e296f1632dd0fe91ecfb2ac2
WORKDIR /u-nesting
RUN cargo build --release -p u-nesting-ffi

FROM python:3.12-slim-trixie
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV SPARROW_BIN=/usr/local/bin/sparrow
ENV UNESTING_LIB=/usr/local/lib/libu_nesting_ffi.so
ENV MOTOR_RUNTIME_BUILD=tvt-revolutionary-v10-9-lowcpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    liblapack3 libblas3 libgomp1 libcairo2 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY --from=sparrow-build /sparrow/target/release/sparrow /usr/local/bin/sparrow
COPY --from=unesting-build /u-nesting/target/release/libu_nesting_ffi.so /usr/local/lib/libu_nesting_ffi.so
RUN ldconfig
COPY *.py .
COPY revolutionary ./revolutionary

EXPOSE 10000
# Render Free is CPU constrained. Keep one HTTP execution lane; runtime_gate also
# serializes benchmark and API solver calls inside the process.
CMD ["gunicorn", "-b", "0.0.0.0:10000", "--workers", "1", "--threads", "1", "--timeout", "420", "cors_app:app"]
