#!/usr/bin/env node
/**
 * Gera `src/owner/evoCatalog.ts` a partir do swagger da EVO.
 *
 *   curl -sS https://evo-integracao-api.w12app.com.br/swagger/v1/swagger.json -o /tmp/evo-swagger.json
 *   node scripts/gen-evo-catalog.mjs /tmp/evo-swagger.json
 *
 * Só rotas GET entram (a gestão é só leitura). As rotas de `EXCLUDED` ficam de
 * fora inteiras: o que elas devolvem é segredo ou dado sensível por inteiro
 * (cartão, foto facial, token do gateway, link de troca de senha), e mascarar
 * campo a campo não as torna seguras.
 */
import { readFileSync, writeFileSync } from "node:fs";

const EXCLUDED = new Map([
  ["/api/v1/members/{idMember}/creditcard", "cartões de crédito do aluno"],
  ["/api/v2/accessControl/facial-photo", "foto do reconhecimento facial"],
  ["/api/v1/configuration/gateway-form-token", "token do gateway de pagamento"],
  ["/api/v2/configuration/gateway", "configuração (credenciais) do gateway de pagamento"],
  ["/api/v1/members/resetPassword", "link de troca de senha do aluno"],
  ["/api/v1/pix/qr-code", "gera cobrança PIX (efeito colateral, apesar do GET)"]
]);

const src = process.argv[2];
if (!src) {
  console.error("uso: node scripts/gen-evo-catalog.mjs <swagger.json>");
  process.exit(1);
}
const swagger = JSON.parse(readFileSync(src, "utf8"));
const schemas = swagger.components?.schemas ?? {};
const deref = (s) => (s?.$ref ? schemas[s.$ref.split("/").pop()] ?? {} : s ?? {});

const toolName = (path) =>
  ("evo_" + path.replace(/^\/api\//, "").replace(/[{}]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/_$/, "");

const clean = (text, max) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function paramType(schema) {
  const s = deref(schema);
  if (s.type === "array") {
    const item = deref(s.items);
    return { type: "array", items: item.type === "integer" || item.type === "number" ? "number" : "string" };
  }
  if (s.type === "integer") return { type: "integer" };
  if (s.type === "number") return { type: "number" };
  if (s.type === "boolean") return { type: "boolean" };
  if (Array.isArray(s.enum)) {
    return s.enum.every((v) => typeof v === "number") ? { type: "integer", enum: s.enum } : { type: "string", enum: s.enum.map(String) };
  }
  return { type: "string", ...(s.format === "date-time" || s.format === "date" ? { format: "date" } : {}) };
}

const routes = [];
const skipped = [];
for (const [path, ops] of Object.entries(swagger.paths ?? {})) {
  const op = ops.get;
  if (!op) continue;
  if (EXCLUDED.has(path)) {
    skipped.push(`${path} — ${EXCLUDED.get(path)}`);
    continue;
  }
  const params = [...(ops.parameters ?? []), ...(op.parameters ?? [])]
    .map((p) => (p.$ref ? deref(p) : p))
    .filter((p) => p.in === "query" || p.in === "path")
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.in === "path" || p.required === true,
      description: clean(p.description, 200),
      ...paramType(p.schema)
    }));
  routes.push({
    tool: toolName(path),
    path,
    summary: clean(op.summary || op.description || path, 300),
    tag: (op.tags ?? [])[0] ?? "",
    params
  });
}
routes.sort((a, b) => a.tool.localeCompare(b.tool));

const names = new Set();
for (const r of routes) {
  if (r.tool.length > 64) throw new Error(`nome longo demais: ${r.tool}`);
  if (names.has(r.tool)) throw new Error(`nome duplicado: ${r.tool}`);
  names.add(r.tool);
}

const out = `// GERADO por scripts/gen-evo-catalog.mjs a partir do swagger da EVO
// (${swagger.info?.title ?? "EVO API"} ${swagger.info?.version ?? ""}). Não edite à mão: rode o script.
//
// Rotas GET fora do catálogo, de propósito:
${skipped.map((s) => `//   - ${s}`).join("\n")}

export type EvoParam = {
  name: string;
  in: "query" | "path";
  required: boolean;
  description: string;
  type: "string" | "integer" | "number" | "boolean" | "array";
  items?: "string" | "number";
  enum?: readonly (string | number)[];
  format?: "date";
};

export type EvoRoute = { tool: string; path: string; summary: string; tag: string; params: readonly EvoParam[] };

export const EVO_ROUTES: readonly EvoRoute[] = ${JSON.stringify(routes, null, 2)};
`;
writeFileSync(new URL("../src/owner/evoCatalog.ts", import.meta.url), out);
console.log(`${routes.length} rotas GET no catálogo; ${skipped.length} excluídas.`);
