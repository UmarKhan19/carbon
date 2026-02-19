import { createRequestHandler, RouterContextProvider } from "react-router";
// @ts-expect-error
import * as build from "virtual:react-router/server-build";

const handler = createRequestHandler(build);

export default {
  // @ts-expect-error
  fetch: (req: Request) => handler(req, new RouterContextProvider()),
};