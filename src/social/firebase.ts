/**
 * Firebase tools: Cloud Firestore (REST v1) and Remote Config (REST v1).
 *
 * Secrets: FIREBASE_PROJECT_ID (default project; every tool also takes one per
 * call), FIRESTORE_DATABASE_ID (optional, defaults to "(default)").
 * Writes are refused unless FIREBASE_ALLOW_WRITES is exactly "true".
 * Scopes: datastore and firebase.remoteconfig, on the shared Google OAuth.
 *
 * Firestore values are typed on the wire ({ stringValue: "x" }); the tools
 * speak plain JSON instead and convert at the edge. Two escapes cover what
 * plain JSON cannot say: {"$timestamp": "2026-01-01T00:00:00Z"} and
 * {"$ref": "users/alice"}. Integers beyond 2^53 come back as strings so they
 * never lose precision silently.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { googleAuth } from "./google-shared";
import { ApiError, MissingSecretError, guard, ok } from "./shared";

const FIRESTORE_BASE = "https://firestore.googleapis.com/v1";
const REMOTE_CONFIG_BASE = "https://firebaseremoteconfig.googleapis.com/v1";

// ---------------------------------------------------------------------------
// Configuration

function project(env: Env, projectId?: string): string {
  const value = projectId ?? (env as Record<string, unknown>).FIREBASE_PROJECT_ID;
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingSecretError("FIREBASE_PROJECT_ID");
  }
  return value;
}

function databaseId(env: Env): string {
  const value = (env as Record<string, unknown>).FIRESTORE_DATABASE_ID;
  return typeof value === "string" && value.length > 0 ? value : "(default)";
}

export function writesAllowed(env: Env): boolean {
  return (env as Record<string, unknown>).FIREBASE_ALLOW_WRITES === "true";
}

function assertWrites(env: Env) {
  if (!writesAllowed(env)) {
    throw new Error(
      'Firebase writes are disabled. Set the FIREBASE_ALLOW_WRITES var to "true" to enable them.'
    );
  }
}

/** projects/{p}/databases/{d}/documents — the root every document name hangs off. */
function documentsRoot(env: Env, projectId?: string): string {
  return `projects/${project(env, projectId)}/databases/${databaseId(env)}/documents`;
}

// ---------------------------------------------------------------------------
// HTTP: callJson only knows GET/POST/DELETE and drops response headers, and
// Firestore needs PATCH, repeated query keys (updateMask.fieldPaths) and Remote
// Config needs PUT plus the ETag.

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

async function firebaseFetch(
  env: Env,
  url: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    query?: Query;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ data: unknown; etag: string | null }> {
  const { method = "GET", query, body, headers = {} } = options;

  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) target.searchParams.append(key, item);
    } else {
      target.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = {
    method,
    headers: { Accept: "application/json", ...(await googleAuth(env)), ...headers },
    signal: AbortSignal.timeout(20_000)
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = {
      ...(init.headers as Record<string, string>),
      "Content-Type": "application/json; charset=UTF-8"
    };
  }

  const response = await fetch(target.toString(), init);
  const text = await response.text();

  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Leave the raw text in place — some error pages are not JSON.
    }
  }

  if (!response.ok) throw new ApiError(response.status, parsed);
  return { data: parsed, etag: response.headers.get("ETag") };
}

// ---------------------------------------------------------------------------
// Paths

function segments(path: string): string[] {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error("Path must not be empty.");
  return parts;
}

function encodePath(parts: string[]): string {
  return parts.map(encodeURIComponent).join("/");
}

/** "users/alice" — an even number of segments. */
function documentPath(path: string): string {
  const parts = segments(path);
  if (parts.length % 2 !== 0) {
    throw new Error(`"${path}" is a collection path; a document path has an even number of segments.`);
  }
  return encodePath(parts);
}

/** "users" or "users/alice/orders" — an odd number of segments. */
function collectionPath(path: string): string {
  const parts = segments(path);
  if (parts.length % 2 !== 1) {
    throw new Error(`"${path}" is a document path; a collection path has an odd number of segments.`);
  }
  return encodePath(parts);
}

