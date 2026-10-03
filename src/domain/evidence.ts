import type { Platform } from "./units.ts";

export interface Evidence {
  source: "ed" | "moodle";
  source_id: string;
  unit_key: string;
  title: string;
  text: string;
  url: string;
  published_at?: string;
}

export interface SearchCoverage {
  source: Platform;
  status: "searched" | "partial" | "unavailable" | "not_configured";
  examined: number;
  reason?: string;
}

export interface EvidenceSearch {
  evidence: Evidence[];
  coverage: SearchCoverage;
}
