# Prisma XML

Visualizador e analisador de XML que roda inteiramente no navegador. Abre
vários arquivos, navega a estrutura, filtra registros, totaliza qualquer campo
numérico e compara duas versões lado a lado. Nenhum byte sai da máquina.

```bash
npm install
npm run dev      # http://localhost:5173
npm run smoke    # confere parser, totais, filtros e diff nos XMLs de samples/

# Diagnóstico de um arquivo real, sem abrir o navegador:
npx tsx scripts/diagnose.ts "D:\caminho\ARQUIVO.XML"
```

`diagnose.ts` mostra o que cada camada enxerga — parser, esquema, campos,
candidatos a tabela, perfis de caminho — e é a forma rápida de descobrir em
qual delas um arquivo específico deixa de funcionar.

Há dois arquivos de exemplo em `samples/` (uma NF-e e uma revisão dela, com
item removido, item novo, valores e atributos alterados).

## Bibliotecas

| Pacote | Papel | Por quê |
| --- | --- | --- |
| `fast-xml-parser` | XML → JS | Em modo `preserveOrder` devolve arrays, preservando ordem do documento e tags repetidas. Um parser que devolve objeto perde os itens repetidos de uma nota fiscal. |
| `@tanstack/react-virtual` | Virtualização | Árvore, tabela e diff renderizam só a janela visível. É o que separa 200 mil nós de um travamento. |
| `@tanstack/react-table` | Modelo da tabela | Ordenação e modelo de colunas para colunas descobertas em runtime. |
| `zustand` | Estado | Uma store, sem provider e sem boilerplate; documentos, filtros e seleção em um lugar só. |
| `tailwindcss` v4 | Estilo | Tokens em `@theme`, tema claro/escuro por variável CSS. |
| `lucide-react` | Ícones | Traço fino, consistente no tamanho pequeno da interface. |
| `clsx` + `tailwind-merge` | Classes | Compõe classes condicionais sem conflito de utilitários. |

Não usamos `diff` nem `jsdiff`: o comparador é estrutural (ver abaixo).
Comparar XML como texto reporta reindentação como mudança.

## Estrutura

```
src/
  types/xml.ts              modelo de dados (nós planos, perfis, filtros, diff)
  lib/
    cn.ts                   composição de classes
    parsePool.ts            pool de Web Workers para parsing
    xml/
      coerce.ts             texto -> número/data + formatação pt-BR
      parse.ts              XML -> documento plano + perfis de caminho
      flatten.ts            árvore -> linhas visíveis; serialização de volta
      search.ts             busca global e fatiamento para realce
      schema.ts             detecção de esquema embutido (DATAPACKET)
      fields.ts             índice único de campos (atributos + tags)
      filters.ts            filtros por nome de campo
      edits.ts              overlay de edições e documento efetivo
      serialize.ts          documento -> string XML indentada + download
      stats.ts              soma/média/mín/máx/contagem e agrupamento
      table.ts              nós repetidos -> tabela dinâmica + CSV
      diff.ts               comparação estrutural entre dois documentos
  workers/parse.worker.ts   parsing fora da thread principal
  store/useWorkspace.ts     estado da aplicação
  hooks/
    useXmlAnalysis.ts       busca+filtros, agregação, tabela e diff memoizados
    useDebounced.ts         atraso da busca
    useTheme.ts             tema claro/escuro
  components/
    layout/                 lista de documentos, inspetor de nó
    upload/DropZone.tsx     soltar arquivo na janela inteira + seletor
    tree/TreeView.tsx       árvore virtualizada
    table/NodeTable.tsx     tabela dinâmica virtualizada
    diff/DiffView.tsx       comparador lado a lado / em linha
    metrics/MetricsPanel.tsx  cards de totais e quebra por chave
    filters/FilterPanel.tsx   construtor de filtros
    ui/                     controles, realce, régua de profundidade
  App.tsx                   shell de três painéis
```

## Decisões que valem o comentário

**A árvore é um array plano.** Cada nó guarda `parent`, `children` e `path`, e é
referenciado por índice. Isso permite virtualizar, filtrar e agregar em O(n) sem
recursão, e transferir o documento do worker por structured clone sem custo de
ponteiro.

