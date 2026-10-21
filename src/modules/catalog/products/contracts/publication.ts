import { z } from "zod";
import type { PublicationReadinessIssue } from "./publication-readiness";

export const publicationRequestSchema = z.object({}).strict();
export interface PublicationFailureResponse {
  error: {
    code: "PUBLICATION_READINESS_FAILED";
    message: string;
    details: PublicationReadinessIssue[];
    request_id?: string;
  };
}
