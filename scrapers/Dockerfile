FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-ingestion.txt ./
RUN pip install --no-cache-dir -r requirements-ingestion.txt
COPY boardroom_screener_scraper.py ingest.py company.schema.json ./
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home worker
USER worker
CMD ["python", "-u", "ingest.py", "run"]
