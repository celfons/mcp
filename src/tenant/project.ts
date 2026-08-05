import type { FieldSchema } from "./manifest";
import type { z } from "zod";

type Field = z.infer<typeof FieldSchema>;

/**
 * A PROJEÇÃO: o que da resposta do cliente pode chegar ao prompt do agente.
 *
 * Devolver o JSON cru seria mais simples e é errado por dois motivos, e o
 * segundo é o que importa. O primeiro: o bloco `<external_data>` cabe em ~2000
 * caracteres, e chaves, aspas e aninhamento comem esse teto para dizer pouco. O
 * segundo: a resposta de um ERP costuma trazer, no mesmo objeto, o que o cliente
 * queria expor e o que ele não pensou que estava expondo — custo, margem,
 * comissão, dado de outro comprador. Uma lista declarada de campos torna isso
 * uma decisão de quem cadastrou, e não um efeito de como a API dele foi
 * modelada.
 *
 * A saída é `Rótulo: valor`, uma por linha. É o formato que o modelo lê melhor e
 * o que mais aproveita o teto.
 */

/** Lê `a.b[0].c` num objeto desconhecido. Devolve `undefined` no primeiro passo que falhar. */
export function readPath(source: unknown, path: string): unknown {
  const steps = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);

  let current: unknown = source;
  for (const step of steps) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(step);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

/**
 * Formata um valor de folha. Objeto e array NÃO são serializados: se o campo
 * declarado aponta para uma estrutura, quem cadastrou apontou para o lugar
 * errado, e despejar o JSON dela é justamente o que a projeção existe para
 * impedir. Aparece como ausente, e o cadastro se corrige.
 */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export type ProjectionResult = {
  text: string;
  /** Campos declarados que não vieram na resposta — útil no log do gateway. */
  missing: string[];
  truncated: boolean;
};

/**
 * Projeta a resposta em texto, respeitando o teto de caracteres.
 *
 * Corta em LINHA inteira, nunca no meio de um valor: meio preço ("R$ 1.2") é
 * pior do que preço nenhum, porque o modelo o repetiria como se fosse o valor.
 */
export function project(payload: unknown, fields: readonly Field[], maxChars: number): ProjectionResult {
  const lines: string[] = [];
  const missing: string[] = [];
  let used = 0;
  let truncated = false;

  for (const field of fields) {
    const value = formatValue(readPath(payload, field.path));
    if (value === null) {
      missing.push(field.path);
      continue;
    }
    const line = `${field.label}: ${value}`;
    const cost = line.length + (lines.length ? 1 : 0);
    if (used + cost > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += cost;
  }

  return { text: lines.join("\n"), missing, truncated };
}
