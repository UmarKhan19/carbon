import { generatePath } from "react-router";

// Route prefixes matching routes folder structure
const x = "/x"; // from ~/routes/x+ folder (authenticated routes)
const api = "/api"; // from ~/routes/api+ folder (API endpoints)
const share = "/share"; // from ~/routes/share+ folder (shared routes)

export const ASSEMBLY_URL =
  typeof window !== "undefined"
    ? window.env?.ASSEMBLY_URL || "http://localhost:3002"
    : process.env.ASSEMBLY_URL || "http://localhost:3002";

export const ERP_URL =
  typeof window !== "undefined"
    ? window.env?.ERP_URL || "http://localhost:3000"
    : process.env.ERP_URL || "http://localhost:3000";

export const path = {
  to: {
    // API endpoints
    api: {
      // Project APIs
      projectUpload: `${api}/project.upload`,
      projectSimulate: `${api}/project.simulate`,
      projectExportVideo: `${api}/project.export-video`,
      projectExportPdf: `${api}/project.export-pdf`,
      projectTree: (id: string) => generatePath(`${api}/project.${id}.tree`),
      projectSteps: (id: string) => generatePath(`${api}/project.${id}.steps`),

      // Step APIs
      stepUpdate: (projectId: string, stepId: string) =>
        generatePath(`${api}/project.${projectId}.step.${stepId}.update`),

      // Library APIs
      tools: `${api}/library.tools`,
      torqueSpecs: `${api}/library.torque-specs`,
      associations: `${api}/library.associations`
    },

    // External URLs
    external: {
      erp: ERP_URL
    },

    // Share URLs
    share: {
      project: (token: string) => generatePath(`${share}/${token}`)
    },

    // Auth routes
    login: "/login",
    logout: "/logout",
    register: "/register",

    // Root authenticated route
    authenticatedRoot: `${x}`,

    // Dashboard
    dashboard: `${x}`,

    // Projects
    projects: `${x}/projects`,
    newProject: `${x}/projects/new`,
    project: (id: string) => generatePath(`${x}/projects/${id}`),
    projectPrep: (id: string) => generatePath(`${x}/projects/${id}/prep`),
    projectEdit: (id: string) => generatePath(`${x}/projects/${id}/edit`),
    projectExport: (id: string) => generatePath(`${x}/projects/${id}/export`),

    // Settings
    settings: `${x}/settings`,
    settingsTools: `${x}/settings/tools`,
    settingsTorque: `${x}/settings/torque`,
    settingsAssociations: `${x}/settings/associations`
  }
} as const;

export function requestReferrer(request: Request, withParams = false): string {
  const referrer = request.headers.get("referer");
  if (!referrer) return path.to.dashboard;

  try {
    const url = new URL(referrer);
    return withParams ? url.pathname + url.search : url.pathname;
  } catch {
    return path.to.dashboard;
  }
}
