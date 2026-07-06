"""Pydantic models for the /convert contract.

Field names are camelCase on purpose: they must match the wire format in
docs/specs/animated-work-instructions-contracts.md exactly.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SourceSpec(BaseModel):
    url: str
    format: Literal["step"] = "step"


class OutputTarget(BaseModel):
    url: str


class OutputSpec(BaseModel):
    glb: OutputTarget
    graph: OutputTarget


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    linearDeflection: float = 0.1
    angularDeflection: float = 0.5
    compress: bool = True


class ConvertRequest(BaseModel):
    jobId: str
    source: SourceSpec
    outputs: OutputSpec
    options: ConvertOptions = ConvertOptions()


class ConvertStats(BaseModel):
    convertMs: int
    meshTriangles: int
    warnings: list[str] = []


class ConvertResponse(BaseModel):
    ok: Literal[True] = True
    partCount: int
    unit: str
    stats: ConvertStats


class PlanOutputSpec(BaseModel):
    plan: OutputTarget


class PlanOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    linearDeflection: float = 0.1
    angularDeflection: float = 0.5
    clearance: float = 0.5
    pathSamples: int = 60


class PlanRequest(BaseModel):
    jobId: str
    source: SourceSpec
    # Optional: the caller now persists the plan from the response body (see
    # PlanResponse.plan). A pre-signed upload URL would expire during the
    # multi-minute planner run, so uploading here is best-effort/backward-compat
    # only.
    outputs: PlanOutputSpec | None = None
    options: PlanOptions = PlanOptions()


class PlanStats(BaseModel):
    planMs: int
    tiers: dict[str, int]
    warnings: list[str] = []
    # Parts whose insertion passed forward verification against the parts
    # present at their point in the final sequence
    verifiedCount: int | None = None


# Planning a large assembly runs for 10+ minutes — longer than any single HTTP
# request survives across the app/tunnel/undici stack. So POST /plan starts the
# work in the background and returns immediately; the caller polls
# GET /plan/{jobId} until it reports "done" and then persists the inline plan.


class PlanStartResponse(BaseModel):
    ok: Literal[True] = True
    jobId: str
    status: str  # "pending" | "running"


class PlanStatusResponse(BaseModel):
    ok: Literal[True] = True
    status: str  # "pending" | "running" | "done" | "error"
    # Present only when status == "done":
    plan: dict | None = None
    partCount: int | None = None
    plannedCount: int | None = None
    stats: PlanStats | None = None
    # Present only when status == "error":
    error: str | None = None


class HealthResponse(BaseModel):
    ok: Literal[True] = True
    version: str
