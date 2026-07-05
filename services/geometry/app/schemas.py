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


class PlanResponse(BaseModel):
    ok: Literal[True] = True
    partCount: int
    plannedCount: int
    # The plan document (plan.json contents), returned inline so the caller can
    # persist it after the planner finishes. Uploading via a pre-signed URL is
    # unreliable: the URL is minted before the multi-minute run and expires.
    plan: dict
    stats: PlanStats


class HealthResponse(BaseModel):
    ok: Literal[True] = True
    version: str
