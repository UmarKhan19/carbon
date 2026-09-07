import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("react-router", () => ({
  useLoaderData: () => null,
  useParams: () => ({ id: "change-1" })
}));
vi.mock("~/hooks", () => ({ useRouteData: () => null }));
vi.mock("~/modules/items", () => ({
  getChangeNoticeImpactWorkspace: vi.fn()
}));
vi.mock("~/modules/items/items.server", () => ({
  getChangeNoticeImpactReadAccess: vi.fn()
}));
vi.mock("~/modules/items/ui/ChangeNotice", () => ({
  ChangeNoticeImpactWorkspace: () => null
}));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));

const { shouldRevalidate } = await import("./$id.impact._index");

function navigation(
  current: string,
  next: string,
  overrides: Record<string, unknown> = {}
) {
  return shouldRevalidate({
    currentUrl: new URL(current, "https://erp.test"),
    nextUrl: new URL(next, "https://erp.test"),
    formMethod: undefined,
    defaultShouldRevalidate: true,
    ...overrides
  } as never);
}

describe("Change Notice Impact route revalidation", () => {
  it("skips navigation that changes only search", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact",
        "/x/items/change-notice/change-1/impact?search=po-123"
      )
    ).toBe(false);
  });

  it("skips navigation that changes only filters", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact?filter=targetType:eq:job",
        "/x/items/change-notice/change-1/impact?filter=targetType:eq:jobMaterial"
      )
    ).toBe(false);
  });

  it.each([
    ["pathname", "/x/items/change-notice/other/impact?search=po-123"],
    [
      "another query parameter",
      "/x/items/change-notice/change-1/impact?view=all"
    ],
    ["unchanged URL", "/x/items/change-notice/change-1/impact?search=po-123"]
  ])("keeps the default for %s", (_label, next) => {
    expect(
      navigation("/x/items/change-notice/change-1/impact?search=po-123", next)
    ).toBe(true);
  });

  it("does not skip query changes on the sibling detail route", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/details?search=old",
        "/x/items/change-notice/change-1/details?search=new"
      )
    ).toBe(true);
  });

  it("keeps mutation revalidation on the default path", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact",
        "/x/items/change-notice/change-1/impact?search=po-123",
        { formMethod: "POST", defaultShouldRevalidate: true }
      )
    ).toBe(true);
  });

  it("returns the router default when an explicit refresh asks for it", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact?search=po-123",
        "/x/items/change-notice/change-1/impact?search=po-123",
        { defaultShouldRevalidate: false }
      )
    ).toBe(false);
  });
});
