export interface OnshapeCompany {
  id: string; // the cid used in /api/revisions/companies/{cid}
  name: string;
  description?: string;
  adminEnabled?: boolean;
}

export interface OnshapeCompaniesResponse {
  items: OnshapeCompany[];
}
