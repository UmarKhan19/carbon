import { type I18n, setupI18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { describe, expect, it } from "vitest";
import type { TranslatableError } from "./error";
import {
  BusinessRuleError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  NotFoundError,
  ValidationError
} from "./errors";

/**
 * A runnable demo of every error and its translations. Run it with:
 *
 *   pnpm --filter @carbon/result demo
 *
 * It instantiates each core error (plus a domain-style override that mirrors the
 * approvals pilot), resolves each one through the SAME path `error()` uses,
 * and prints a table of what a user would see in English, Spanish, and German.
 * The `expect`s double as the "what's expected" specification.
 */

// Hand-authored catalogs so the demo shows real translations offline, before
// anyone runs `pnpm translate`. Keyed by the explicit message ids.
const SPANISH: Record<string, string> = {
  "error.notFound": "{entity} no encontrado",
  "error.validation": "Error de validación",
  "error.conflict": "Esta acción entra en conflicto con el estado actual",
  "error.businessRule":
    "Esta acción no está permitida por una regla de negocio",
  "error.database": "Algo salió mal al guardar tus cambios",
  "error.externalService": "Un servicio externo no está disponible actualmente",
  "approvals.notPending": "La solicitud de aprobación no está pendiente"
};

const GERMAN: Record<string, string> = {
  "error.notFound": "{entity} nicht gefunden",
  "error.validation": "Validierung fehlgeschlagen",
  "error.conflict": "Diese Aktion steht im Konflikt mit dem aktuellen Zustand",
  "error.businessRule":
    "Diese Aktion ist durch eine Geschäftsregel nicht erlaubt",
  "error.database": "Beim Speichern Ihrer Änderungen ist etwas schiefgelaufen",
  "error.externalService": "Ein externer Dienst ist derzeit nicht verfügbar",
  "approvals.notPending": "Die Genehmigungsanfrage ist nicht ausstehend"
};

function i18nFor(locale: string, messages: Record<string, string>): I18n {
  const i18n = setupI18n();
  i18n.load(locale, messages);
  i18n.activate(locale);
  return i18n;
}

// English uses an empty catalog, so each error falls back to its source default.
const english = i18nFor("en", {});
const spanish = i18nFor("es", SPANISH);
const german = i18nFor("de", GERMAN);

/** Resolve an error exactly as `error()` does (descriptor + interpolation). */
function render(error: TranslatableError, i18n: I18n): string {
  return i18n._({
    ...error.messageDescriptor,
    values: { ...error.messageDescriptor.values, ...error.values }
  });
}

type Row = {
  error: TranslatableError;
  tag: string;
  en: string;
  es: string;
  de: string;
};

// One representative instance of every error, plus the approvals override.
const errors: TranslatableError[] = [
  new NotFoundError({ entity: "Approval request", id: "a1b2" }),
  new ValidationError({ reason: "quantity must be positive" }),
  new ConflictError({ entity: "Time entry" }),
  new ConflictError({
    entity: "Approval request",
    descriptor: msg({
      id: "approvals.notPending",
      message: "Approval request is not pending"
    })
  }),
  new BusinessRuleError({ rule: "debits must equal credits" }),
  new DatabaseError({
    operation: "insert",
    cause: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "supplier_pkey"'
    }
  }),
  new ExternalServiceError({ service: "QuickBooks" })
];

describe("@carbon/result — all errors and their translations", () => {
  const rows: Row[] = errors.map((error) => ({
    error,
    tag: error._tag,
    en: render(error, english),
    es: render(error, spanish),
    de: render(error, german)
  }));

  it("prints the table (expected vs. translated)", () => {
    const lines = [
      "",
      "  ┌─ @carbon/result — error messages by locale ────────────────────────",
      ...rows.flatMap((r) => [
        `  • ${r.tag}  (id: ${r.error.messageDescriptor.id})`,
        `      en (expected): ${r.en}`,
        `      es           : ${r.es}`,
        `      de           : ${r.de}`
      ]),
      "  └────────────────────────────────────────────────────────────────────",
      ""
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(rows).toHaveLength(7);
  });

  it("NotFoundError interpolates the entity in every locale", () => {
    const [notFound] = rows;
    expect(notFound.en).toBe("Approval request not found");
    expect(notFound.es).toBe("Approval request no encontrado");
    expect(notFound.de).toBe("Approval request nicht gefunden");
  });

  it("a call-site override is translated, not the generic conflict default", () => {
    const override = rows.find(
      (r) => r.error.messageDescriptor.id === "approvals.notPending"
    );
    expect(override?.en).toBe("Approval request is not pending");
    expect(override?.es).toBe("La solicitud de aprobación no está pendiente");
    expect(override?.de).toBe("Die Genehmigungsanfrage ist nicht ausstehend");
  });

  it("DatabaseError shows a generic message and never leaks the raw error", () => {
    const db = rows.find((r) => r.tag === "DatabaseError");
    expect(db?.en).toBe("Something went wrong while saving your changes");
    expect(db?.es).toBe("Algo salió mal al guardar tus cambios");
    for (const locale of [db?.en, db?.es, db?.de]) {
      expect(locale).not.toContain("duplicate key");
      expect(locale).not.toContain("23505");
    }
  });

  it("every error carries serializable values and a stable id", () => {
    for (const { error } of rows) {
      expect(typeof error.messageDescriptor.id).toBe("string");
      expect(JSON.parse(JSON.stringify(error.values))).toEqual(error.values);
    }
  });
});
