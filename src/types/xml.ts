/**
 * Modelo de dados do documento XML.
 *
 * A árvore é armazenada como um array plano de nós ligados por índice, e não
 * como objetos aninhados. Isso é o que permite virtualizar a exibição, filtrar
 * e agregar em O(n) sem recursão, e transferir o documento inteiro de um Web
 * Worker para a thread principal por structured clone sem custo de ponteiros.
 */

export type NodeKind = 'element' | 'text' | 'cdata' | 'comment'

export interface XmlNode {
  /** Índice do próprio nó dentro de `XmlDocument.nodes`. */
  id: number
  /** Índice do pai; -1 na raiz. */
  parent: number
  kind: NodeKind
  /** Nome da tag, sem prefixo de namespace resolvido. */
  name: string
  /** Caminho absoluto sem índices: `/nfeProc/NFe/infNFe/det/prod/vProd`. */
  path: string
  depth: number
  /** Posição entre irmãos de mesmo nome (base 0). */
  ordinal: number
  attrs: Record<string, string>
  /** Texto direto do nó, quando ele é folha. */
  value?: string
  /** `value` convertido, quando o conteúdo é numérico. */
  num?: number
  /** `value` convertido para epoch ms, quando o conteúdo é uma data. */
  time?: number
  children: number[]
}

/**
 * Perfil dos valores de um atributo dentro de um caminho.
 *
 * Atributos são perfilados exatamente como o texto dos elementos porque, em
 * XML tabular (`<ROW Valor="1234.56"/>`), o dado inteiro vive em atributo.
 * Sem isso, "maior que" em um atributo não teria tipo para comparar.
 */
export interface AttrProfile {
  name: string
  count: number
  /** Ocorrências com valor não vazio. */
  valued: number
  numericCount: number
  dateCount: number
  min?: number
  max?: number
  samples: string[]
}

/** Perfil de um caminho — a base para detecção automática de campos. */
export interface PathProfile {
  path: string
  /** Nome da tag folha, para exibição. */
  leaf: string
  depth: number
  count: number
  /** Quantos nós desse caminho têm texto não vazio. */
  valued: number
  /** Quantos nós desse caminho têm valor numérico. */
  numericCount: number
  /** Quantos nós desse caminho têm valor de data. */
  dateCount: number
  /** ≥ 80% dos valores são numéricos: candidato a totalização. */
  isNumeric: boolean
  isDate: boolean
  min?: number
  max?: number
  /** Atributos vistos nesse caminho, perfilados por nome. */
  attrs: Record<string, AttrProfile>
  /** Até 5 valores distintos, para preview nos filtros. */
  samples: string[]
  /** O pai tem mais de um filho com esse nome em algum ponto do documento. */
  repeats: boolean
}

export interface XmlDocument {
  id: string
  fileName: string
  /** Bytes do arquivo original. */
  bytes: number
  parsedAt: number
  parseMs: number
  /** Índice do nó raiz em `nodes`. */
  root: number
  nodes: XmlNode[]
  /** Perfis indexados por caminho, em ordem de primeira aparição. */
  profiles: Record<string, PathProfile>
  /** Declaração de encoding/versão, quando presente. */
  declaration?: Record<string, string>
}

export interface ParseFailure {
  fileName: string
  message: string
}

/* ------------------------------------------------------------------ */
/* Edição                                                              */
/* ------------------------------------------------------------------ */

/**
 * Alterações pendentes de um nó.
 *
 * As edições vivem em um overlay indexado por id de nó, nunca dentro do
 * documento. O documento recém-parseado permanece intocado, então "desfazer"
 * é apagar uma entrada — não desfazer uma mutação — e o valor original está
 * sempre à mão para comparar e para marcar o campo como alterado.
 */
export interface NodeEdit {
  /** Novo texto do nó. Ausente significa "texto não alterado". */
  value?: string
  /** Novos valores de atributo, por nome. */
  attrs?: Record<string, string>
}

