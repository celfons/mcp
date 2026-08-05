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
/**
 * Um caminho de REPETIÇÃO: `produtos[].nome` — todos os itens da lista, não um
 * índice escolhido a dedo.
 *
 * Sem isto, uma ferramenta de BUSCA volta praticamente vazia: a resposta é
 * `{ produtos: [ … ] }` e a projeção só sabia ler folha escalar, então quem
 * cadastrasse teria de declarar `produtos[0].nome`, `produtos[1].nome`, um
 * índice por vez — e a lista some inteira quando o cliente devolve mais itens do
 * que alguém teve paciência de declarar.
 *
 * É o que permite o agente SUGERIR a partir do catálogo do cliente: o bloco
 * chega como texto no prompt e o modelo escolhe entre o que veio.
 */
const REPEAT_RE = /^(.*?)\[\]\.?(.*)$/;

/** Quantos itens de uma lista entram, no máximo. O teto de caracteres corta antes disso. */
const MAX_REPEAT_ITEMS = 30;

type ParsedRepeat = { listPath: string; leafPath: string } | null;

export function parseRepeatPath(path: string): ParsedRepeat {
  const match = REPEAT_RE.exec(path);
  if (!match) return null;
  return { listPath: match[1], leafPath: match[2] };
}

/**
 * Projeta a resposta em texto, respeitando o teto de caracteres.
 *
 * Corta em LINHA inteira, nunca no meio de um valor: meio preço ("R$ 1.2") é
 * pior do que preço nenhum, porque o modelo o repetiria como se fosse o valor.
 *
 * Campos de repetição são agrupados POR ITEM, não por campo — `Nome: X · Preço: Y`
 * numa linha por produto. Listar todos os nomes e depois todos os preços daria
 * ao modelo a chance de parear errado, e um preço colado no produto errado é a
 * pior saída possível deste módulo.
 */
export function project(payload: unknown, fields: readonly Field[], maxChars: number): ProjectionResult {
  const lines: string[] = [];
  const missing: string[] = [];
  let used = 0;
  let truncated = false;

  const push = (line: string): boolean => {
    const cost = line.length + (lines.length ? 1 : 0);
    if (used + cost > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    used += cost;
    return true;
  };

  // Os campos de repetição de uma MESMA lista viram uma linha por item; os
  // escalares seguem uma linha cada, na ordem declarada.
  const repeatGroups = new Map<string, Field[]>();
  for (const field of fields) {
    const repeat = parseRepeatPath(field.path);
    if (repeat) {
      const group = repeatGroups.get(repeat.listPath);
      if (group) group.push(field);
      else repeatGroups.set(repeat.listPath, [field]);
    }
  }

  const doneGroups = new Set<string>();

  for (const field of fields) {
    const repeat = parseRepeatPath(field.path);

    if (!repeat) {
      const value = formatValue(readPath(payload, field.path));
      if (value === null) {
        missing.push(field.path);
        continue;
      }
      if (!push(`${field.label}: ${value}`)) break;
      continue;
    }

    // A lista inteira é emitida na posição do PRIMEIRO campo dela; os demais
    // campos do mesmo grupo já foram consumidos aqui.
    if (doneGroups.has(repeat.listPath)) continue;
    doneGroups.add(repeat.listPath);

    const list = readPath(payload, repeat.listPath);
    if (!Array.isArray(list) || !list.length) {
      missing.push(field.path);
      continue;
    }

    const group = repeatGroups.get(repeat.listPath) ?? [field];
    let emitted = 0;
    for (const entry of list.slice(0, MAX_REPEAT_ITEMS)) {
      const parts: string[] = [];
      for (const member of group) {
        const leaf = parseRepeatPath(member.path)?.leafPath ?? "";
        const value = formatValue(leaf ? readPath(entry, leaf) : entry);
        if (value !== null) parts.push(`${member.label}: ${value}`);
      }
      // Item sem nenhum campo legível é pulado — uma linha vazia gastaria o teto
      // para dizer nada.
      if (!parts.length) continue;
      if (!push(parts.join(" · "))) break;
      emitted += 1;
    }
    if (!emitted) missing.push(field.path);
    if (truncated) break;
  }

  return { text: lines.join("\n"), missing, truncated };
}
