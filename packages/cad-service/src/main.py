"""
CAD Service - FastAPI application for STEP file processing

Endpoints:
- POST /parse: Parse STEP file and return GLB + hierarchy
- GET /health: Health check
"""

import base64
import logging
import multiprocessing
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Carbon CAD Service",
    description="STEP file parsing and glTF conversion using OpenCascade (PythonOCC)",
    version="1.0.0",
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AssemblyNode(BaseModel):
    """Node in the assembly hierarchy tree"""
    id: str
    name: str
    type: str  # "assembly" | "part"
    children: list["AssemblyNode"] = []
    transform: Optional[list[float]] = None  # 4x4 matrix as flat array
    color: Optional[list[float]] = None  # RGBA


class ParseResponse(BaseModel):
    """Response from /parse endpoint"""
    success: bool
    hierarchy: Optional[AssemblyNode] = None
    glb_base64: Optional[str] = None
    part_count: int = 0
    parse_time_ms: int = 0
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Response from /health endpoint"""
    status: str
    version: str
    opencascade_version: str


def _parse_in_subprocess(step_path: str, tolerance: float, angular_tolerance: float, result_queue):
    """
    Run STEP parsing in a subprocess to isolate C++ crashes.
    If OpenCascade throws a C++ exception, only this subprocess dies.
    """
    try:
        # Use absolute imports for subprocess compatibility (spawn method on macOS)
        import sys
        import os
        # Ensure /app is in the path for the subprocess
        app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if app_dir not in sys.path:
            sys.path.insert(0, app_dir)

        from src.parser import StepParser
        from src.gltf_writer import GltfWriter

        parser = StepParser(
            linear_deflection=tolerance,
            angular_deflection=angular_tolerance,
        )

        result = parser.parse(step_path)

        if not result["success"]:
            result_queue.put({"success": False, "error": result.get("error", "Unknown parsing error")})
            return

        # Convert meshes to GLB
        writer = GltfWriter()
        glb_bytes = writer.write_glb(
            meshes=result["meshes"],
            hierarchy=result["hierarchy"],
        )

        # Encode GLB as base64
        glb_base64 = base64.b64encode(glb_bytes).decode("utf-8")

        result_queue.put({
            "success": True,
            "hierarchy": result["hierarchy"],
            "glb_base64": glb_base64,
            "part_count": result["part_count"],
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        result_queue.put({"success": False, "error": str(e)})


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Import OCC to verify it's available
        from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox

        # Quick test to ensure OCCT works
        _ = BRepPrimAPI_MakeBox(1.0, 1.0, 1.0).Shape()

        from OCC import VERSION as OCC_VERSION

        return HealthResponse(
            status="ok",
            version="1.0.0",
            opencascade_version=OCC_VERSION,
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail=f"OpenCascade not available: {e}")


@app.post("/parse", response_model=ParseResponse)
async def parse_step_file(
    file: UploadFile = File(...),
    tolerance: float = Form(default=0.1),
    angular_tolerance: float = Form(default=0.5),
):
    """
    Parse a STEP file and return GLB + assembly hierarchy

    Args:
        file: STEP file to parse (.step or .stp)
        tolerance: Linear deflection for tessellation (default: 0.1mm)
        angular_tolerance: Angular deflection in degrees (default: 0.5)

    Returns:
        ParseResponse with hierarchy tree and base64-encoded GLB
    """
    start_time = time.time()

    # Validate file extension
    filename = file.filename or "model.step"
    if not filename.lower().endswith((".step", ".stp")):
        return ParseResponse(
            success=False,
            error=f"Invalid file type: {filename}. Expected .step or .stp",
        )

    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        logger.info(f"Processing STEP file: {filename} ({len(content)} bytes)")

        # Run parsing in subprocess to isolate C++ crashes
        # If OpenCascade crashes, only the subprocess dies, not the main server
        result_queue = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=_parse_in_subprocess,
            args=(str(tmp_path), tolerance, angular_tolerance, result_queue),
        )
        process.start()

        # CRITICAL: Read from queue BEFORE joining to avoid deadlock!
        # Queue uses a pipe - if data is large and pipe fills, subprocess blocks.
        # If we wait on join() first, we deadlock (subprocess waiting to write,
        # parent waiting for subprocess to exit).
        result = None
        timeout_seconds = 300  # 5 minute timeout
        try:
            result = result_queue.get(timeout=timeout_seconds)
        except Exception as queue_err:
            logger.warning(f"Queue read error: {queue_err}")

        # Now join (should be quick since subprocess already put data and exited)
        process.join(timeout=10)

        if process.is_alive():
            process.terminate()
            process.join()
            return ParseResponse(
                success=False,
                error="Parsing timed out after 5 minutes",
            )

        if result is None:
            if process.exitcode != 0:
                return ParseResponse(
                    success=False,
                    error=f"Parser crashed (exit code {process.exitcode}). The STEP file may contain unsupported geometry.",
                )
            return ParseResponse(
                success=False,
                error="Parser crashed without returning a result",
            )

        if not result["success"]:
            return ParseResponse(
                success=False,
                error=result.get("error", "Unknown parsing error"),
            )

        parse_time_ms = int((time.time() - start_time) * 1000)

        glb_size = len(result["glb_base64"]) * 3 // 4  # Approximate decoded size

        logger.info(
            f"Successfully parsed {filename}: "
            f"{result['part_count']} parts, "
            f"~{glb_size} bytes GLB, "
            f"{parse_time_ms}ms"
        )

        return ParseResponse(
            success=True,
            hierarchy=result["hierarchy"],
            glb_base64=result["glb_base64"],
            part_count=result["part_count"],
            parse_time_ms=parse_time_ms,
        )

    except Exception as e:
        logger.exception(f"Error parsing STEP file: {e}")
        return ParseResponse(
            success=False,
            error=str(e),
        )

    finally:
        # Cleanup temp file
        if "tmp_path" in locals():
            try:
                tmp_path.unlink()
            except Exception:
                pass


@app.get("/")
async def root():
    """Root endpoint with API info"""
    return {
        "service": "Carbon CAD Service",
        "version": "1.0.0",
        "endpoints": {
            "/health": "GET - Health check",
            "/parse": "POST - Parse STEP file",
        },
    }
