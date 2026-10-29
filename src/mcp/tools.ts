import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { asc } from "drizzle-orm";
import { z } from "zod";
import type { PageList, SpaceList } from "../api/types";
import { describeError } from "../auth/middleware";
import type { Db } from "../db/client";
import { spaces, type UserRow } from "../db/schema";
import { findAccessiblePage, listPageSummaries } from "../pages/queries";
import { toApiPage, toApiPageSummary, toApiSpace } from "../routes/api";
import { accessibleSpacesWhere, canAccessSpace } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";

export type ToolDeps = { db: Db; user: UserRow };

// Results are JSON text only. No structuredContent: a page body can be up to 512KB, and
// sending it twice would double the response.
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Unexpected errors are logged and reported with a fixed message, so that SQL and parameters
// in error messages never reach the client.
async function guard(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    console.error("mcp tool failed", { tool, ...describeError(error) });
    return errorResult("サーバーでエラーが発生しました");
  }
}

// Access checks go through spaces/access.ts and pages/queries.ts only, as in the REST API.
export function registerTools(server: McpServer, { db, user }: ToolDeps): void {
  server.registerTool(
    "list_spaces",
    {
      description:
        "List the spaces the signed-in user can access, in creation order. Each space has an id, a kind and a name. " +
        "kind is 'everyone' (all users), 'admin' (admins only) or 'personal'. " +
        "The personal space (kind=personal, name=null) belongs to the calling user and is private to them. " +
        "Use a space id with list_pages.",
    },
    () =>
      guard("list_spaces", async () => {
        const rows = await db
          .select()
          .from(spaces)
          .where(accessibleSpacesWhere(user))
          .orderBy(asc(spaces.createdAt), asc(spaces.id))
          .all();
        const body: SpaceList = { spaces: rows.map(toApiSpace) };
        return jsonResult(body);
      }),
  );

  server.registerTool(
    "list_pages",
    {
      description:
        "List the pages in a space, most recently updated first. Returns titles and metadata without page bodies. " +
        "Use get_page with a page id to read the body.",
      inputSchema: { space_id: z.string().describe("The id of a space returned by list_spaces") },
    },
    ({ space_id }) =>
      guard("list_pages", async () => {
        const space = await findSpaceById(db, space_id);
        // Spaces the user cannot access are reported as missing so that their existence is not revealed.
        if (!space || !canAccessSpace(user, space)) return errorResult("スペースが見つかりません");
        const rows = await listPageSummaries(db, space.id);
        const body: PageList = { pages: rows.map(toApiPageSummary) };
        return jsonResult(body);
      }),
  );

  server.registerTool(
    "get_page",
    {
      description:
        "Get a page with its Markdown body and metadata. version is incremented on every update.",
      inputSchema: { page_id: z.string().describe("The id of a page returned by list_pages") },
    },
    ({ page_id }) =>
      guard("get_page", async () => {
        const page = await findAccessiblePage(db, user, page_id);
        if (!page) return errorResult("ページが見つかりません");
        return jsonResult(toApiPage(page));
      }),
  );
}