**Perfis de caminho.** O parser monta, na mesma passagem, um perfil por caminho:
quantas ocorrências, quantas numéricas, quantas de data, mínimo, máximo,
atributos vistos e se a tag se repete sob o mesmo pai. É daí que saem, sem
nenhuma configuração, a lista de campos totalizáveis e a lista de tabelas
candidatas.

**Conversão conservadora.** `1.234,56` e `1234.56` viram número; `R$ 1.234,56
(à vista)` não. Um total silenciosamente errado é pior que nenhum total — o
painel mostra quantos valores ficaram de fora.

Zero à esquerda **sem parte decimal** é identificador, não medida: NCM
`09012100`, CST `00`, CEP `01402000`, matrícula `0000000629` ficam como texto.
Com parte decimal é medida: exportações de ERP alinham dinheiro à direita com
zeros, e `00000000003675.13` é R$ 3.675,13. É o separador decimal que separa os
dois casos — olhar só o zero inicial jogaria uma folha de pagamento inteira
fora da totalização.

**Esquema embutido é lido quando existe.** Em DATAPACKET/ClientDataSet, metade
da árvore é declaração, não dado: `<FIELD attrname="X" fieldtype="i4"/>` dentro
de `<METADATA>`. Sem entender isso, o índice de campos lista `attrname`,
`fieldtype`, `WIDTH` e `Version` — o vocabulário do formato — e esconde as
colunas reais no meio deles. `detectSchema` identifica o dialeto e, a partir
dele, só a subárvore `<ROWDATA>` produz campos; as colunas saem na ordem em que
o arquivo as declara, inclusive as que estão vazias em todas as linhas.

O tipo declarado **não** manda no tipo do campo. Exportação DATAPACKET real
declara dinheiro como `fieldtype="string"` o tempo todo; obedecer isso tiraria
"maior que" justamente do campo em que ele mais importa. Vale o que os valores
mostram; o tipo declarado só decide quando não há nenhum valor para observar, e
aparece no painel quando discorda da observação.

**A tabela vem do esquema, não da repetição.** Escolher a grade por "tag que
aparece mais de uma vez" erra nos dois extremos: um dataset com uma linha só não
é reconhecido, e o `<FIELD>` do bloco de metadados — que repete uma vez por
coluna — é reconhecido como se fosse dado. Com o esquema em mãos a tabela é
simplesmente o que está sob a raiz de dados, tenha uma linha ou dez mil. Sem
esquema vale a repetição, com um último recurso para caminhos com ao menos dois
campos folha, que é o que salva um documento legítimo de item único.

**Filtro é por nome de campo, não por caminho.** `buildFieldIndex` dobra os
perfis em uma lista única de nomes — todo atributo e toda tag que carrega
valor — e é ela que alimenta o primeiro dropdown. O filtro guarda só o nome
(`LCDTCE_ValorDebito`); casar percorre os nós procurando um atributo com aquele
nome ou uma tag com aquele nome. Em XML tabular isso encontra as `<ROW/>` sem
que ninguém precise saber que elas se chamam `ROW`. Quando o mesmo nome ocorre
em vários caminhos, o filtro cobre todos e o painel avisa.

**OU em dois níveis, com precedência explícita.** Dentro de um filtro, vários
valores valem como `IN` — um valor só é o caso trivial da lista, não um caminho
separado no código. Entre filtros, os do mesmo grupo se unem por OU e os grupos
se cruzam por E, então a expressão é sempre `(A OU B) E (C OU D)`. Conectores
por linha com precedência implícita seriam mais flexíveis e muito mais fáceis de
ler errado. Cada filtro é compilado uma vez antes da varredura: `equals` vira
`Set` (teste O(1) independente de quantos valores foram digitados) e os demais
guardam os termos já normalizados, em vez de repetir `toLowerCase()` por nó.

**Busca e filtro fazem coisas diferentes.** A busca realça e abre o caminho até
cada ocorrência, sem esconder nada. O filtro esconde. Cada filtro é expandido
para o fecho *ancestrais + descendentes* dos nós que casaram, então filtrar por
`vProd entre 100 e 500` deixa o item inteiro visível, não a tag solta. Filtros
diferentes se combinam pela interseção desses fechos.

**O esquema limita a edição.** Quando o arquivo declara `WIDTH`, o campo recebe
`maxLength` — o atributo nativo, que também trunca colagem — e um contador
`17/19` ao focar. Um valor que já chega do arquivo acima da largura declarada é
**sinalizado, não cortado**: truncar dado de origem por conta própria seria
perder informação sem avisar. Campos declarados sem `WIDTH` (`i4`, `dateTime`)
não ganham limite; um palpite ali seria pior que nenhum limite.

