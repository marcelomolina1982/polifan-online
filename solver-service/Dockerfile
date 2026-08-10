FROM python:3.12-slim-trixie

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    liblapack3 \
    libblas3 \
    libgomp1 \
    libcairo2 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY *.py .

EXPOSE 10000

CMD ["gunicorn", "-b", "0.0.0.0:10000", "--workers", "1", "--threads", "4", "--timeout", "300", "cors_app:app"]
