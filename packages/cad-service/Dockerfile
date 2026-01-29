# PythonOCC CAD Service
# Uses conda for PythonOCC installation (recommended approach)

FROM condaforge/mambaforge:latest AS builder

# Install PythonOCC and dependencies via conda
RUN mamba install -y -c conda-forge \
    python=3.11 \
    pythonocc-core=7.9.0 \
    numpy \
    && mamba clean -afy

# Install pip packages
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Production image
FROM condaforge/mambaforge:latest

# Copy conda environment from builder
COPY --from=builder /opt/conda /opt/conda

# Set working directory
WORKDIR /app

# Copy application code
COPY src/ ./src/

# Expose port
EXPOSE 8000

# Health check (using Python since curl is not installed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the application
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