**Edição é overlay, não mutação.** As alterações vivem em
`Record<nodeId, NodeEdit>` fora do documento; `applyEdits` produz um documento
efetivo que toda a interface consome. Isso dá três coisas de graça: desfazer é
apagar uma entrada, o valor de origem está sempre disponível para o rótulo de
"alterado", e editar um valor atualiza busca, filtros, tabela e totais sem
nenhum ponto de sincronização. Gravar um valor idêntico ao original remove a
entrada, então o contador de alterações nunca mente.

O commit acontece no Enter ou na saída do campo, nunca por tecla digitada: cada
gravação recria o documento efetivo e invalida todos os memos, e fazer isso por
caractere deixaria a digitação presa atrás do recálculo.

**O diff é estrutural.** Filhos são casados por identidade — nome da tag mais o
valor de um atributo identificador (`Id`, `nItem`, `codigo`, …) quando existir,
senão a posição entre irmãos de mesmo nome. Chaves repetidas são desempatadas
por ordem de ocorrência, o que torna o pareamento uma bijeção e o algoritmo
linear. Consequência prática: reordenar um item não vira "tudo mudou", e uma
alteração de atributo é reportada no atributo.

**Tema corporativo, um matiz só, tema único.** A paleta vem do sistema de
contabilidade: verde `#339933` como marca, branco no conteúdo, `#F5F5F5` nos
trilhos laterais, `#E0E0E0` nas bordas, `#333333`/`#555555`/`#666666` na
hierarquia de texto. Todos os componentes leem variáveis CSS, então o tema
inteiro mora em `index.css`. Não há modo escuro: o visualizador acompanha o
sistema principal, e uma segunda paleta seria uma segunda coisa para manter
alinhada com ele.

Trabalhar com um matiz só exige duas compensações. A seleção usa fundo **e**
barra à esquerda, porque em uma paleta monocromática o fundo sozinho não separa
"selecionado" de "sob o cursor". E o diff diz o estado três vezes — barra
colorida, fundo tingido e glifo `+ − ~` — porque o verde da marca também é cor
de valor, e ali matiz sozinha seria ambígua.

**A régua de profundidade.** Cada nível de aninhamento desenha uma guia de 1px
em uma rampa que vai do verde da marca até o cinza secundário, ciclando a cada
6 níveis. Dá para ver onde um bloco começa e termina sem ler nenhuma tag. Os
tokens vivem em `:root`, **não** em `@theme`: o Tailwind v4 remove tokens de
tema que nenhum utilitário referencia, e estes são lidos por `style` dinâmico —
dentro de `@theme` sumiriam na build de produção.

## Limites conhecidos

- O diff detecta adição, remoção e alteração; movimentação aparece como remoção
  + adição quando o nó não tem atributo identificador.
- A tabela dinâmica mostra até 80 colunas; o excedente é informado no cabeçalho.
- A busca para em 5.000 ocorrências e sinaliza com `+` no contador.
- Namespaces são preservados no nome da tag (`ns:item`). `parseXml` aceita
  `{ stripNamespaces: true }` para removê-los.
- Código totalmente numérico e sem decimais (conta contábil, CNPJ) é lido como
  número e aparece na lista de campos totalizáveis. Os operadores de texto
  continuam disponíveis nele, e o painel mostra o tipo declarado ao lado — mas
  a distinção entre identificador e medida não é decidível sem semântica.
- Só o dialeto DATAPACKET é reconhecido. Outros formatos com esquema embutido
  caem no caminho genérico, que lista todo atributo encontrado.
- O download sai com o nome exato do arquivo importado. O navegador não
  sobrescreve o original: se já existir um arquivo com esse nome na pasta de
  downloads, ele salva como `nome (1).xml`. Escrever por cima exigiria a File
  System Access API, que precisa de um handle obtido na abertura.
- A exportação é equivalente em conteúdo, não byte a byte: o parser descarta
  comentários e normaliza espaço em branco, então o arquivo sai reindentado.
  Em nós com conteúdo misto (texto e filhos juntos) o texto é escrito antes dos
  filhos; a interface avisa quando o documento tem algum.
- As edições vivem em memória. Recarregar a página perde o rascunho — exporte
  antes de fechar.
