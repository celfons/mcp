/**
 * De onde vem a CREDENCIAL de uma chamada — a porta, com uma implementação.
 *
 * REGRA DA FUNDAÇÃO §2: cada segredo tem UM dono. Ou a plataforma injeta, ou o
 * gateway guarda; nunca os dois. Duas cópias divergem em silêncio, e segredo
 * divergente é pior que dado divergente — fica revogado num lugar e vivo no
 * outro, e ninguém sabe qual está em uso até auditar.
 *
 * HOJE existe UMA implementação: `fleetCredentials`, que devolve o `env` do
 * Worker como está. Isso é honesto sobre o que o gateway é neste momento — um
 * conjunto de credenciais para o Worker inteiro, ou seja, de UM negócio só. Ele
 * serve a operação própria e não serve tenants.
 *
 * POR QUE A PORTA EXISTE ANTES DO SEGUNDO CASO. Normalmente abstrair com um
 * implementador só é especulação, e este repositório deveria recusar. A exceção
 * aqui é deliberada e estreita: a porta não existe para "prever o futuro", existe
 * para que as tools **parem de ler `env` diretamente hoje**. Enquanto elas leem,
 * cada tool nova é mais um lugar que precisará ser reescrito quando a credencial
 * virar por tenant — e o custo dessa reescrita cresce com o número de tools, que
 * é exatamente o que vai crescer. A porta congela a assinatura agora, com zero
 * mudança de comportamento.
 *
 * O QUE ELA DELIBERADAMENTE NÃO FAZ: não decide política, não valida escopo, não
 * conhece tenant além do id opaco. Amarrar escopo é trabalho de quem registra a
 * tool (`toolInventory.ts`), e misturar as duas coisas aqui produziria o
 * "isolamento por validação em call-site" que a fundação recusa no §1.
 */

import type { CallerKind } from "./auth";

/**
 * O ambiente que uma tool enxerga. É o `Env` do Worker — de propósito: as tools
 * existentes continuam com a assinatura `(server, env)` e nenhum arquivo de tool
 * muda quando a resolução deixar de ser de frota.
 */
export type ToolEnv = Env;

export interface CallScope {
  readonly caller: CallerKind;
  /** `null` para operador (opera a conta própria) — ver `auth.ts`. */
  readonly tenantId: string | null;
}

/**
 * Resolve as credenciais visíveis nesta chamada.
 *
 * Retorna `null` quando não há credencial aplicável — e `null` NÃO é "chama com
 * o que tiver": é "este chamador não tem dado externo neste turno", que o
 * chamador já sabe tratar respondendo como respondia antes de a integração
 * existir. Fail-closed (P-7 do sistema irmão).
 */
export type CredentialResolver = (env: Env, scope: CallScope) => ToolEnv | null;

/**
 * Resolução de FROTA: um conjunto de credenciais para o Worker inteiro, vindo de
 * `wrangler secret put`.
 *
 * Serve o operador. **Não serve tenant**, e a recusa abaixo é o ponto mais
 * importante deste arquivo: devolver o `env` de frota para uma chamada com
 * `tenantId` faria o agente do tenant A operar as contas de quem for dono dos
 * secrets. Não é um risco a mitigar depois — é o motivo de a checagem estar aqui
 * antes de existir qualquer tool real.
 */
export const fleetCredentials: CredentialResolver = (env, scope) => {
  if (scope.tenantId !== null) return null;
  return env;
};

/**
 * O resolvedor em uso. Trocá-lo por um que leia a linha do tenant (cifrada em
 * repouso) é a única mudança necessária para o gateway servir tenants — nenhuma
 * tool é tocada.
 */
export const resolveCredentials: CredentialResolver = fleetCredentials;
