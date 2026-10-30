import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { asc } from "drizzle-orm";
import { z } from "zod";
import type { PageList, SearchResult, SpaceList, UpdatePageInput } from "../api/types";
import { describeError } from "../auth/middleware";
import type { Db } from "../db/client";
import { spaces, type UserRow } from "../db/schema";
import { findAccessiblePage, listPageSummaries } from "../pages/queries";
import { searchAccessiblePages } from "../pages/search";
import { createPage, updatePage } from "../pages/service";
import {
  emptyUpdateMessage,
  invalidPageBodyMessage,
  invalidSearchQueryMessage,
  invalidTitleMessage,
  invalidVersionMessage,
  isValidPageBody,
  normalizePageTitle,
  normalizeSearchQuery,
  normalizeVersion,
  pageNotFoundMessage,
  versionConflictMessage,
} from "../pages/validation";
import { toApiPage, toApiPageSummary, toApiSearchHit, toApiSpace } from "../routes/api";
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

// openWorldHint defaults to true, so it is set explicitly: the tools only touch this wiki.
const readOnlyAnnotations = { readOnlyHint: true, openWorldHint: false };

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
      annotations: readOnlyAnnotations,
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
      annotations: readOnlyAnnotations,
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
      annotations: readOnlyAnnotations,
    },
    ({ page_id }) =>
      guard("get_page", async () => {
        const page = await findAccessiblePage(db, user, page_id);
        if (!page) return errorResult(pageNotFoundMessage);
        return jsonResult(toApiPage(page));
      }),
  );

  server.registerTool(
    "search_pages",
    {
      description:
        "Search pages by a substring of the title or the body, in the spaces the signed-in user can access. " +
        "Matching is case-insensitive for ASCII letters only; there is no word splitting, so the whole query is matched as one string. " +
        "Pages whose title matches come first, then the most recently updated. Returns up to 50 pages without bodies, " +
        "each with a snippet of the body around the first match (null when only the title matches). " +
        "has_more is true when more pages matched; narrow the query or pass space_id. Use get_page to read a body.",
      inputSchema: {
        // Not .min()/.max(): normalizeSearchQuery checks it, so that the message is the same as in the REST API.
        query: z.string().describe("The text to search for, 1 to 100 characters"),
        space_id: z
          .string()
          .optional()
          .describe("Limit the search to this space, an id returned by list_spaces"),
      },
      annotations: readOnlyAnnotations,
    },
    ({ query, space_id }) =>
      guard("search_pages", async () => {
        // Validated in the same order as GET /api/v1/search.
        const normalizedQuery = normalizeSearchQuery(query);
        if (normalizedQuery === null) return errorResult(invalidSearchQueryMessage);
        const result = await searchAccessiblePages(db, user, normalizedQuery, space_id);
        if (!result.ok) return errorResult("スペースが見つかりません");
        const body: SearchResult = { hits: result.result.hits.map(toApiSearchHit), has_more: result.result.hasMore };
        return jsonResult(body);
      }),
  );

  server.registerTool(
    "create_page",
    {
      description:
        "Create a page in a space. The body is Markdown. " +
        "Returns the new page's metadata (id, version, ...) without the body. " +
        "A page in the personal space (kind=personal) is visible only to the calling user; " +
        "a page in an 'everyone' space is visible to all users.",
      inputSchema: {
        space_id: z.string().describe("The id of a space returned by list_spaces"),
        title: z.string().describe("The page title, 1 to 200 characters, without line breaks"),
        body: z.string().describe("The page body in Markdown, up to 512KB"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ space_id, title, body }) =>
      guard("create_page", async () => {
        // Validated in the same order as POST /api/v1/spaces/:id/pages.
        const normalizedTitle = normalizePageTitle(title);
        if (normalizedTitle === null) return errorResult(invalidTitleMessage);
        if (!isValidPageBody(body)) return errorResult(invalidPageBodyMessage);
        const result = await createPage(db, user, space_id, { title: normalizedTitle, body });
        if (!result.ok) return errorResult("スペースが見つかりません");
        // No body: the caller has just sent it, and it can be up to 512KB.
        return jsonResult(toApiPageSummary(result.page));
      }),
  );

  server.registerTool(
    "update_page",
    {
      description:
        "Update the title and/or the Markdown body of a page. " +
        "version must be the current version from get_page; if someone else updated the page first, " +
        "the call fails and nothing is changed. body replaces the whole body. " +
        "There is no edit history yet, so the previous content cannot be restored. " +
        "Returns the page's metadata without the body.",
      inputSchema: {
        page_id: z.string().describe("The id of a page returned by list_pages"),
        // Not z.number().int(): normalizeVersion checks it, so that the message is the same as in the REST API.
        version: z
          .number()
          .describe(
            "The current version of the page from get_page, an integer of 1 or more. " +
              "If someone else updated the page first, the call fails",
          ),
        title: z
          .string()
          .optional()
          .describe("The new title, 1 to 200 characters, without line breaks. Omit to keep the current title"),
        body: z
          .string()
          .optional()
          .describe("The new body in Markdown, up to 512KB. Replaces the whole body. Omit to keep the current body"),
      },
      // Destructive: there is no history, so overwritten content cannot be restored.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ page_id, version, title, body }) =>
      guard("update_page", async () => {
        // Validated in the same order as PATCH /api/v1/pages/:id.
        const normalizedVersion = normalizeVersion(version);
        if (normalizedVersion === null) return errorResult(invalidVersionMessage);
        if (title === undefined && body === undefined) return errorResult(emptyUpdateMessage);
        const input: UpdatePageInput = { version: normalizedVersion };
        if (title !== undefined) {
          const normalizedTitle = normalizePageTitle(title);
          if (normalizedTitle === null) return errorResult(invalidTitleMessage);
          input.title = normalizedTitle;
        }
        if (body !== undefined) {
          if (!isValidPageBody(body)) return errorResult(invalidPageBodyMessage);
          input.body = body;
        }
        const result = await updatePage(db, user, page_id, input);
        if (result.ok) return jsonResult(toApiPageSummary(result.page));
        if (result.error === "not_found") return errorResult(pageNotFoundMessage);
        return errorResult(
          `${versionConflictMessage}。get_page で最新の version と本文を取得し、変更を反映し直してから update_page を呼んでください`,
        );
      }),
  );
}
