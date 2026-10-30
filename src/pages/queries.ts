import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, type PageRow } from "../db/schema";
import { canAccessSpace, type SpaceViewer } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";

export function findPageById(db: Db, id: string): Promise<PageRow | undefined> {
  return db.select().from(pages).where(eq(pages.id, id)).get();
}

// Returns the page only if the viewer can access its space, otherwise null.
// Callers report null as missing so that the existence of the page is not revealed.
export async function findAccessiblePage(db: Db, viewer: SpaceViewer, id: string): Promise<PageRow | null> {
  const page = await findPageById(db, id);
  if (!page) return null;
  const space = await findSpaceById(db, page.spaceId);
  if (!space || !canAccessSpace(viewer, space)) return null;
  return page;
}

// Lists pages without reading their bodies, which can be up to 512KB each.
export function listPageSummaries(db: Db, spaceId: string): Promise<Omit<PageRow, "body">[]> {
  return db
    .select({
      id: pages.id,
      spaceId: pages.spaceId,
      folderId: pages.folderId,
      title: pages.title,
      version: pages.version,
      createdBy: pages.createdBy,
      updatedBy: pages.updatedBy,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(eq(pages.spaceId, spaceId))
    .orderBy(desc(pages.updatedAt), asc(pages.id))
    .all();
}
