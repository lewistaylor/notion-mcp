import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  notionRequest,
  safeHandler,
  jsonContent,
  assertId,
  paginatePost,
} from "../notion.js";

export function register(server: McpServer) {
  server.registerTool(
    "list_databases",
    {
      description:
        "List all Notion databases accessible to the integration. " +
        "Uses the search API filtered to database objects. " +
        "Example: list_databases({ page_size: 20 })",
      inputSchema: {
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous list_databases response."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of databases to return (1–100, default 10)."),
      },
    },
    safeHandler(async ({ start_cursor, page_size }) => {
      const body: Record<string, unknown> = {
        filter: { value: "database", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
      };
      if (start_cursor) body.start_cursor = start_cursor;
      if (page_size !== undefined) body.page_size = page_size;

      const results = await notionRequest("/search", {
        method: "POST",
        body,
      });
      return jsonContent(results);
    }),
  );

  server.registerTool(
    "get_database",
    {
      description:
        "Retrieve a Notion database schema by its ID. Returns the database title, " +
        "description, and the full properties schema (column names, types, options). " +
        "Use this before query_database to understand available filter fields. " +
        "Example: get_database({ database_id: 'abc...' })",
      inputSchema: {
        database_id: z
          .string()
          .describe("The database ID (UUID with or without hyphens)."),
      },
    },
    safeHandler(async ({ database_id }) => {
      const id = assertId(database_id, "database_id");
      const db = await notionRequest(`/databases/${id}`);
      return jsonContent(db);
    }),
  );

  server.registerTool(
    "query_database",
    {
      description:
        "Query rows from a Notion database with optional filters and sorts. " +
        "filter follows Notion's filter object schema. " +
        "sorts is an array of sort objects. " +
        "Example simple filter: query_database({ database_id: 'abc...', " +
        "filter: { property: 'Status', select: { equals: 'In progress' } } }). " +
        "Example compound filter: query_database({ database_id: 'abc...', " +
        "filter: { and: [ { property: 'Assignee', people: { contains: 'user-id' } }, " +
        "{ property: 'Due', date: { before: '2025-12-31' } } ] } }). " +
        "Example sort: query_database({ database_id: 'abc...', " +
        "sorts: [{ property: 'Created', direction: 'descending' }] })",
      inputSchema: {
        database_id: z
          .string()
          .describe("The database ID (UUID with or without hyphens)."),
        filter: z
          .record(z.unknown())
          .optional()
          .describe(
            "Notion filter object. Supports property filters (select, multi_select, " +
            "checkbox, date, number, text, people, relation, etc.) and compound operators (and, or).",
          ),
        sorts: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            'Array of sort objects. Each has { property: "Name", direction: "ascending" | "descending" } ' +
            'or { timestamp: "created_time" | "last_edited_time", direction: "..." }.',
          ),
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor returned as next_cursor from a previous query."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of rows to return per page (1–100, default 100)."),
        filter_properties: z
          .array(z.string())
          .optional()
          .describe(
            "Limit which properties are returned in each page object (list of property IDs or names). " +
            "Reduces response size for databases with many columns.",
          ),
      },
    },
    safeHandler(
      async ({
        database_id,
        filter,
        sorts,
        start_cursor,
        page_size,
        filter_properties,
      }) => {
        const id = assertId(database_id, "database_id");
        const body: Record<string, unknown> = {};
        if (filter !== undefined) body.filter = filter;
        if (sorts !== undefined) body.sorts = sorts;
        if (start_cursor) body.start_cursor = start_cursor;
        if (page_size !== undefined) body.page_size = page_size;

        const params: Record<string, string> = {};
        if (filter_properties?.length) {
          params.filter_properties = filter_properties.join(",");
        }

        const rows = await notionRequest(`/databases/${id}/query`, {
          method: "POST",
          body,
          ...(Object.keys(params).length ? { params } : {}),
        });
        return jsonContent(rows);
      },
    ),
  );

  server.registerTool(
    "create_database",
    {
      description:
        "Create a new Notion database as a child of an existing page. " +
        "Define the schema via the properties object — each key is a column name and the value " +
        "describes its type. The title column is required. " +
        "Example: create_database({ parent: { page_id: 'abc...' }, " +
        "title: [{ text: { content: 'Tasks' } }], " +
        "properties: { Name: { title: {} }, Status: { select: { options: [{ name: 'Todo', color: 'red' }] } }, " +
        "Due: { date: {} } } })",
      inputSchema: {
        parent: z
          .record(z.unknown())
          .describe(
            'Parent page reference. Must be { page_id: "..." } — databases can only be created inside pages.',
          ),
        title: z
          .array(z.record(z.unknown()))
          .describe(
            'Rich text array for the database title. E.g. [{ text: { content: "My Database" } }]',
          ),
        properties: z
          .record(z.unknown())
          .describe(
            "Schema definition. Keys are column names; values are type objects. " +
            "Supported types: title (required), rich_text, number, select, multi_select, " +
            "date, people, checkbox, url, email, phone_number, relation, formula, rollup.",
          ),
        icon: z
          .record(z.unknown())
          .optional()
          .describe('Database icon. E.g. { type: "emoji", emoji: "📋" }'),
        cover: z
          .record(z.unknown())
          .optional()
          .describe("Database cover image."),
      },
    },
    safeHandler(async ({ parent, title, properties, icon, cover }) => {
      const body: Record<string, unknown> = { parent, title, properties };
      if (icon !== undefined) body.icon = icon;
      if (cover !== undefined) body.cover = cover;

      const db = await notionRequest("/databases", { method: "POST", body });
      return jsonContent(db);
    }),
  );

  server.registerTool(
    "update_database",
    {
      description:
        "Update a Notion database's title, description, or schema (add/modify/remove properties). " +
        "Only supplied fields are changed. To add a new column supply its name and type in properties. " +
        "To rename a column include the existing property ID with an updated name field. " +
        "Example: update_database({ database_id: 'abc...', " +
        "title: [{ text: { content: 'Updated title' } }], " +
        "properties: { Priority: { select: { options: [{ name: 'High', color: 'red' }, { name: 'Low', color: 'blue' }] } } } })",
      inputSchema: {
        database_id: z
          .string()
          .describe("The database ID (UUID with or without hyphens)."),
        title: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("New database title as a rich text array."),
        description: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("New database description as a rich text array."),
        properties: z
          .record(z.unknown())
          .optional()
          .describe(
            "Schema changes. Add new columns or modify existing ones. " +
            "Set a property value to null to remove it.",
          ),
        icon: z
          .record(z.unknown())
          .optional()
          .describe("Updated icon."),
        cover: z
          .record(z.unknown())
          .optional()
          .describe("Updated cover image."),
      },

    },
    safeHandler(
      async ({ database_id, title, description, properties, icon, cover }) => {
        const id = assertId(database_id, "database_id");
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = title;
        if (description !== undefined) body.description = description;
        if (properties !== undefined) body.properties = properties;
        if (icon !== undefined) body.icon = icon;
        if (cover !== undefined) body.cover = cover;

        const db = await notionRequest(`/databases/${id}`, {
          method: "PATCH",
          body,
        });
        return jsonContent(db);
      },
    ),
  );

  server.registerTool(
    "query_database_all",
    {
      description:
        "Query ALL rows from a Notion database with optional filters and sorts, automatically " +
        "paginating through every result page. Use this instead of query_database when you need " +
        "the complete result set rather than a single page. Fetches up to 10,000 rows (100 pages × 100 rows). " +
        "Example: query_database_all({ database_id: 'abc...', " +
        "filter: { property: 'Done', checkbox: { equals: false } }, " +
        "sorts: [{ property: 'Due', direction: 'ascending' }] })",
      inputSchema: {
        database_id: z
          .string()
          .describe("The database ID (UUID with or without hyphens)."),
        filter: z
          .record(z.unknown())
          .optional()
          .describe(
            "Notion filter object. Supports property filters and compound operators (and, or). " +
            "Example: { property: 'Status', select: { equals: 'In progress' } }",
          ),
        sorts: z
          .array(z.record(z.unknown()))
          .optional()
          .describe(
            'Array of sort objects. E.g. [{ property: "Due", direction: "ascending" }]',
          ),
      },
    },
    safeHandler(async ({ database_id, filter, sorts }) => {
      const id = assertId(database_id, "database_id");
      const body: Record<string, unknown> = {};
      if (filter !== undefined) body.filter = filter;
      if (sorts !== undefined) body.sorts = sorts;

      const rows = await paginatePost(`/databases/${id}/query`, body);
      return jsonContent({ results: rows, total: rows.length });
    }),
  );
}
