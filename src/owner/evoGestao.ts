import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, ok, type ToolResult } from "../social/shared";
import { OutboundError, safeFetch } from "../tenant/safeUrl";
import { EVO_BASE_URL, evoPresetInputFromManifest } from "../tenant/presets/evo";
import type { TenantManifest } from "../tenant/manifest";

/**
 * As consultas de GESTÃO da EVO, para o DONO da academia (rota `/mcp/gestao`).
 *
 * Duas diferenças deliberadas em relação ao gateway do agente de WhatsApp:
 *
 * 1. **Agregam aqui, não projetam.** A projeção do gateway corta em 30 itens e
 *    ~1800 caracteres, que é o que cabe num turno de conversa. Um dashboard
 *    precisa de TODAS as vendas do mês: estas ferramentas paginam a EVO e
 *    devolvem totais por dia, plano e canal.
 * 2. **Nenhum dado pessoal sai.** Nome, CPF, telefone e e-mail de aluno são
 *    lidos só para contar; o que volta é número. Nome de FUNCIONÁRIO (vendedor)
 *    pode sair: é dado de gestão da própria academia.
 *
 * Rotas e filtros conferidos no swagger da EVO (`/swagger/v1/swagger.json`,
 * 18/11/2026). Só GET: nenhuma consulta daqui altera nada na EVO.
 */

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const HOP_TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RANGE_DAYS = 366;
const TOP = 25;

export type EvoAccess = { authorization: string; idBranch?: number };

/** A credencial e a unidade da EVO desta academia, tiradas do manifesto do preset. */
export function evoAccessFromManifest(manifest: TenantManifest): EvoAccess | null {
  const recovered = evoPresetInputFromManifest(manifest);
  if (!recovered.ok) return null;
  return { authorization: recovered.input.authorization, idBranch: recovered.input.idBranch };
}

type Period = { start: string; end: string };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Período pedido; padrão = últimos 30 dias até hoje (UTC-3). */
export function resolvePeriod(input: { dataInicio?: string; dataFim?: string }, now = Date.now()): Period | string {
  const today = new Date(now - 3 * 3600_000).toISOString().slice(0, 10);
  const end = input.dataFim?.trim() || today;
  const start = input.dataInicio?.trim() || new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10);
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return "Datas no formato AAAA-MM-DD.";
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400_000;
  if (Number.isNaN(days) || days < 0) return "dataInicio deve ser anterior ou igual a dataFim.";
  if (days > MAX_RANGE_DAYS) return `Período máximo de ${MAX_RANGE_DAYS} dias.`;
  return { start, end };
}

function listOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["list", "lista", "results"]) if (Array.isArray(p[key])) return p[key] as unknown[];
  }
  return [];
}

