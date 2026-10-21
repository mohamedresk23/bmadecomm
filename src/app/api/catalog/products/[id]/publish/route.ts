import { publicationHandler } from "../../../../../../modules/catalog/products/infrastructure/publication-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = publicationHandler("published");