/** Overlay de um documento: id do nó -> alterações. */
export type DocumentEdits = Record<number, NodeEdit>

/** Identifica o campo editável dentro de um nó. */
export interface EditTarget {
  node: number
  /** Nome do atributo; ausente edita o texto do elemento. */
  attr?: string
}

/* ------------------------------------------------------------------ */
/* Campos                                                              */
/* ------------------------------------------------------------------ */

export type FieldSource = 'attribute' | 'element'

/**
 * Um campo do documento, identificado pelo nome e não pelo caminho.
 *
 * O mesmo nome pode aparecer em vários caminhos (`vProd` em `det/prod` e em
 * `total/ICMSTot`). O campo agrega todas essas ocorrências e guarda os
 * caminhos em `paths`, para que a interface possa avisar quando um nome é
 * ambíguo — sem obrigar ninguém a escolher o caminho para filtrar.
 */
export interface XmlField {
  /** `@nome` para atributo, `nome` para tag. Estável, serve de chave. */
  id: string
  name: string
  source: FieldSource
  count: number
  /** Ocorrências com valor não vazio. */
  valued: number
  numericCount: number
  dateCount: number
  isNumeric: boolean
  isDate: boolean
  min?: number
  max?: number
  samples: string[]
  /** Caminhos onde o campo ocorre, em ordem de frequência. */
  paths: string[]
  /** O documento declara este campo no próprio esquema (DATAPACKET etc.). */
  declared: boolean
  /** Tipo declarado pelo esquema, quando houver (`i4`, `string`, …). */
  declaredType?: string
  /** Largura declarada, quando houver. */
  width?: number
  /** Ordem de declaração; `Infinity` para campos não declarados. */
  order: number
}

/** Tipo de valor de um campo — define os operadores e o input oferecidos. */
export type FieldKind = 'text' | 'number' | 'date'

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'starts'
  | 'exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'

export interface Filter {
  id: string
  /**
   * Grupo lógico. Filtros do mesmo grupo se combinam por OU; grupos entre si
   * se combinam por E. Precedência fica sendo `(A OU B) E (C OU D)`, que é
   * explícita na tela e não depende de ordem de leitura.
   */
  group: string
  /** Nome do campo. Vazio enquanto o filtro não foi configurado. */
  field: string
  /** Onde procurar o nome. `any` cobre atributo e tag de mesmo nome. */
  source: FieldSource | 'any'
  op: FilterOperator
  /**
   * Valores dos operadores de texto. Mais de um vale como `IN`: o registro
   * passa se casar com qualquer um. Um valor só é o caso trivial da lista, e
   * não um caminho separado no código.
   */
  values: string[]
  /** Limite inferior: `gt`, `gte` e `between`. Datas em epoch ms. */
  min?: number
  /** Limite superior: `lt`, `lte` e `between`. */
  max?: number
  kind: FieldKind
  enabled: boolean
}

/* ------------------------------------------------------------------ */
/* Agregação                                                           */
/* ------------------------------------------------------------------ */

export interface Stats {
  count: number
  sum: number
  avg: number
  min: number
  max: number
  /** Nós do caminho que não puderam ser lidos como número. */
  invalid: number
}

export interface GroupedStats extends Stats {
  key: string
  share: number
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

export type DiffStatus = 'equal' | 'added' | 'removed' | 'changed'

export interface AttrChange {
  name: string
  left?: string
  right?: string
  status: Exclude<DiffStatus, 'equal'>
}

export interface DiffRow {
  id: number
  depth: number
  status: DiffStatus
  /** Nó correspondente no documento da esquerda. */
  left?: number
  right?: number
  name: string
  path: string
  leftValue?: string
  rightValue?: string
  attrChanges: AttrChange[]
  /** Verdadeiro quando o próprio nó é igual mas um descendente mudou. */
  hasChangedDescendants: boolean
  childRows: DiffRow[]
  /** Índice do último irmão, para desenhar a régua de profundidade. */
  isLast: boolean
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  equal: number
}
