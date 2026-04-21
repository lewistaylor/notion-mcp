import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  notionRequest,
  safeHandler,
  jsonContent,
  assertId,
} from "../notion.js";

export function register(server: McpServer) {
  server.registerTool(
    "get_page",
    {
      description:
        "Retrieve a Notion page by its ID. Returns the page object including all properties, " +
        "parent reference, icon, cover, and metadata. Does not return the page body (blocks) — " +
        "use get_block_children for that. " +
        "Example: get_page({ page_id: '1a2b3c4d-...' })",
      inputSchema: {
        page_id: z
          .string()
          .describe(
            "The page ID (UUID with or without hyphens, e.g. 1a2b3c4d-1234-1234-1234-1a2b3c4d5e6f).",
          ),
      },
    },
    safeHandler(async ({ page_id }) => {
      const id = assertId(page_id, "page_id");
      const page = await notionRequest(`/pages/${id}`);
      return jsonContent(page);
    }),
  );

  server.registerTool(
    "create_page",
    {
      description:
        "Create a new Notion page inside a parent page or database. " +
        "When the parent is a database, properties must match the database schema. " +
        "When the parent is a page, only the title property is required. " +
        "children is an array of Notion block objects appended to the page body. " +
        "Example for a database page: create_page({ parent: { database_id: 'abc...' }, " +
        "properties: { Name: { title: [{ text: { content: 'My task' } }] }, Status: { select: { name: 'In progress' } } } }). " +
        "Example for a sub-page: create_page({ parent: { page_id: 'def...' }, " +
        "properties: { title: [{ text: { content: 'Meeting notes' } }] } })",
      inputSchema: {
        parent: z
          .record(z.unknown())
          .describe(
            'Parent reference object. Use { database_id: "..." } or { page_id: "..." }.',
          ),
        properties: z
          .record(z.unknown())
          .describe(
            "Page properties matching the parent database schema, or { title: [...] } for page parents.",
          ),
        children: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            "Array of Notion block objects to append as the page body. " +
            'E.g. [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: "Hello" } }] } }]',
          ),
        icon: z
          .record(z.unknown())
          .optional()
          .describe(
            'Page icon. E.g. { type: "emoji", emoji: "📝" } or { type: "external", external: { url: "https://..." } }',
          ),
        cover: z
          .record(z.unknown())
          .optional()
          .describe(
            'Page cover image. E.g. { type: "external", external: { url: "https://..." } }',
          ),
      },
    },
    safeHandler(async ({ parent, properties, children, icon, cover }) => {
      const body: Record<string, unknown> = { parent, properties };
      if (children !== undefined) body.children = children;
      if (icon !== undefined) body.icon = icon;
      if (cover !== undefined) body.cover = cover;

      const page = await notionRequest("/pages", { method: "POST", body });
      return jsonContent(page);
    }),
  );

  server.registerTool(
    "update_page",
    {
      description:
        "Update a Notion page's properties, archive status, icon, or cover. " +
        "Only the fields you supply are changed — omitted fields are untouched. " +
        "To archive a page set archived: true. " +
        "Example: update_page({ page_id: 'abc...', properties: { Status: { select: { name: 'Done' } } } }). " +
        "Example to archive: update_page({ page_id: 'abc...', archived: true })",
      inputSchema: {
        page_id: z
          .string()
          .describe("The page ID (UUID with or without hyphens)."),
        properties: z
          .record(z.unknown())
          .optional()
          .describe("Properties to update. Only supplied properties are changed."),
        archived: z
          .boolean()
          .optional()
          .describe("Set true to archive (soft-delete) the page."),
        icon: z
          .record(z.unknown())
          .optional()
          .describe('Updated icon. E.g. { type: "emoji", emoji: "✅" }'),
        cover: z
          .record(z.unknown())
          .optional()
          .describe('Updated cover image. E.g. { type: "external", external: { url: "..." } }'),
      },
    },
    safeHandler(async ({ page_id, properties, archived, icon, cover }) => {
      const id = assertId(page_id, "page_id");
      const body: Record<string, unknown> = {};
      if (properties !== undefined) body.properties = properties;
      if (archived !== undefined) body.archived = archived;
      if (icon !== undefined) body.icon = icon;
      if (cover !== undefined) body.cover = cover;

      const page = await notionRequest(`/pages/${id}`, {
        method: "PATCH",
        body,
      });
      return jsonContent(page);
    }),
  );

  server.registerTool(
    "get_page_property",
    {
      description:
        "Retrieve a specific property value from a Notion page. Useful for large properties " +
        "(like long rich_text or multi-select lists) that are paginated in the full page response. " +
        "The property_id can be found in the page object returned by get_page (keys of the properties map). " +
        "Example: get_page_property({ page_id: 'abc...', property_id: 'title' })",
      inputSchema: {
        page_id: z
          .string()
          .describe("The page ID (UUID with or without hyphens)."),
        property_id: z
          .string()
          .describe(
            "The property ID or name (e.g. 'title', 'Status', or the raw ID from the page object).",
          ),
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor for paginated property values."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of property items to return (1–100)."),
      },
    },
    safeHandler(async ({ page_id, property_id, start_cursor, page_size }) => {
      const id = assertId(page_id, "page_id");
      const params: Record<string, string> = {};
      if (start_cursor) params.start_cursor = start_cursor;
      if (page_size !== undefined) params.page_size = String(page_size);

      const property = await notionRequest(
        `/pages/${id}/properties/${encodeURIComponent(property_id)}`,
        { params },
      );
      return jsonContent(property);
    }),
  );
}
