/// <reference types="vitest" />
/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import Logger from "..";

vi.spyOn(global.console, "log");
vi.spyOn(global.console, "info");
vi.spyOn(global.console, "trace");
vi.spyOn(global.console, "warn");
vi.spyOn(global.console, "error");

describe("logger", () => {
  const logger = Logger.create("test");
  it("calls console info", () => {
    logger.info("hello");
    expect(console.info).toBeCalled();
  });
  it("calls console trace", () => {
    logger.trace("hello");
    expect(console.trace).toBeCalled();
  });
  it("calls console warn", () => {
    logger.warn("hello");
    expect(console.warn).toBeCalled();
  });
  it("calls console error", () => {
    logger.error("hello");
    expect(console.error).toBeCalled();
  });
});
