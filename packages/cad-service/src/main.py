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

# Configure logging with format matching C++ and Rust services
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("cad-service")

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


@app.on_event("startup")
async def startup_event():
    logger.info("[cad-service] Carbon CAD Service (Python) v1.0.0")
    logger.info("[cad-service] PythonOCC (OpenCascade) + subprocess isolation")
    try:
        from OCC import VERSION as OCC_VERSION
        logger.info("[cad-service] OpenCascade version: %s", OCC_VERSION)
    except Exception:
        logger.warning("[cad-service] OpenCascade version not available at startup")


def _parse_in_subprocess(step_path: str, tolerance: float, angular_tolerance: float, result_queue):
    """
    Run STEP parsing in a subprocess to isolate C++ crashes.
    If OpenCascade throws a C++ exception, only this subprocess dies.
    """
    try:
        # Use absolute imports for subprocess compatibility (spawn method on macOS)
        import sys
        import os
        sub_logger = logging.getLogger("cad-service.subprocess")

        # Ensure /app is in the path for the subprocess
        app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if app_dir not in sys.path:
            sys.path.insert(0, app_dir)

        from src.parser import StepParser
        from src.gltf_writer import GltfWriter

        sub_logger.info("[parse] Subprocess started, initializing StepParser (tolerance=%.3f, angular=%.1f)", tolerance, angular_tolerance)

        parser = StepParser(
            linear_deflection=tolerance,
            angular_deflection=angular_tolerance,
        )

        sub_logger.info("[parse] Parsing STEP file: %s", step_path)
        parse_start = time.time()
        result = parser.parse(step_path)
        parse_ms = int((time.time() - parse_start) * 1000)

        if not result["success"]:
            sub_logger.error("[parse] Parser returned failure after %dms: %s", parse_ms, result.get("error", "Unknown"))
            result_queue.put({"success": False, "error": result.get("error", "Unknown parsing error")})
            return

        sub_logger.info("[parse] STEP parsed: %d parts in %dms", result["part_count"], parse_ms)

        # Convert meshes to GLB
        sub_logger.info("[parse] Converting meshes to GLB...")
        glb_start = time.time()
        writer = GltfWriter()
        glb_bytes = writer.write_glb(
            meshes=result["meshes"],
            hierarchy=result["hierarchy"],
        )
        glb_ms = int((time.time() - glb_start) * 1000)
        sub_logger.info("[parse] GLB generated: %dKB in %dms", len(glb_bytes) // 1024, glb_ms)

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
        logger.error("[health] Health check failed: %s", e)
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
        logger.warning("[parse] Rejected file with invalid extension: %s", filename)
        return ParseResponse(
            success=False,
            error=f"Invalid file type: {filename}. Expected .step or .stp",
        )

    try:
        # Save uploaded file to temp location
        logger.info("[handler] Received file: %s (tolerance=%.3f, angular=%.1f)", filename, tolerance, angular_tolerance)
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        file_size = len(content)
        save_ms = int((time.time() - start_time) * 1000)
        logger.info("[handler] Parsing STEP file: %s (%d bytes, saved in %dms)", filename, file_size, save_ms)

        # Run parsing in subprocess to isolate C++ crashes
        # If OpenCascade crashes, only the subprocess dies, not the main server
        logger.info("[parse] Spawning subprocess for isolated parsing...")
        subprocess_start = time.time()
        result_queue = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=_parse_in_subprocess,
            args=(str(tmp_path), tolerance, angular_tolerance, result_queue),
        )
        process.start()
        logger.info("[parse] Subprocess started (PID %d), waiting for result...", process.pid)

        # CRITICAL: Read from queue BEFORE joining to avoid deadlock!
        # Queue uses a pipe - if data is large and pipe fills, subprocess blocks.
        # If we wait on join() first, we deadlock (subprocess waiting to write,
        # parent waiting for subprocess to exit).
        result = None
        timeout_seconds = 300  # 5 minute timeout
        try:
            result = result_queue.get(timeout=timeout_seconds)
        except Exception as queue_err:
            logger.warning("[parse] Queue read error after %ds: %s", int(time.time() - subprocess_start), queue_err)

        # Now join (should be quick since subprocess already put data and exited)
        process.join(timeout=10)
        subprocess_ms = int((time.time() - subprocess_start) * 1000)

        if process.is_alive():
            logger.error("[parse] Subprocess still alive after %dms, terminating", subprocess_ms)
            process.terminate()
            process.join()
            return ParseResponse(
                success=False,
                error="Parsing timed out after 5 minutes",
            )

        if result is None:
            if process.exitcode != 0:
                logger.error("[parse] Subprocess crashed (exit code %d) after %dms", process.exitcode, subprocess_ms)
                return ParseResponse(
                    success=False,
                    error=f"Parser crashed (exit code {process.exitcode}). The STEP file may contain unsupported geometry.",
                )
            logger.error("[parse] Subprocess returned no result after %dms", subprocess_ms)
            return ParseResponse(
                success=False,
                error="Parser crashed without returning a result",
            )

        if not result["success"]:
            logger.error("[parse] Parse failed after %dms: %s", subprocess_ms, result.get("error", "Unknown"))
            return ParseResponse(
                success=False,
                error=result.get("error", "Unknown parsing error"),
            )

        parse_time_ms = int((time.time() - start_time) * 1000)

        glb_size = len(result["glb_base64"]) * 3 // 4  # Approximate decoded size
        glb_size_kb = glb_size // 1024

        logger.info(
            "[handler] Parse complete: %d parts, GLB %dKB, %dms total",
            result["part_count"],
            glb_size_kb,
            parse_time_ms,
        )

        return ParseResponse(
            success=True,
            hierarchy=result["hierarchy"],
            glb_base64=result["glb_base64"],
            part_count=result["part_count"],
            parse_time_ms=parse_time_ms,
        )

    except Exception as e:
        total_ms = int((time.time() - start_time) * 1000)
        logger.exception("[parse] Exception after %dms: %s", total_ms, e)
        return ParseResponse(
            success=False,
            error=str(e),
        )

    finally:
        # Cleanup temp file
        if "tmp_path" in locals():
            try:
                tmp_path.unlink()
                logger.info("[parse] Cleaned up temp file")
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
