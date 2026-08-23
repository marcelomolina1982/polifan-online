FROM rust:1.91-bookworm AS sparrow-build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/JeroenGar/sparrow.git /sparrow
WORKDIR /sparrow
RUN cargo build --release --features only_final_svg --bin sparrow

FROM python:3.12-slim-trixie
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV SPARROW_BIN=/usr/local/bin/sparrow
ENV MOTOR_RUNTIME_BUILD=clean-lab-v5-selftest
RUN apt-get update && apt-get install -y --no-install-recommends liblapack3 libblas3 libgomp1 libcairo2 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
COPY --from=sparrow-build /sparrow/target/release/sparrow /usr/local/bin/sparrow
COPY *.py .
EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn -b 0.0.0.0:${PORT:-10000} --workers 1 --threads 2 --timeout 600 --graceful-timeout 30 selftest_hook:app"]