const SIMPLE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One field name as Firestore wants it in a field path: backticked unless simple. */
export function quoteSegment(segment: string): string {
  return SIMPLE_SEGMENT.test(segment)
    ? segment
    : "`" + segment.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

/** "address.city" → nested field; segments with odd characters get quoted. */
export function fieldPath(path: string): string {
  return path.split(".").map(quoteSegment).join(".");
}

// ---------------------------------------------------------------------------
// Value conversion

export type FirestoreValue = Record<string, unknown>;

const REFERENCE_PREFIX = /^projects\/[^/]+\/databases\/[^/]+\/documents\//;

export function toFirestoreValue(value: unknown, root?: string): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Unsupported number: ${value}`);
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item, root)) } };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$timestamp") {
      const raw = record.$timestamp;
      const date = new Date(raw as string);
      if (typeof raw !== "string" || Number.isNaN(date.getTime())) {
        throw new Error(`Invalid $timestamp: ${JSON.stringify(raw)}`);
      }
      return { timestampValue: date.toISOString() };
    }
    if (keys.length === 1 && keys[0] === "$ref") {
      const raw = record.$ref;
      if (typeof raw !== "string" || raw.length === 0) {
        throw new Error(`Invalid $ref: ${JSON.stringify(raw)}`);
      }
      if (REFERENCE_PREFIX.test(raw)) return { referenceValue: raw };
      if (!root) throw new Error("A relative $ref needs a project to resolve against.");
      return { referenceValue: `${root}/${segments(raw).join("/")}` };
    }
    return { mapValue: { fields: toFirestoreFields(record, root) } };
  }
  throw new Error(`Unsupported value type: ${typeof value}`);
}

export function toFirestoreFields(
  data: Record<string, unknown>,
  root?: string
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, item] of Object.entries(data)) fields[key] = toFirestoreValue(item, root);
  return fields;
}

export function fromFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) {
    const raw = String(value.integerValue);
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : raw;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return { $timestamp: value.timestampValue };
  if ("stringValue" in value) return value.stringValue;
  if ("bytesValue" in value) return { $bytes: value.bytesValue };
  if ("referenceValue" in value) {
    return { $ref: String(value.referenceValue).replace(REFERENCE_PREFIX, "") };
  }
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] }).values ?? [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    return fromFirestoreFields((value.mapValue as { fields?: Record<string, FirestoreValue> }).fields);
  }
  return value;
}

export function fromFirestoreFields(
  fields: Record<string, FirestoreValue> | undefined
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(fields ?? {})) data[key] = fromFirestoreValue(item);
  return data;
}

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

export function fromFirestoreDocument(document: FirestoreDocument) {
  const path = document.name.replace(REFERENCE_PREFIX, "");
  return {
    id: path.split("/").pop(),
    path,
    createTime: document.createTime,
    updateTime: document.updateTime,
    data: fromFirestoreFields(document.fields)
  };
}

// ---------------------------------------------------------------------------
// Queries

const OPERATORS = {
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "array-contains": "ARRAY_CONTAINS",
  in: "IN",
  "array-contains-any": "ARRAY_CONTAINS_ANY",
  "not-in": "NOT_IN"
} as const;

export type FilterOp = keyof typeof OPERATORS;

const LIST_OPERATORS: ReadonlySet<FilterOp> = new Set(["in", "not-in", "array-contains-any"]);

export type Filter = { field: string; op: FilterOp; value?: unknown };

function buildFilter(filter: Filter, root?: string) {
  const field = { fieldPath: fieldPath(filter.field) };
  // Firestore rejects null in a field filter; equality with null is a unary one.
  if (filter.value === null && (filter.op === "==" || filter.op === "!=")) {
    return { unaryFilter: { op: filter.op === "==" ? "IS_NULL" : "IS_NOT_NULL", field } };
  }
  if (LIST_OPERATORS.has(filter.op) && !Array.isArray(filter.value)) {
    throw new Error(`Operator "${filter.op}" needs an array value (field "${filter.field}").`);
  }
  return {
    fieldFilter: { field, op: OPERATORS[filter.op], value: toFirestoreValue(filter.value, root) }
  };
}

/** Filters are ANDed; a single filter is sent bare, as the API prefers. */
export function buildWhere(filters: Filter[] | undefined, root?: string) {
  if (!filters || filters.length === 0) return undefined;
  if (filters.length === 1) return buildFilter(filters[0], root);
  return {
    compositeFilter: { op: "AND", filters: filters.map((filter) => buildFilter(filter, root)) }
  };
}

// ---------------------------------------------------------------------------
// Remote Config

type RemoteConfigParameter = {
  defaultValue?: Record<string, unknown>;
  conditionalValues?: Record<string, Record<string, unknown>>;
  description?: string;
  valueType?: string;
};

type RemoteConfigTemplate = {
  conditions?: unknown[];
  parameters?: Record<string, RemoteConfigParameter>;
  parameterGroups?: Record<string, { description?: string; parameters?: Record<string, RemoteConfigParameter> }>;
  version?: { description?: string } & Record<string, unknown>;
};

function remoteConfigUrl(env: Env, projectId?: string, suffix = ""): string {
  return `${REMOTE_CONFIG_BASE}/projects/${project(env, projectId)}/remoteConfig${suffix}`;
}

async function readTemplate(env: Env, projectId?: string) {
  const { data, etag } = await firebaseFetch(env, remoteConfigUrl(env, projectId));
  if (!etag) throw new Error("Remote Config did not return an ETag; refusing to publish blind.");
  return { template: data as RemoteConfigTemplate, etag };
}

/** The map that holds `key` — top-level parameters or the group it lives in. */
function parameterHome(template: RemoteConfigTemplate, key: string) {
  if (template.parameters && key in template.parameters) return template.parameters;
  for (const group of Object.values(template.parameterGroups ?? {})) {
    if (group.parameters && key in group.parameters) return group.parameters;
  }
  return undefined;
}

async function publishTemplate(
  env: Env,
  projectId: string | undefined,
  template: RemoteConfigTemplate,
  etag: string,
  validateOnly: boolean,
  versionDescription?: string
) {
  // Version metadata is output-only except for the description.
  const body = {
    conditions: template.conditions,
    parameters: template.parameters,
    parameterGroups: template.parameterGroups,
    version: versionDescription ? { description: versionDescription } : undefined
  };
  const result = await firebaseFetch(env, remoteConfigUrl(env, projectId), {
    method: "PUT",
    query: { validateOnly: validateOnly ? "true" : undefined },
    headers: { "If-Match": etag },
    body
  });
  return {
    validateOnly,
    etag: result.etag,
    version: (result.data as RemoteConfigTemplate | null)?.version
  };
}

// ---------------------------------------------------------------------------
// Tools

const projectIdArg = z
  .string()
  .optional()
  .describe("Firebase project ID (defaults to FIREBASE_PROJECT_ID)");

const jsonValue = z
  .unknown()
  .describe('Plain JSON; use {"$timestamp": "ISO-8601"} for timestamps and {"$ref": "col/doc"} for references');

const filterArg = z.object({
  field: z.string().describe('Field path, dotted for nested fields, e.g. "address.city"'),
  op: z.enum(Object.keys(OPERATORS) as [FilterOp, ...FilterOp[]]),
  value: jsonValue
});

const validateOnlyArg = z
  .boolean()
  .optional()
  .describe("Only validate the new template, without publishing it (default false)");

export function registerFirebaseTools(server: McpServer, env: Env) {
  const firestoreUrl = (projectId: string | undefined, path = "") =>
    `${FIRESTORE_BASE}/${documentsRoot(env, projectId)}${path ? `/${path}` : ""}`;

  server.registerTool(
    "firestore_list_collections",
    {
      description:
        "Lists the root collections of the Firestore database, or the subcollections of one document.",
      inputSchema: {
        documentPath: z
          .string()
          .optional()
          .describe('Parent document, e.g. "users/alice" (omit for root collections)'),
        pageSize: z.number().int().min(1).max(500).optional(),
        pageToken: z.string().optional(),
        projectId: projectIdArg
      }
    },
    guard(async ({ documentPath: parent, pageSize, pageToken, projectId }) => {
      const url = firestoreUrl(projectId, parent ? documentPath(parent) : "");
      const { data } = await firebaseFetch(env, `${url}:listCollectionIds`, {
        method: "POST",
        body: { pageSize: pageSize ?? 100, pageToken }
      });
      return ok(data ?? {});
    })
  );

  server.registerTool(
    "firestore_list_documents",
    {
      description: "Lists the documents of a collection, as plain JSON.",
      inputSchema: {
        collection: z.string().describe('Collection path, e.g. "users" or "users/alice/orders"'),
        pageSize: z.number().int().min(1).max(300).optional().describe("Default 20"),
        pageToken: z.string().optional(),
        orderBy: z.string().optional().describe('e.g. "createdAt desc"'),
        fields: z.array(z.string()).optional().describe("Only return these field paths"),
        projectId: projectIdArg
      }
    },
    guard(async ({ collection, pageSize, pageToken, orderBy, fields, projectId }) => {
      const { data } = await firebaseFetch(env, firestoreUrl(projectId, collectionPath(collection)), {
        query: {
          pageSize: pageSize ?? 20,
          pageToken,
          orderBy,
          "mask.fieldPaths": fields?.map(fieldPath)
        }
      });
      const page = data as { documents?: FirestoreDocument[]; nextPageToken?: string };
      return ok({
        documents: (page.documents ?? []).map(fromFirestoreDocument),
        nextPageToken: page.nextPageToken
      });
    })
  );

  server.registerTool(
    "firestore_get_document",
    {
      description: "Reads one Firestore document, as plain JSON.",
      inputSchema: {
        path: z.string().describe('Document path, e.g. "users/alice"'),
        fields: z.array(z.string()).optional().describe("Only return these field paths"),
        projectId: projectIdArg
      }
    },
    guard(async ({ path, fields, projectId }) => {
      const { data } = await firebaseFetch(env, firestoreUrl(projectId, documentPath(path)), {
        query: { "mask.fieldPaths": fields?.map(fieldPath) }
      });
      return ok(fromFirestoreDocument(data as FirestoreDocument));
    })
  );

  server.registerTool(
    "firestore_query",
    {
      description:
        "Queries a collection (or a collection group) with AND-ed filters, ordering and a limit.",
      inputSchema: {
        collection: z
          .string()
          .describe('Collection path, e.g. "orders" or "users/alice/orders"; with allDescendants, just the collection ID'),
        allDescendants: z
          .boolean()
          .optional()
          .describe("Query every collection with this ID (collection group query)"),
        filters: z.array(filterArg).optional().describe("Combined with AND"),
        orderBy: z
          .array(
            z.object({
              field: z.string(),
              direction: z.enum(["asc", "desc"]).optional()
            })
          )
          .optional(),
        limit: z.number().int().min(1).max(1000).optional().describe("Default 50"),
        fields: z.array(z.string()).optional().describe("Only return these field paths"),
        projectId: projectIdArg
      }
    },
    guard(async ({ collection, allDescendants, filters, orderBy, limit, fields, projectId }) => {
      const root = documentsRoot(env, projectId);
      const parts = collectionPath(collection).split("/");
      const collectionId = decodeURIComponent(parts.pop()!);
      const parent = parts.join("/");

      const { data } = await firebaseFetch(
        env,
        `${firestoreUrl(projectId, parent)}:runQuery`,
        {
          method: "POST",
          body: {
            structuredQuery: {
              select: fields ? { fields: fields.map((f) => ({ fieldPath: fieldPath(f) })) } : undefined,
              from: [{ collectionId, allDescendants: allDescendants ?? false }],
              where: buildWhere(filters as Filter[] | undefined, root),
              orderBy: orderBy?.map((order) => ({
                field: { fieldPath: fieldPath(order.field) },
                direction: order.direction === "desc" ? "DESCENDING" : "ASCENDING"
              })),
              limit: limit ?? 50
            }
          }
        }
      );
      const rows = (data as Array<{ document?: FirestoreDocument }>) ?? [];
      return ok(
        rows.filter((row) => row.document).map((row) => fromFirestoreDocument(row.document!))
      );
    })
  );

  server.registerTool(
    "firestore_create_document",
    {
      description:
        "Creates a Firestore document. Fails if the ID is taken. Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        collection: z.string().describe('Collection path, e.g. "users"'),
        documentId: z.string().optional().describe("Omit for an auto-generated ID"),
        data: z.record(z.string(), z.unknown()).describe("Document fields as plain JSON"),
        projectId: projectIdArg
      }
    },
    guard(async ({ collection, documentId, data, projectId }) => {
      assertWrites(env);
      const root = documentsRoot(env, projectId);
      const result = await firebaseFetch(env, firestoreUrl(projectId, collectionPath(collection)), {
        method: "POST",
        query: { documentId },
        body: { fields: toFirestoreFields(data, root) }
      });
      return ok(fromFirestoreDocument(result.data as FirestoreDocument));
    })
  );

  server.registerTool(
    "firestore_update_document",
    {
      description:
        "Updates a Firestore document. By default merges: only the top-level fields you send are replaced. Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        path: z.string().describe('Document path, e.g. "users/alice"'),
        data: z.record(z.string(), z.unknown()).describe("Fields to write, as plain JSON"),
        merge: z
          .boolean()
          .optional()
          .describe("true (default): touch only the given fields; false: replace the whole document"),
        mustExist: z
          .boolean()
          .optional()
          .describe("Fail instead of creating the document when it does not exist"),
        projectId: projectIdArg
      }
    },
    guard(async ({ path, data, merge, mustExist, projectId }) => {
      assertWrites(env);
      const root = documentsRoot(env, projectId);
      const result = await firebaseFetch(env, firestoreUrl(projectId, documentPath(path)), {
        method: "PATCH",
        query: {
          "updateMask.fieldPaths":
            merge === false ? undefined : Object.keys(data).map(quoteSegment),
          "currentDocument.exists": mustExist ? "true" : undefined
        },
        body: { fields: toFirestoreFields(data, root) }
      });
      return ok(fromFirestoreDocument(result.data as FirestoreDocument));
    })
  );

  server.registerTool(
    "firestore_delete_document",
    {
      description:
        "Deletes a Firestore document (its subcollections are kept). Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        path: z.string().describe('Document path, e.g. "users/alice"'),
        mustExist: z.boolean().optional().describe("Fail when the document does not exist"),
        projectId: projectIdArg
      }
    },
    guard(async ({ path, mustExist, projectId }) => {
      assertWrites(env);
      await firebaseFetch(env, firestoreUrl(projectId, documentPath(path)), {
        method: "DELETE",
        query: { "currentDocument.exists": mustExist ? "true" : undefined }
      });
      return ok({ deleted: path });
    })
  );

  server.registerTool(
    "remote_config_get",
    {
      description:
        "Reads the Remote Config template (parameters, groups, conditions) with its ETag.",
      inputSchema: {
        versionNumber: z.string().optional().describe("A past version (default: the live one)"),
        projectId: projectIdArg
      }
    },
    guard(async ({ versionNumber, projectId }) => {
      const { data, etag } = await firebaseFetch(env, remoteConfigUrl(env, projectId), {
        query: { versionNumber }
      });
      return ok({ etag, template: data });
    })
  );

  server.registerTool(
    "remote_config_list_versions",
    {
      description: "Lists published Remote Config versions, newest first.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(300).optional().describe("Default 10"),
        pageToken: z.string().optional(),
        projectId: projectIdArg
      }
    },
    guard(async ({ pageSize, pageToken, projectId }) => {
      const { data } = await firebaseFetch(env, remoteConfigUrl(env, projectId, ":listVersions"), {
        query: { pageSize: pageSize ?? 10, pageToken }
      });
      return ok(data);
    })
  );

  server.registerTool(
    "remote_config_set_parameter",
    {
      description:
        "Creates or updates one Remote Config parameter and publishes the template (edited in place if it lives in a group). Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        key: z.string().describe("Parameter key"),
        defaultValue: z.string().optional().describe("Default value, as a string"),
        useInAppDefault: z
          .boolean()
          .optional()
          .describe("Use the app's in-app default instead of a default value"),
        conditionalValues: z
          .record(z.string(), z.string())
          .optional()
          .describe("Condition name → value; replaces the existing conditional values"),
        valueType: z.enum(["STRING", "BOOLEAN", "NUMBER", "JSON"]).optional(),
        description: z.string().optional(),
        group: z
          .string()
          .optional()
          .describe("Parameter group for a NEW parameter (existing ones stay where they are)"),
        versionDescription: z.string().optional().describe("Description of the published version"),
        validateOnly: validateOnlyArg,
        projectId: projectIdArg
      }
    },
    guard(async (args) => {
      assertWrites(env);
      const { template, etag } = await readTemplate(env, args.projectId);

      let home = parameterHome(template, args.key);
      if (!home) {
        if (args.group) {
          template.parameterGroups ??= {};
          template.parameterGroups[args.group] ??= {};
          home = template.parameterGroups[args.group].parameters ??= {};
        } else {
          home = template.parameters ??= {};
        }
      }

      const parameter: RemoteConfigParameter = { ...(home[args.key] ?? {}) };
      if (args.useInAppDefault) parameter.defaultValue = { useInAppDefault: true };
      else if (args.defaultValue !== undefined) parameter.defaultValue = { value: args.defaultValue };
      if (args.conditionalValues) {
        parameter.conditionalValues = Object.fromEntries(
          Object.entries(args.conditionalValues).map(([condition, value]) => [condition, { value }])
        );
      }
      if (args.valueType) parameter.valueType = args.valueType;
      if (args.description !== undefined) parameter.description = args.description;
      if (!parameter.defaultValue && !parameter.conditionalValues) {
        throw new Error(`Parameter "${args.key}" needs a defaultValue (or useInAppDefault).`);
      }
      home[args.key] = parameter;

      return ok({
        key: args.key,
        parameter,
        ...(await publishTemplate(
          env,
          args.projectId,
          template,
          etag,
          args.validateOnly ?? false,
          args.versionDescription
        ))
      });
    })
  );

  server.registerTool(
    "remote_config_delete_parameter",
    {
      description:
        "Removes one Remote Config parameter (wherever it lives) and publishes the template. Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        key: z.string().describe("Parameter key"),
        versionDescription: z.string().optional().describe("Description of the published version"),
        validateOnly: validateOnlyArg,
        projectId: projectIdArg
      }
    },
    guard(async ({ key, versionDescription, validateOnly, projectId }) => {
      assertWrites(env);
      const { template, etag } = await readTemplate(env, projectId);
      const home = parameterHome(template, key);
      if (!home) throw new Error(`Parameter "${key}" does not exist.`);
      delete home[key];
      return ok({
        deleted: key,
        ...(await publishTemplate(env, projectId, template, etag, validateOnly ?? false, versionDescription))
      });
    })
  );

  server.registerTool(
    "remote_config_rollback",
    {
      description:
        "Publishes a past Remote Config version again, as a new version. Requires FIREBASE_ALLOW_WRITES.",
      inputSchema: {
        versionNumber: z.string().describe("Version to roll back to (see remote_config_list_versions)"),
        projectId: projectIdArg
      }
    },
    guard(async ({ versionNumber, projectId }) => {
      assertWrites(env);
      const { data, etag } = await firebaseFetch(env, remoteConfigUrl(env, projectId, ":rollback"), {
        method: "POST",
        body: { versionNumber }
      });
      return ok({ etag, version: (data as RemoteConfigTemplate | null)?.version });
    })
  );
}
