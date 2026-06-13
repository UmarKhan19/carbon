import { ConflictError, DatabaseError, NotFoundError } from "@carbon/result";
import { setupI18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFlash, successFlash } from "./result";

// A small inline catalog standing in for the real compiled `es` catalog.
function spanishI18n() {
  const i18n = setupI18n();
  i18n.load("es", {
    "error.notFound": "{entity} no encontrado",
    "error.database": "Algo salió mal al guardar tus cambios",
    "approvals.notPending": "La solicitud de aprobación no está pendiente",
    "approvals.approved": "Solicitud de aprobación aprobada"
  });
  i18n.activate("es");
  return i18n;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorFlash", () => {
  it("translates the default descriptor with interpolation and marks a failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flash = errorFlash(
      new NotFoundError({ entity: "Approval request" }),
      spanishI18n()
    );
    expect(flash.success).toBe(false);
    expect(flash.message).toBe("Approval request no encontrado");
  });

  it("translates a call-site descriptor override", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flash = errorFlash(
      new ConflictError({
        entity: "Approval request",
        descriptor: msg({
          id: "approvals.notPending",
          message: "Approval request is not pending"
        })
      }),
      spanishI18n()
    );
    expect(flash.message).toBe("La solicitud de aprobación no está pendiente");
  });

  it("shows the generic message for a DatabaseError and never leaks the raw error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "supplier_pkey"'
    };
    const flash = errorFlash(
      new DatabaseError({ operation: "insert", cause: raw }),
      spanishI18n()
    );
    expect(flash.message).toBe("Algo salió mal al guardar tus cambios");
    expect(flash.message).not.toContain("duplicate key");
  });

  it("logs the raw cause for on-call debugging (parity with the legacy helper)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = { code: "23505", message: "duplicate key" };
    errorFlash(
      new DatabaseError({ operation: "insert", cause: raw }),
      spanishI18n()
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      tag: "DatabaseError",
      cause: raw
    });
  });
});

describe("successFlash", () => {
  it("translates a descriptor and marks a success", () => {
    const flash = successFlash(
      msg({ id: "approvals.approved", message: "Approval request approved" }),
      spanishI18n()
    );
    expect(flash.success).toBe(true);
    expect(flash.message).toBe("Solicitud de aprobación aprobada");
  });

  it("passes a plain string through unchanged", () => {
    const flash = successFlash("Saved", spanishI18n());
    expect(flash).toEqual({ success: true, message: "Saved" });
  });
});
