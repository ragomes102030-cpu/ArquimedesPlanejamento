# Fronteira de cada especialista

## Contents
- Quando usar cada um
- Zonas de sobreposição
- Como resolver ambiguidade

## structuro-agent
**Pega:** dimensionamento e verificação de concreto armado, aço, fundação, madeira.
Cargas, seções, armaduras, ELU/ELS, memorial de cálculo.
**Não pega:** diagnóstico de fissura (é `pathoscan-agent`), custo (é `docbuild-agent`).

## topobot-agent
**Pega:** levantamento planialtimétrico, GNSS/RTK, TIN, curvas de nível, corte/aterro,
coordenadas UTM/SIRGAS, export DXF.
**Não pega:** locação de obra (é execução), custo da terraplenagem (`docbuild-agent`).

## pathoscan-agent
**Pega:** fissura, umidade, infiltração, carbonatação, corrosão, eflorescência.
Causa, classificação de risco, recomendação de reparo.
**Não pega:** verificação estrutural — **encaminha** para `structuro-agent`.

## chronos-agent
**Pega:** cronograma, CPM, caminho crítico, folga, Gantt, curva S, EPP/ALOP,
produtividade, baseline.
**Não pega:** custo isolado (`docbuild-agent`), LOB de obra repetitiva é dele também.
**Apoio:** `construction/lob-line-of-balance` para ritmo, cadência, frentes e
balanceamento; não confundir projeção de produtividade com CPM.

## docbuild-agent
**Pega:** orçamento, composição, BDI, SINAPI/SEINFRA, memorial, especificação,
caderno de encargos, laudo, análise normativa.
**Não pega:** cálculo estrutural, diagnóstico de patologia.
**Apoio:** `construction/budget-composition-service`,
`construction/cost-estimation-resource` e `sinapi-SEINFRA` para orçamento;
`eap-work-breakdown` para estruturação do escopo.

## Medições e produção
**Skill:** `construction/production-measurement-control`.
**Pega:** memória de medição, evidências quantitativas, avanço físico e validação
de boletins contra critérios contratuais.
**Não pega:** apontamento operacional diário do Kanban nem emissão automática de
RDO ou certificado assinado.

## Auditoria
**Skills:** `planejamento-obras-engenharia`, `spreadsheet-audit`,
`spreadsheet-qa` e `delivery-gate`.
**Pega:** verificação independente de estrutura, fórmulas, premissas, consistência
matemática e regressão.
**Limite:** quem produziu o artefato não pode declarar sua própria auditoria
independente como aprovada.

## Suprimentos
**Skill:** `suprimentos-obras`.
**Pega:** equalização de propostas, mapa de cotação, prazos, riscos de fornecimento
e conferência de recebimento.
**Limite:** preços precisam vir de cotações atuais ou bases identificadas; não
aprovar fornecedor nem substituição técnica sem responsável humano.

## Segurança do trabalho
**Skill:** `seguranca-obra`.
**Pega:** revisão de perigos, controles, checklists e evidências do canteiro.
**Limite:** apoio não substitui SESMT ou profissional legalmente habilitado. Risco
iminente exige interromper a atividade e acionar a liderança responsável.

## Gestão da qualidade
**Skill:** `gestao-qualidade-obras`.
**Pega:** planos de inspeção, critérios verificáveis, registros de ensaio,
recebimento e tratamento de não conformidade.
**Limite:** não aceitar serviço nem declarar conformidade sem especificação,
evidência e aprovação da pessoa responsável.

## Documentos e projetos
**Pega:** `docbuild-agent` para memoriais, especificações e cadernos;
`eap-work-breakdown` para escopo e pacotes. Projeto estrutural vai para
`structuro-agent`; levantamento vai para `topobot-agent`.
**Limite:** não afirmar que o repositório edita ou valida arquivos CAD/BIM quando
não houver ferramenta específica disponível.

## Disponibilidade de runtime
Skills instruem um fluxo; não criam um processo de agente independente. Antes de
prometer delegação, verifique o catálogo de agentes da instalação. Quando não
houver runtime próprio, use a skill como orientação no fluxo atual e identifique
o resultado como assistido por skill.

## Zonas de sobreposição

| Pedido | Vai para | Por quê |
|---|---|---|
| "quanto custa essa viga?" | `docbuild-agent` | custo, não dimensionamento |
| "a fissura é estrutural?" | `pathoscan-agent` → `structuro-agent` | diagnóstico primeiro |
| "orça e agenda a obra" | **sequencial**: `docbuild` → `chronos` | cronograma depende do quantitativo |
| "calcula o corte e orça" | **sequencial**: `topobot` → `docbuild` | volume antes do preço |
| "a laje aguenta a nova carga?" | `structuro-agent` | verificação de capacidade |

## Como resolver ambiguidade

Se a pergunta cai em duas disciplinas **com dependência**, sequencie.
Se cai em duas **sem dependência**, paralelize.
Se não cai em nenhuma, diga — não force roteamento.
