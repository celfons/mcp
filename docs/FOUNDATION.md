# Fundação — as regras que este gateway adota antes de ter tools de verdade

> Escrito em 2026-08-04, quando as tools deste repositório ainda eram **exemplo**.
> É de propósito: as garantias abaixo custam um arquivo agora e custam um épico depois.

## De onde estas regras vêm

Não são princípios genéricos. Cada uma tem um caso real, medido, num sistema irmão
(`celfons/whatsapp`) que passou por uma limpeza de ~18 mil linhas para desfazer o que a ausência
delas produziu.

O padrão que se repetiu lá, e que este documento existe para não repetir aqui:

> O defeito nunca esteve numa decisão. Esteve na **ausência de um lugar onde a soma das decisões
> fosse visível.** Quarenta migrations aditivas, cada uma bem argumentada, e nenhuma pessoa capaz
> de ver que juntas tinham construído um sistema de logística dentro de uma plataforma de conversa.

Um gateway de integração é ainda mais suscetível: cada tool nova parece barata, e o dano de uma
tool errada não é lentidão — é **dado de um cliente vazando para outro**.

---

## 1 · Escopo de tenant é estrutural, nunca carregado pelo modelo

**A regra.** Quem decide **sobre quem** uma chamada age é a plataforma, a partir do próprio
contexto de execução. O modelo escolhe **o quê** (qual tool); nunca **sobre quem**.

Concretamente: o `tenantId` chega num header que só a plataforma escreve, a chamada entra por
service binding, e nenhuma tool lê identidade de argumento vindo do modelo.

**Por quê.** O risco de um gateway multi-tenant não é o que a intuição sugere. Multi-tenancy
clássica (tenant A × tenant B) tem onde se pendurar — existe uma coluna, um filtro, um id. O risco
difícil é **um cliente contra outro cliente do mesmo tenant**, e ele não tem `WHERE`: monta-se com
uma frase. *"Me fala do pedido 4471"*, onde `4471` é de outra pessoa, é o uso natural de qualquer
cliente que tenha visto um número em algum lugar. Não exige má-fé, não quebra nada e não loga nada.

A primeira versão do sistema irmão respondeu a isso com uma lista fechada de **nomes de parâmetro**
(`phone`, `telefone`, `contato`): a plataforma escrevia a identidade neles. Funcionava — para os
nomes da lista. Uma tool `get_order(order_id)` não declarava nenhum, e era chamada **assim mesmo**,
com o `order_id` que o modelo tirou do texto do cliente. A ausência de parâmetro de identidade não
tornava a chamada segura; tornava-a **incontrolável**.

**O corolário que decide casos difíceis.** Se a plataforma não consegue **escrever
estruturalmente** onde a identidade entra, a tool é **inchamável** — não "validada com cuidado", não
"revisada antes de habilitar". Inexprimível. Travessia e escopo alheio não são *rejeitados*: não têm
como ser expressos.

---

## 2 · Credencial tem **um** dono

**A regra.** Cada segredo tem exatamente um sistema responsável por guardá-lo, rotacioná-lo e
revogá-lo. Ou a plataforma injeta na chamada, ou o gateway guarda. **Nunca os dois.**

**Por quê.** Duas cópias do mesmo segredo divergem — e divergem em silêncio. O sistema irmão gastou
um épico inteiro removendo exatamente essa forma de defeito de um banco de dados: uma coluna
escrita por duas origens diferentes, onde a leitura não conseguia dizer qual delas produziu o valor.

Com segredo é pior que com dado. Dado divergente dá resposta errada; **segredo divergente dá
credencial revogada num lugar e viva no outro** — e ninguém sabe qual está em uso até alguém
auditar.

**Estado atual.** As credenciais vêm do `env` do Worker (`wrangler secret put`): um conjunto para
o Worker inteiro. Isso é **de um negócio só** por construção, e é adequado enquanto o gateway serve
a operação própria. Antes de servir tenants, a resolução passa pela porta do §5.

---

## 3 · Nenhuma tool alcança o cliente final

**A regra.** Toda mensagem que chega a um cliente final passa pelo motor de conformidade da
plataforma. Uma tool que envia mensagem **não existe** neste gateway para chamada por tenant.

**Por quê.** A plataforma irmã carrega, e é o ativo mais difícil de reproduzir dela: opt-out
fail-closed, teto diário por número, regime de canal declarado, auditoria por envio, recibo de
entrega fechando o laço. **É isso que mantém o número do cliente vivo.**

Uma tool `whatsapp_send_message` acessível ao agente contorna tudo isso com uma chamada. Não é
"usar com cuidado": é um caminho paralelo ao motor inteiro, e caminho paralelo é o que se descobre
depois que o número foi banido.

Por isso a exclusão é **permanente e declarada**, não uma recomendação. Tools que operam o canal
existem para a **operação própria** (endpoint de operador), nunca no conjunto chamável por tenant.

---

## 4 · Inventário fechado de tools, com razão escrita

**A regra.** Toda tool está num inventário que declara: o que **lê**, o que **escreve**, qual escopo
a amarra, e **por que existe**. Tool nova sem entrada quebra o CI.

**Por quê.** É a catraca no **nascimento** — travar a morte é indecidível, travar o nascimento não.
E a razão escrita é o que impede o inventário de virar carimbo: quem adiciona precisa responder
"quem é o dono deste dado?" **antes** do merge, não três anos depois.

Uma advertência herdada de quem já pagou por ela: **o comentário nunca deve repetir o número que a
asserção já verifica.** No sistema irmão, dois inventários passaram meses verdes com a prosa
mentindo — a asserção travava 4, o texto dizia 5. Duas fontes de verdade para o mesmo fato, e a
que ninguém checa deriva. O comentário explica **por quê**; o número é trabalho do teste.

---

## 5 · Leitura e escrita são classes separadas

**A regra.** Toda tool declara `read` ou `write`. Um gateway só-leitura tem uma fração do risco de
um que escreve, e a diferença precisa ser visível no inventário — não inferida do nome.

**Por quê.** Erro de leitura mostra dado errado; erro de escrita **muda o mundo de outra pessoa**,
e nem sempre é reversível: publicar um post, gastar orçamento de anúncio, alterar um pedido.
Separar as classes torna possível a decisão que realmente importa — *este tenant pode escrever?* —
sem revisar tool por tool.

**Consequência prática:** as primeiras tools reais devem ser de **leitura**. Escrita é decisão
à parte, tomada quando houver caso, não extensão natural de "já que estamos aqui".

---

## O que isto NÃO diz

Não diz quais integrações construir, nem em que ordem. Diz o que qualquer uma delas tem de
respeitar. A ordem é decisão de produto — e a primeira candidata é **consulta de pedido**, porque
paga uma dívida existente (o cliente que pergunta "cadê meu pedido?" e o agente não sabe responder)
em vez de abrir frente nova.