async function evoGet(access: EvoAccess, path: string, query: Record<string, string>): Promise<unknown> {
  const params = new URLSearchParams(query);
  if (access.idBranch !== undefined) params.set("idBranch", String(access.idBranch));
  const body = await safeFetch(`${EVO_BASE_URL}${path}?${params}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: access.authorization },
    timeoutMs: HOP_TIMEOUT_MS,
    maxBytes: MAX_BYTES
  });
  return body ? JSON.parse(body) : null;
}

/** Pagina por `take/skip` até a página vir incompleta. `truncated` = bateu o teto de páginas. */
async function evoGetAll(
  access: EvoAccess,
  path: string,
  query: Record<string, string>
): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = listOf(await evoGet(access, path, { ...query, take: String(PAGE_SIZE), skip: String(page * PAGE_SIZE) }));
    for (const row of rows) if (row && typeof row === "object") items.push(row as Record<string, unknown>);
    if (rows.length < PAGE_SIZE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = "não informado"): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const day = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const round = (v: number): number => Math.round(v * 100) / 100;

type Bucket = { quantidade: number; valor: number };
function bump(map: Map<string, Bucket>, key: string, valor = 0): void {
  const b = map.get(key) ?? { quantidade: 0, valor: 0 };
  b.quantidade += 1;
  b.valor += valor;
  map.set(key, b);
}
function rank(map: Map<string, Bucket>, label: string, limit = TOP): Record<string, unknown>[] {
  return [...map.entries()]
    .sort((a, b) => b[1].quantidade - a[1].quantidade || b[1].valor - a[1].valor)
    .slice(0, limit)
    .map(([k, b]) => ({ [label]: k, quantidade: b.quantidade, valor: round(b.valor) }));
}
function byDay(map: Map<string, Bucket>): Record<string, unknown>[] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, b]) => ({ dia, quantidade: b.quantidade, valor: round(b.valor) }));
}

const AVISO_TRUNCADO = "Atenção: o período tem mais registros do que o teto de leitura; os totais estão INCOMPLETOS. Use um período menor.";

export async function vendas(access: EvoAccess, period: Period): Promise<Record<string, unknown>> {
  const { items, truncated } = await evoGetAll(access, "/api/v2/sales", {
    dateSaleStart: period.start,
    dateSaleEnd: period.end
  });
  const dias = new Map<string, Bucket>();
  const porItem = new Map<string, Bucket>();
  const porVendedor = new Map<string, Bucket>();
  let total = 0;
  let valorTotal = 0;
  let comPlano = 0;
  for (const sale of items) {
    if (sale.removed === true) continue;
    const itens = Array.isArray(sale.saleItens) ? (sale.saleItens as Record<string, unknown>[]) : [];
    const valor = itens.reduce((acc, it) => acc + num(it.saleValue), 0);
    total += 1;
    valorTotal += valor;
    if (itens.some((it) => num(it.idMembership) > 0)) comPlano += 1;
    const d = day(sale.saleDate);
    if (d) bump(dias, d, valor);
    for (const it of itens) bump(porItem, str(it.description ?? it.item), num(it.saleValue));
    bump(porVendedor, str(sale.nameEmployeeSale ?? sale.nameEmployee), valor);
  }
  return {
    periodo: period,
    vendas: total,
    vendasComPlano: comPlano,
    valorTotal: round(valorTotal),
    ticketMedio: total ? round(valorTotal / total) : 0,
    porDia: byDay(dias),
    porItem: rank(porItem, "item"),
    porVendedor: rank(porVendedor, "vendedor", 10),
    ...(truncated ? { aviso: AVISO_TRUNCADO } : {})
  };
}

export async function prospects(access: EvoAccess, period: Period): Promise<Record<string, unknown>> {
  const { items, truncated } = await evoGetAll(access, "/api/v1/prospects", {
    registerDateStart: period.start,
    registerDateEnd: period.end
  });
  const dias = new Map<string, Bucket>();
  const canais = new Map<string, Bucket>();
  const origens = new Map<string, Bucket>();
  let convertidos = 0;
  for (const p of items) {
    const convertido = num(p.idMember) > 0 || typeof p.conversionDate === "string";
    if (convertido) convertidos += 1;
    const d = day(p.registerDate);
    if (d) bump(dias, d, convertido ? 1 : 0);
    bump(canais, str(p.mktChannel), convertido ? 1 : 0);
    bump(origens, str(p.signupType), convertido ? 1 : 0);
  }
  const withRate = (rows: Record<string, unknown>[]) =>
    rows.map(({ valor, ...r }) => ({ ...r, convertidos: valor, taxaConversao: r.quantidade ? round((num(valor) / num(r.quantidade)) * 100) : 0 }));
  return {
    periodo: period,
    prospects: items.length,
    convertidos,
    taxaConversao: items.length ? round((convertidos / items.length) * 100) : 0,
    porDia: byDay(dias).map(({ valor, ...r }) => ({ ...r, convertidos: valor })),
    porCanal: withRate(rank(canais, "canal")),
    porTipoCadastro: withRate(rank(origens, "tipo")),
    observacao: "Conversão = prospect que virou aluno (idMember ou data de conversão preenchidos). O canal é o que a recepção registrou em mktChannel.",
    ...(truncated ? { aviso: AVISO_TRUNCADO } : {})
  };
}

export async function ativos(access: EvoAccess): Promise<Record<string, unknown>> {
  const rows = listOf(await evoGet(access, "/api/v2/members/active-members", {})) as Record<string, unknown>[];
  const contratos = new Map<string, Bucket>();
  const tipos = new Map<string, Bucket>();
  const alunos = new Set<number>();
  for (const r of rows) {
    if (num(r.idMember) > 0) alunos.add(num(r.idMember));
    bump(contratos, str(r.contractDescription));
    bump(tipos, str(r.contractType));
  }
  return {
    alunosAtivos: alunos.size || rows.length,
    contratosAtivos: rows.length,
    porContrato: rank(contratos, "contrato").map(({ valor: _v, ...r }) => r),
    porTipo: rank(tipos, "tipo").map(({ valor: _v, ...r }) => r)
  };
}

export async function cancelamentos(access: EvoAccess, period: Period): Promise<Record<string, unknown>> {
  const { items, truncated } = await evoGetAll(access, "/api/v3/membermembership", {
    cancelDateStart: period.start,
    cancelDateEnd: period.end
  });
  const dias = new Map<string, Bucket>();
  const motivos = new Map<string, Bucket>();
  const planos = new Map<string, Bucket>();
  let restante = 0;
  for (const c of items) {
    const d = day(c.cancelDate);
    if (d) bump(dias, d);
    bump(motivos, str(c.reasonCancellation));
    bump(planos, str(c.nameMembership), num(c.saleValue));
    restante += num(c.remainingValue);
  }
  return {
    periodo: period,
    cancelamentos: items.length,
    valorRestanteDosContratos: round(restante),
    porDia: byDay(dias).map(({ valor: _v, ...r }) => r),
    porMotivo: rank(motivos, "motivo").map(({ valor: _v, ...r }) => r),
    porPlano: rank(planos, "plano"),
    ...(truncated ? { aviso: AVISO_TRUNCADO } : {})
  };
}

export async function inadimplencia(access: EvoAccess, period: Period): Promise<Record<string, unknown>> {
  const payload = (await evoGet(access, "/api/v1/receivables/debtors", {
    dueDateStart: period.start,
    dueDateEnd: period.end,
    take: "1"
  })) as Record<string, unknown> | null;
  const summary = (payload?.summary ?? {}) as Record<string, unknown>;
  return {
    periodo: period,
    devedores: num(payload?.total),
    valorPendente: round(num(summary.pendingValue)),
    mediaPendente: round(num(summary.pendingAverage)),
    valorRecuperado: round(num(summary.recoveredValue)),
    mediaRecuperada: round(num(summary.recoveryAverage)),
    observacao: "Cobranças com vencimento no período."
  };
}

export async function entradas(access: EvoAccess, period: Period): Promise<Record<string, unknown>> {
  const { items, truncated } = await evoGetAll(access, "/api/v2/entries", {
    registerDateStart: period.start,
    registerDateEnd: period.end
  });
  const dias = new Map<string, Bucket>();
  const unicos = new Set<number>();
  let bloqueadas = 0;
  for (const e of items) {
    const d = day(e.date);
    if (d) bump(dias, d);
    if (num(e.idMember) > 0) unicos.add(num(e.idMember));
    if (typeof e.blockReason === "string" && e.blockReason.trim()) bloqueadas += 1;
  }
  return {
    periodo: period,
    entradas: items.length,
    alunosDistintos: unicos.size,
    entradasBloqueadas: bloqueadas,
    porDia: byDay(dias).map(({ valor: _v, ...r }) => r),
    ...(truncated ? { aviso: AVISO_TRUNCADO } : {})
  };
}

const PERIOD_SCHEMA = {
  dataInicio: z.string().max(10).optional().describe("Início do período, AAAA-MM-DD. Padrão: 30 dias antes de dataFim."),
  dataFim: z.string().max(10).optional().describe("Fim do período, AAAA-MM-DD. Padrão: hoje.")
};

async function run(work: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    return ok(await work());
  } catch (error) {
    // Nunca o corpo do erro da EVO: ele pode trazer dado de aluno.
    if (error instanceof OutboundError) {
      if (error.status === 401) return fail("A EVO recusou a credencial desta academia (401). Confira DNS e Secret Key.");
      if (error.status === 403) return fail("O token da EVO desta academia não tem permissão para esta consulta (403). Peça a liberação à W12.");
      return fail(`Falha ao consultar a EVO: ${error.message}`);
    }
    return fail("Falha ao processar a resposta da EVO.");
  }
}

export function registerEvoGestaoTools(server: McpServer, access: EvoAccess): void {
  const withPeriod =
    (fn: (a: EvoAccess, p: Period) => Promise<Record<string, unknown>>) =>
    async (args: { dataInicio?: string; dataFim?: string }) => {
      const period = resolvePeriod(args);
      return typeof period === "string" ? fail(period) : run(() => fn(access, period));
    };

  server.registerTool(
    "evo_gestao_vendas",
    {
      description: "Vendas da academia no período: total, valor, ticket médio, por dia, por plano/item e por vendedor.",
      inputSchema: PERIOD_SCHEMA
    },
    withPeriod(vendas)
  );
  server.registerTool(
    "evo_gestao_prospects",
    {
      description: "Leads (prospects) cadastrados no período, conversão em aluno, por dia e por canal de marketing.",
      inputSchema: PERIOD_SCHEMA
    },
    withPeriod(prospects)
  );
  server.registerTool(
    "evo_gestao_ativos",
    { description: "Alunos e contratos ativos agora, por contrato e por tipo.", inputSchema: {} },
    async () => run(() => ativos(access))
  );
  server.registerTool(
    "evo_gestao_cancelamentos",
    {
      description: "Contratos cancelados no período: total, por dia, por motivo e por plano.",
      inputSchema: PERIOD_SCHEMA
    },
    withPeriod(cancelamentos)
  );
  server.registerTool(
    "evo_gestao_inadimplencia",
    {
      description: "Inadimplência das cobranças com vencimento no período: devedores e valores pendente e recuperado.",
      inputSchema: PERIOD_SCHEMA
    },
    withPeriod(inadimplencia)
  );
  server.registerTool(
    "evo_gestao_entradas",
    {
      description: "Frequência: entradas na academia no período, alunos distintos e entradas por dia.",
      inputSchema: PERIOD_SCHEMA
    },
    withPeriod(entradas)
  );
}
