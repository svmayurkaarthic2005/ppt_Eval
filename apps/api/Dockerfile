FROM python:3.11-slim

WORKDIR /app

# soffice is invoked directly as a subprocess by app/rendering/slide_renderer.py
# (LibreOffice headless PPTX->PDF conversion) -- it needs to live in this image,
# not just in the separate `libreoffice` compose service.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/pyproject.toml ./pyproject.toml
COPY apps/api/app ./app
RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
