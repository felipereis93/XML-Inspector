# Salvar edições no arquivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Salvar" que grava as edições pendentes no arquivo XML de origem e limpa os quatro indicadores de pendência.

**Architecture:** O I/O de arquivo usa a File System Access API e vive em `src/lib/fs/`, isolado da store e dos componentes. A store faz uma única transição pura — consolidar o overlay de edições no documento baseline — e, como os quatro indicadores derivam de `edits[docId]` comparado com `docs`, todos somem juntos sem que nenhum componente de exibição seja tocado.

**Tech Stack:** React 19, TypeScript 6, zustand 5, Tailwind 4, Vite 8, oxlint. Sem framework de testes: a lógica pura é verificada por `scripts/smoke.ts` (`npm run smoke`), um script `tsx` que imprime `OK`/`FALHOU`.

**Spec:** `docs/superpowers/specs/2026-07-28-salvar-edicoes-design.md`

## Global Constraints

- **Nada de rede.** O app roda inteiramente no navegador e a tela inicial promete "Nada sai do seu navegador". Nenhuma tarefa introduz servidor, fetch ou telemetria.
- **Consolidar só após gravação confirmada.** Enquanto `write()`/`close()` não retornar, as edições permanecem intactas no overlay.
- **O caminho de download não consolida.** `kind: 'downloaded'` mostra toast e mantém o banner: o arquivo de origem não foi tocado.
- **Comentários e mensagens de UI em português**, seguindo o código existente. Comentários explicam *por quê*, não *o quê* — é o padrão em todo `src/lib/xml/`.
- **Textos de toast, exatos:**
  - gravou no handle: `Alterações salvas com sucesso no arquivo`
  - gravou via "Salvar como": `Salvo em <nome>.xml`
  - caiu para download: `<nome>.xml baixado — substitua o original manualmente.`
  - permissão negada: `Permissão de escrita negada para <nome>.xml.`
  - falha de I/O: `Não foi possível salvar: <motivo>`
- **Verificação de cada tarefa:** `npm run lint && npm run build`, mais `npm run smoke` nas tarefas 1 e 2. `npm run build` roda `tsc -b`, que checa `src/` e `scripts/` nos dois projetos.
- **`scripts/` não tem DOM.** `tsconfig.scripts.json` declara `"lib": ["ES2023"]`. Nada importado por `smoke.ts` pode tocar em `window`, `document` ou `TextEncoder` de DOM.
- **Commits frequentes**, um por tarefa, em português, no estilo do histórico.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/lib/xml/profiles.ts` | **Criar.** `buildProfiles(nodes)` e os acumuladores `profile`/`observe`, movidos de `parse.ts`. Puro, sem DOM, sem `fast-xml-parser`. | 1 |
| `src/lib/xml/parse.ts` | **Modificar.** Passa a importar `buildProfiles`; perde `profile`, `observe`, `ValueStats`, `SAMPLE_LIMIT`. | 1 |
| `src/lib/xml/commit.ts` | **Criar.** `commitEdits(doc, edits, bytes)` — documento + overlay → novo baseline. Puro. | 2 |
| `src/store/useWorkspace.ts` | **Modificar.** Ação `commitDocument`; `addFiles` aceita handles; `removeDoc` descarta handle. | 2, 5 |
| `src/types/file-system-access.d.ts` | **Criar.** Tipos ambientes que faltam em `lib.dom` do TS 6. | 3 |
| `src/lib/fs/handles.ts` | **Criar.** Registro `docId → FileSystemFileHandle` e permissão de escrita. | 3 |
| `src/lib/fs/saveDocument.ts` | **Criar.** Serializa, grava, devolve `SaveOutcome`. | 4 |
| `src/lib/fs/pickFiles.ts` | **Criar.** Abertura de arquivos com captura de handle (seletor e drop). | 5 |
| `src/components/upload/DropZone.tsx` | **Modificar.** `FilePicker` usa o seletor com handle; o drop coleta handles. | 5 |
| `src/components/ui/Toast.tsx` | **Criar.** `useToasts`, `pushToast`, `<ToastHost/>`. | 6 |
| `src/hooks/useSaveDocument.ts` | **Criar.** Orquestra save → commit → toast. | 7 |
| `src/components/edit/ChangesBar.tsx` | **Modificar.** "Baixar" sai, "Salvar" entra. | 7 |
| `src/App.tsx` | **Modificar.** Monta `<ToastHost/>` e liga o hook à barra. | 7 |
| `scripts/smoke.ts` | **Modificar.** Checagens de `buildProfiles` e `commitEdits`. | 1, 2 |
| `README.md` | **Modificar.** Documentar o fluxo de salvar. | 8 |

**Por que `profiles.ts` separado de `parse.ts`:** hoje `parse.ts` só é carregado pelo worker, e ele importa `fast-xml-parser`. Se `commit.ts` importasse `buildProfiles` de `parse.ts`, o parser inteiro entraria no bundle da thread principal. `profiles.ts` depende apenas de `coerce.ts` e dos tipos.

---

### Task 1: Extrair `buildProfiles` para um módulo próprio

Os perfis de caminho (`PathProfile`) hoje são construídos dentro do laço de traversal de `parseXml`. Consolidar edições precisa recalculá-los a partir de um array de nós já pronto, então a construção sai para uma função independente.

**Files:**
- Create: `src/lib/xml/profiles.ts`
- Modify: `src/lib/xml/parse.ts:1-8` (imports), `:33-34` (constantes), `:71` (declaração), `:127` (chamada no laço), `:145-151` (pós-processamento), `:195-273` (mover `profile`/`observe`)
- Modify: `scripts/smoke.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `buildProfiles(nodes: XmlNode[]): Record<string, PathProfile>` de `src/lib/xml/profiles.ts`. Usado pela Task 2.

- [ ] **Step 1: Criar `src/lib/xml/profiles.ts` movendo os acumuladores**

Recorte `profile`, `observe`, o tipo `ValueStats` e a constante `SAMPLE_LIMIT` de `parse.ts` para este arquivo novo, sem alterar o corpo de nenhum deles, e acrescente `buildProfiles` por cima:

```ts
import type { AttrProfile, PathProfile, XmlNode } from '../../types/xml'
import { toNumber, toTime } from './coerce'

/**
 * Construção dos perfis de caminho.
 *
 * Separado de `parse.ts` porque é preciso refazer os perfis fora do parsing:
 * ao salvar, o documento editado vira o novo baseline e os perfis do arquivo
 * antigo passariam a descrever um arquivo que não existe mais. Este módulo não
 * conhece `fast-xml-parser`, então recalcular na thread principal não arrasta o
 * parser inteiro para o bundle.
 */

const SAMPLE_LIMIT = 5

/**
 * Perfis a partir de um array de nós já montado.
 *
 * A ordem do array é a ordem de traversal, que é o que `repeats` e `samples`
 * assumem: o primeiro valor visto é o primeiro da amostra.
 */
export function buildProfiles(nodes: XmlNode[]): Record<string, PathProfile> {
  const profiles: Record<string, PathProfile> = {}
  for (const node of nodes) profile(profiles, node, node.ordinal > 0)

  for (const p of Object.values(profiles)) {
    // Um caminho só conta como numérico se praticamente todo valor preenchido
    // for lido como número. 90% tolera um registro sujo sem transformar um
    // campo de texto em métrica por acidente.
    p.isNumeric = p.valued > 0 && p.numericCount / p.valued >= 0.9
    p.isDate = !p.isNumeric && p.valued > 0 && p.dateCount / p.valued >= 0.9
  }
  return profiles
}

function profile(
  profiles: Record<string, PathProfile>,
  node: XmlNode,
  repeated: boolean,
): void {
  let p = profiles[node.path]
  if (!p) {
    p = profiles[node.path] = {
      path: node.path,
      leaf: node.name,
      depth: node.depth,
      count: 0,
      valued: 0,
      numericCount: 0,
      dateCount: 0,
      isNumeric: false,
      isDate: false,
      attrs: {},
      samples: [],
      repeats: false,
    }
  }

  p.count++
  if (repeated) p.repeats = true

  for (const key in node.attrs) {
    let a = p.attrs[key]
    if (!a) {
      a = p.attrs[key] = {
        name: key,
        count: 0,
        valued: 0,
        numericCount: 0,
        dateCount: 0,
        samples: [],
      }
    }
    a.count++
    observe(a, node.attrs[key])
  }

  // O nó já foi coagido na criação: reaproveitamos em vez de converter de novo.
  observe(p, node.value, node.num, node.time)
}

/**
 * Campos de estatística comuns ao perfil de caminho e ao de atributo. Ter um
 * só acumulador garante que "é numérico" signifique exatamente a mesma coisa
 * para uma tag e para um atributo.
 */
type ValueStats = Pick<
  AttrProfile,
  'valued' | 'numericCount' | 'dateCount' | 'min' | 'max' | 'samples'
>

function observe(
  target: ValueStats,
  raw: string | undefined,
  num = raw === undefined ? undefined : toNumber(raw),
  time = num !== undefined || raw === undefined ? undefined : toTime(raw),
): void {
  if (raw === undefined || raw === '') return

  target.valued++
  if (target.samples.length < SAMPLE_LIMIT && !target.samples.includes(raw)) {
    target.samples.push(raw)
  }

  const scalar = num ?? time
  if (scalar === undefined) return
  if (num !== undefined) target.numericCount++
  else target.dateCount++

  target.min =
    target.min === undefined || scalar < target.min ? scalar : target.min
  target.max =
    target.max === undefined || scalar > target.max ? scalar : target.max
}
```

- [ ] **Step 2: Ajustar `parse.ts` para consumir o módulo novo**

Quatro edições em `src/lib/xml/parse.ts`:

1. Adicionar o import, logo depois do import de `coerce`:
```ts
import { buildProfiles } from './profiles'
```
2. Apagar a constante `const SAMPLE_LIMIT = 5` (linha 34) e as funções `profile`, `observe` e o tipo `ValueStats` (linhas 195-273) — foram para `profiles.ts`.
3. No corpo de `parseXml`: apagar a declaração `const profiles: Record<string, PathProfile> = {}` (linha 71), a chamada `profile(profiles, node, ordinal > 0)` (linha 127) e o laço de pós-processamento `for (const p of Object.values(profiles)) { ... }` (linhas 145-151).
4. Substituir por uma única chamada logo antes do `return`:
```ts
  const profiles = buildProfiles(nodes)

  return {
    id: `${fileName}:${started.toFixed(0)}:${Math.random().toString(36).slice(2, 8)}`,
    ...
```

Ajuste os imports de tipo no topo: `AttrProfile` e `PathProfile` provavelmente ficam sem uso em `parse.ts` — o `noUnusedLocals` do tsconfig acusa se sobrarem.

Isso troca a construção durante o traversal por uma passagem O(n) extra. Para os arquivos-alvo é ruído; em troca, parse e commit passam a produzir perfis pelo mesmo caminho de código.

- [ ] **Step 3: Escrever a checagem de equivalência no smoke**

Em `scripts/smoke.ts`, adicione o import no bloco de imports de `../src/lib/xml/`:
```ts
import { buildProfiles } from '../src/lib/xml/profiles'
```

E, logo depois da linha `console.log(\`nós: v1=${a.nodes.length} v2=${b.nodes.length}\`)`, o bloco:

```ts
section('buildProfiles reproduz os perfis do parser')
for (const doc of [a, b]) {
  const rebuilt = buildProfiles(doc.nodes)
  const same = JSON.stringify(rebuilt) === JSON.stringify(doc.profiles)
  console.log(
    `  ${same ? 'OK    ' : 'FALHOU'} ${doc.fileName.padEnd(14)} ${Object.keys(rebuilt).length} caminhos`,
  )
}
```

Se a extração tivesse mudado ordem de iteração, limite de amostras ou o critério dos 90%, os objetos divergiriam e a linha sairia `FALHOU`.

- [ ] **Step 4: Rodar e conferir**

```bash
npm run smoke
```
Esperado: a seção `— buildProfiles reproduz os perfis do parser —` com duas linhas `OK`, e **todo o resto da saída idêntico ao de antes da mudança**. Se qualquer outra seção mudou, a extração alterou comportamento — investigue antes de seguir.

```bash
npm run lint && npm run build
```
Esperado: ambos passam sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/xml/profiles.ts src/lib/xml/parse.ts scripts/smoke.ts
git commit -m "Extrai buildProfiles de parse.ts para profiles.ts

Consolidar edições ao salvar precisa refazer os perfis a partir de um
array de nós pronto. Módulo separado para não arrastar fast-xml-parser
para o bundle da thread principal."
```

---

### Task 2: `commitEdits` e a ação `commitDocument`

O coração da funcionalidade: transformar documento original + overlay em um novo baseline.

**Files:**
- Create: `src/lib/xml/commit.ts`
- Modify: `src/store/useWorkspace.ts` (interface `WorkspaceState` e corpo do `create`)
- Modify: `scripts/smoke.ts`

**Interfaces:**
- Consumes: `buildProfiles(nodes: XmlNode[]): Record<string, PathProfile>` (Task 1).
- Produces:
  - `commitEdits(doc: XmlDocument, edits: DocumentEdits | undefined, bytes: number): XmlDocument` de `src/lib/xml/commit.ts`
  - Ação de store `commitDocument(docId: string, bytes: number): void`. Usada pela Task 7.

- [ ] **Step 1: Escrever as checagens que devem falhar**

Em `scripts/smoke.ts`, adicione o import:
```ts
import { commitEdits } from '../src/lib/xml/commit'
```

E o bloco, logo após a seção `buildProfiles` da Task 1:

```ts
section('commitEdits consolida as edições no baseline')
{
  const target1 = { node: findNode(a, '/nfeProc/NFe/infNFe/emit/xNome') }
  const target2 = { node: findNode(a, '/nfeProc/NFe/infNFe/total/ICMSTot/vNF') }
  const target3 = { node: findNode(a, '/nfeProc/NFe/infNFe/ide'), attr: 'x' }

  let pending: DocumentEdits = {}
  pending = writeEdit(pending, a, target1, 'Nome Novo Ltda')
  pending = writeEdit(pending, a, target2, '2000.00')
  pending = writeEdit(pending, a, target3, 'marcado')

  const xml = serializeDocument(applyEdits(a, pending)!)
  const bytes = Buffer.byteLength(xml, 'utf8')
  const saved = commitEdits(a, pending, bytes)

  const checks: Array<[string, boolean]> = [
    ['valor de texto consolidado', saved.nodes[target1.node].value === 'Nome Novo Ltda'],
    ['num recalculado', saved.nodes[target2.node].num === 2000],
    ['atributo consolidado', saved.nodes[target3.node].attrs.x === 'marcado'],
    ['bytes atualizados', saved.bytes === bytes],
    ['original intocado', a.nodes[target1.node].value !== 'Nome Novo Ltda'],
    [
      'perfil reflete o valor novo',
      saved.profiles['/nfeProc/NFe/infNFe/total/ICMSTot/vNF']?.max === 2000,
    ],
    [
      'reeditar com o mesmo valor não marca alterado',
      countEdits(writeEdit({}, saved, target1, 'Nome Novo Ltda')) === 0,
    ],
    ['saída idêntica à do overlay', serializeDocument(saved) === xml],
    ['idempotente', JSON.stringify(commitEdits(saved, {}, saved.bytes)) === JSON.stringify(saved)],
  ]
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${label}`)
  }
}
```

Adicione também este auxiliar junto do `read` no topo do arquivo, se ainda não existir:
```ts
const findNode = (doc: XmlDocument, path: string) => {
  const id = doc.nodes.findIndex((n) => n.path === path)
  if (id < 0) throw new Error(`caminho ausente no sample: ${path}`)
  return id
}
```

`smoke.ts` já importa `writeEdit`, `applyEdits`, `countEdits`, `serializeDocument` e o tipo `DocumentEdits`. Confirme e complete os imports se faltar algum.

- [ ] **Step 2: Rodar para ver falhar**

```bash
npm run smoke
```
Esperado: FALHA na compilação com `Cannot find module '../src/lib/xml/commit'`. O `commit.ts` ainda não existe — é exatamente o que deve acontecer.

- [ ] **Step 3: Criar `src/lib/xml/commit.ts`**

```ts
import type { DocumentEdits, XmlDocument } from '../../types/xml'
import { applyEdits } from './edits'
import { buildProfiles } from './profiles'

/**
 * Consolidação do overlay no documento baseline.
 *
 * Chamado depois de uma gravação confirmada em disco: a partir daí o arquivo
 * salvo é a origem, e o documento em memória precisa dizer o mesmo. Como todo
 * indicador de "alterado" na interface nasce da comparação entre `docs` e
 * `edits`, mover as edições para o baseline apaga banner, selo, valor riscado
 * e destaque da célula de uma vez — sem que nenhum componente saiba que houve
 * um salvamento.
 *
 * Os perfis são refeitos junto. Durante a edição, perfis defasados são um
 * incômodo temporário e aceitável (ver `edits.ts`); depois de salvar, seriam
 * uma descrição permanentemente errada do arquivo.
 */
export function commitEdits(
  doc: XmlDocument,
  edits: DocumentEdits | undefined,
  bytes: number,
): XmlDocument {
  const applied = applyEdits(doc, edits) ?? doc
  return { ...applied, bytes, profiles: buildProfiles(applied.nodes) }
}
```

- [ ] **Step 4: Rodar as checagens**

```bash
npm run smoke
```
Esperado: as nove linhas da seção `— commitEdits consolida as edições no baseline —` todas com `OK`.

- [ ] **Step 5: Adicionar a ação na store**

Em `src/store/useWorkspace.ts`:

1. Import:
```ts
import { commitEdits } from '../lib/xml/commit'
```
2. Na interface `WorkspaceState`, logo abaixo de `revertDocument`:
```ts
  /** Gravação confirmada: as edições viram o novo baseline. */
  commitDocument: (docId: string, bytes: number) => void
```
3. No corpo do `create`, logo abaixo da implementação de `revertDocument`:
```ts
  commitDocument: (docId, bytes) =>
    set((s) => {
      const doc = s.docs.find((d) => d.id === docId)
      if (!doc) return s

      const committed = commitEdits(doc, s.edits[docId], bytes)
      const edits = { ...s.edits }
      delete edits[docId]

      return {
        docs: s.docs.map((d) => (d.id === docId ? committed : d)),
        edits,
      }
    }),
```

`docs` é substituído por um array novo com um documento novo na posição, o que faz `useEffectiveDoc` recalcular; `edits[docId]` desaparece, o que zera `countEdits` e desmonta a `ChangesBar`.

- [ ] **Step 6: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam. `commitDocument` ainda não tem chamador — isso é esperado, `noUnusedLocals` não reclama de propriedades de interface.

- [ ] **Step 7: Commit**

```bash
git add src/lib/xml/commit.ts src/store/useWorkspace.ts scripts/smoke.ts
git commit -m "Consolida edições no baseline após gravação

commitEdits produz o documento salvo a partir do original mais o
overlay, com bytes e perfis atualizados. Como os indicadores de
alterado derivam de docs vs edits, consolidar apaga os quatro sem
tocar em nenhum componente."
```

---

### Task 3: Tipos ambientes e registro de handles

`lib.dom` do TypeScript 6 tem `FileSystemFileHandle` e `createWritable()`, mas **não** tem `showOpenFilePicker`, `showSaveFilePicker`, `queryPermission`/`requestPermission` nem `DataTransferItem.getAsFileSystemHandle`. Esta tarefa preenche a lacuna e cria o registro que liga documento a handle.

**Files:**
- Create: `src/types/file-system-access.d.ts`
- Create: `src/lib/fs/handles.ts`

**Interfaces:**
- Consumes: nada.
- Produces, de `src/lib/fs/handles.ts`:
  - `supportsFileSystemAccess(): boolean`
  - `rememberHandle(docId: string, handle: FileSystemFileHandle): void`
  - `handleFor(docId: string): FileSystemFileHandle | undefined`
  - `forgetHandle(docId: string): void`
  - `ensureWritable(handle: FileSystemFileHandle): Promise<boolean>`

- [ ] **Step 1: Declarar os tipos que faltam**

Crie `src/types/file-system-access.d.ts`:

```ts
/**
 * Partes da File System Access API ausentes do `lib.dom` do TypeScript 6.
 *
 * `FileSystemFileHandle` e `createWritable()` já vêm da lib padrão; o que falta
 * são os seletores, a negociação de permissão e o handle vindo de drag-drop.
 * Todos declarados como opcionais de propósito: a API não existe em Firefox
 * nem Safari, e o `?` obriga cada ponto de uso a checar antes de chamar.
 */

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FilePickerAcceptType {
    description?: string
    accept: Record<string, string[]>
  }

  interface OpenFilePickerOptions {
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: FilePickerAcceptType[]
  }

  interface SaveFilePickerOptions {
    suggestedName?: string
    excludeAcceptAllOption?: boolean
    types?: FilePickerAcceptType[]
  }

  interface FileSystemHandle {
    queryPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>
    requestPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>
  }

  interface Window {
    showOpenFilePicker?(
      options?: OpenFilePickerOptions,
    ): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(
      options?: SaveFilePickerOptions,
    ): Promise<FileSystemFileHandle>
  }

  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
  }
}

export {}
```

Duas armadilhas neste arquivo: o `export {}` no fim é obrigatório — sem ele o arquivo é um script global e o `declare global` vira erro de compilação; e **todas** as interfaces auxiliares ficam dentro do `declare global`. Deixá-las fora as tornaria locais ao módulo, e `FilePickerAcceptType` — usado na Task 5 — não seria encontrado.

- [ ] **Step 2: Criar o registro de handles**

Crie `src/lib/fs/handles.ts`:

```ts
/**
 * Registro de handles de escrita, por documento.
 *
 * Um `Map` de módulo e não estado do zustand: handles são objetos de navegador
 * não clonáveis, nenhum componente renderiza a partir deles, e a pergunta
 * "tenho handle para este documento?" só é feita no clique de salvar — nunca
 * durante um render.
 */

const handles = new Map<string, FileSystemFileHandle>()

/** O navegador sabe gravar em arquivo escolhido pelo usuário. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export function rememberHandle(
  docId: string,
  handle: FileSystemFileHandle,
): void {
  handles.set(docId, handle)
}

export function handleFor(docId: string): FileSystemFileHandle | undefined {
  return handles.get(docId)
}

export function forgetHandle(docId: string): void {
  handles.delete(docId)
}

/**
 * Garante permissão de escrita, pedindo ao usuário se necessário.
 *
 * Handles vindos de `showOpenFilePicker` nascem só com leitura, e
 * `requestPermission` abre um prompt que **exige gesto do usuário** — por isso
 * quem chama precisa estar na cadeia de ativação do clique, sem nenhum `await`
 * lento antes.
 */
export async function ensureWritable(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return true
  return (await handle.requestPermission?.(descriptor)) === 'granted'
}
```

- [ ] **Step 3: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam. Se `tsc` reclamar de `queryPermission` não existir em `FileSystemFileHandle`, o `declare global` do Step 1 não foi aplicado — confirme que o arquivo está em `src/` (o `include` do `tsconfig.app.json`) e que termina com `export {}`.

- [ ] **Step 4: Commit**

```bash
git add src/types/file-system-access.d.ts src/lib/fs/handles.ts
git commit -m "Registro de handles de escrita da File System Access API

Tipos ambientes para os seletores e a negociação de permissão, que o
lib.dom do TypeScript 6 ainda não traz, e um Map de módulo ligando
documento a handle."
```

---

### Task 4: `saveDocument` — a gravação

**Files:**
- Create: `src/lib/fs/saveDocument.ts`

**Interfaces:**
- Consumes: `supportsFileSystemAccess`, `handleFor`, `rememberHandle`, `forgetHandle`, `ensureWritable` (Task 3); `serializeDocument(doc, options?)` de `src/lib/xml/serialize.ts`; `downloadText(content, fileName, type)` de `src/lib/download.ts`.
- Produces, de `src/lib/fs/saveDocument.ts`:
  - `type SaveOutcome`
  - `class SaveError extends Error`
  - `saveDocument(doc: XmlDocument): Promise<SaveOutcome>`

- [ ] **Step 1: Criar o módulo**

```ts
import type { XmlDocument } from '../../types/xml'
import { serializeDocument } from '../xml/serialize'
import { downloadText } from '../download'
import {
  ensureWritable,
  forgetHandle,
  handleFor,
  rememberHandle,
  supportsFileSystemAccess,
} from './handles'

/**
 * Gravação do documento no arquivo de origem.
 *
 * Três caminhos, em ordem de preferência: o handle guardado da abertura (grava
 * sem diálogo), o `showSaveFilePicker` (o usuário escolhe onde, e o handle
 * passa a valer para os próximos salvamentos) e, sem a API, o download.
 *
 * `cancelled` é um desfecho normal, não um erro: fechar o diálogo não deve
 * gerar aviso nenhum. Falha de gravação vira `SaveError` com mensagem pronta
 * para a tela.
 */

export type SaveOutcome =
  | { kind: 'saved'; fileName: string; bytes: number; picked: boolean }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'cancelled' }

export class SaveError extends Error {}

const XML_TYPE = 'application/xml;charset=utf-8'

export async function saveDocument(doc: XmlDocument): Promise<SaveOutcome> {
  const xml = serializeDocument(doc)
  const bytes = new TextEncoder().encode(xml).length

  const known = handleFor(doc.id)
  if (known) {
    if (!(await ensureWritable(known))) {
      throw new SaveError(`Permissão de escrita negada para ${known.name}.`)
    }
    await write(known, xml, doc.id)
    return { kind: 'saved', fileName: known.name, bytes, picked: false }
  }

  const picker = supportsFileSystemAccess() ? window.showSaveFilePicker : undefined
  if (!picker) {
    downloadText(xml, doc.fileName, XML_TYPE)
    return { kind: 'downloaded', fileName: doc.fileName }
  }

  let handle: FileSystemFileHandle
  try {
    handle = await picker.call(window, {
      suggestedName: doc.fileName,
      types: [{ description: 'Arquivo XML', accept: { 'application/xml': ['.xml'] } }],
    })
  } catch (error) {
    if (isAbort(error)) return { kind: 'cancelled' }
    throw new SaveError(`Não foi possível salvar: ${messageOf(error)}`)
  }

  if (!(await ensureWritable(handle))) {
    throw new SaveError(`Permissão de escrita negada para ${handle.name}.`)
  }
  await write(handle, xml, doc.id)
  rememberHandle(doc.id, handle)
  return { kind: 'saved', fileName: handle.name, bytes, picked: true }
}

/**
 * Escreve e fecha. Qualquer falha descarta o handle: o arquivo pode ter sido
 * movido ou apagado, e insistir no mesmo handle repetiria o erro para sempre.
 * Sem ele, o próximo salvamento reabre o diálogo.
 */
async function write(
  handle: FileSystemFileHandle,
  xml: string,
  docId: string,
): Promise<void> {
  try {
    const stream = await handle.createWritable()
    await stream.write(xml)
    await stream.close()
  } catch (error) {
    forgetHandle(docId)
    throw new SaveError(`Não foi possível salvar: ${messageOf(error)}`)
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

`picker.call(window, …)` e não `picker(…)`: o método precisa de `this === window`, e destacá-lo da referência perderia isso.

- [ ] **Step 2: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fs/saveDocument.ts
git commit -m "Grava o documento no arquivo de origem

Handle guardado, senão Salvar como, senão download. Cancelar o diálogo
é desfecho normal e não vira erro; falha de gravação descarta o handle
para que o próximo salvamento reabra o diálogo."
```

---

### Task 5: Capturar handles ao abrir arquivos

Sem esta tarefa, todo salvamento passa pelo diálogo "Salvar como". Com ela, arquivos abertos pelo seletor ou soltos na janela gravam direto.

**Files:**
- Create: `src/lib/fs/pickFiles.ts`
- Modify: `src/components/upload/DropZone.tsx:19-56` (drop), `:79-113` (`FilePicker`)
- Modify: `src/store/useWorkspace.ts` (`addFiles`, `removeDoc`)

**Interfaces:**
- Consumes: `rememberHandle`, `forgetHandle` (Task 3).
- Produces, de `src/lib/fs/pickFiles.ts`:
  - `type HandleMap = Map<File, FileSystemFileHandle>`
  - `supportsOpenPicker(): boolean`
  - `pickXmlFiles(): Promise<{ files: File[]; handles: HandleMap } | undefined>`
  - `dropHandlePromises(dataTransfer: DataTransfer): Promise<FileSystemHandle | null>[]`
  - `pairDropHandles(files: File[], promises: Promise<FileSystemHandle | null>[]): Promise<HandleMap>`

  E a assinatura nova da store: `addFiles(files: File[], handles?: HandleMap): Promise<void>`.

- [ ] **Step 1: Criar `src/lib/fs/pickFiles.ts`**

```ts
/**
 * Abertura de arquivos com captura do handle de escrita.
 *
 * O `<input type=file>` e o `dataTransfer.files` entregam `File` somente
 * leitura, o que basta para ler mas nunca para gravar de volta. Quando o
 * navegador suporta, pegamos o handle no mesmo gesto em que o arquivo é
 * escolhido — é a única oportunidade: depois não há como pedir o handle de um
 * `File` que já se tem em mãos.
 */

export type HandleMap = Map<File, FileSystemFileHandle>

const XML_TYPES: FilePickerAcceptType[] = [
  {
    description: 'Arquivos XML',
    accept: {
      'application/xml': ['.xml', '.nfe', '.xsd', '.rss', '.kml'],
      'image/svg+xml': ['.svg'],
    },
  },
]

export function supportsOpenPicker(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

/**
 * Abre o seletor do sistema. `undefined` significa que o usuário cancelou —
 * quem chama não deve mostrar erro nenhum.
 */
export async function pickXmlFiles(): Promise<
  { files: File[]; handles: HandleMap } | undefined
> {
  const picker = window.showOpenFilePicker
  if (!picker) return undefined

  let handles: FileSystemFileHandle[]
  try {
    handles = await picker.call(window, { multiple: true, types: XML_TYPES })
  } catch {
    return undefined
  }

  const files: File[] = []
  const map: HandleMap = new Map()
  for (const handle of handles) {
    const file = await handle.getFile()
    files.push(file)
    map.set(file, handle)
  }
  return { files, handles: map }
}

/**
 * Promessas de handle de um drop, colhidas **de forma síncrona**.
 *
 * `DataTransferItem` fica inválido assim que o handler do evento retorna, então
 * `getAsFileSystemHandle()` precisa ser chamado antes de qualquer `await`. As
 * promessas resultantes podem ser aguardadas depois, à vontade.
 */
export function dropHandlePromises(
  dataTransfer: DataTransfer,
): Promise<FileSystemHandle | null>[] {
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFileSystemHandle?.() ?? Promise.resolve(null))
}

/**
 * Casa cada arquivo com seu handle por posição: `dataTransfer.items` filtrado
 * por `kind === 'file'` tem a mesma ordem de `dataTransfer.files`.
 */
export async function pairDropHandles(
  files: File[],
  promises: Promise<FileSystemHandle | null>[],
): Promise<HandleMap> {
  const settled = await Promise.all(
    promises.map((promise) => promise.catch(() => null)),
  )
  const map: HandleMap = new Map()
  files.forEach((file, i) => {
    const handle = settled[i]
    if (handle && handle.kind === 'file') {
      map.set(file, handle as FileSystemFileHandle)
    }
  })
  return map
}
```

- [ ] **Step 2: Ensinar a store a guardar os handles**

Em `src/store/useWorkspace.ts`:

1. Imports:
```ts
import { forgetHandle, rememberHandle } from '../lib/fs/handles'
import type { HandleMap } from '../lib/fs/pickFiles'
```
2. Na interface `WorkspaceState`, trocar a assinatura de `addFiles`:
```ts
  addFiles: (files: File[], handles?: HandleMap) => Promise<void>
```
Continua compatível com as props `(files: File[]) => void` de `DocumentList` e `Landing`: em TypeScript, uma função com parâmetro opcional a mais é atribuível onde se espera uma com menos. Esses componentes não mudam.

3. Em `addFiles`, trocar a assinatura para `async (files, handles)` e, dentro do `results.forEach`, registrar o handle do arquivo correspondente:
```ts
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parsed.push(result.value)
        const handle = handles?.get(xml[i])
        if (handle) rememberHandle(result.value.id, handle)
      } else {
        const reason = result.reason as ParseFailure | Error
        failures.push({
          fileName: xml[i].name,
          message:
            'message' in reason ? reason.message : 'Não foi possível ler o arquivo.',
        })
      }
    })
```
O índice bate porque `results` vem de `Promise.allSettled(xml.map(parseFile))`, na mesma ordem de `xml`.

4. Em `removeDoc`, descartar o handle junto com o resto do estado do documento. Logo no começo do `set`, antes de montar o objeto de retorno:
```ts
      forgetHandle(id)
```
Fechar o arquivo e reabrir depois deve pedir o handle de novo — manter o antigo apontaria para um documento que não está mais na tela.

- [ ] **Step 3: Ligar o seletor e o drop**

Em `src/components/upload/DropZone.tsx`:

1. Imports:
```ts
import {
  dropHandlePromises,
  pairDropHandles,
  pickXmlFiles,
  supportsOpenPicker,
  type HandleMap,
} from '../../lib/fs/pickFiles'
```
2. Trocar o tipo da prop `onFiles` nas duas interfaces do arquivo (a de `DropZone` e a de `FilePicker`):
```ts
  onFiles: (files: File[], handles?: HandleMap) => void
```
3. No `handle` do drop, colher as promessas **antes** de qualquer `await`:
```ts
  const handle = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setOver(false)

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return

      // `getAsFileSystemHandle` precisa ser chamado enquanto o evento ainda
      // está vivo; as promessas sobrevivem, os itens não.
      const promises = event.dataTransfer
        ? dropHandlePromises(event.dataTransfer)
        : []

      void pairDropHandles(files, promises).then((handles) =>
        onFiles(files, handles.size ? handles : undefined),
      )
    },
    [onFiles],
  )
```
4. No `FilePicker`, usar o seletor com handle quando existir e cair no `<input>` quando não:
```ts
  const openPicker = async () => {
    if (!supportsOpenPicker()) {
      input.current?.click()
      return
    }
    const picked = await pickXmlFiles()
    if (picked?.files.length) onFiles(picked.files, picked.handles)
  }
```
e trocar o `onClick` do botão para `() => void openPicker()`. O `<input>` continua no JSX, servindo de fallback.

- [ ] **Step 4: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam. Erro em `DocumentList` ou `Landing` significa que a prop `onFiles` deles foi alterada sem necessidade — reverta, a assinatura antiga é compatível.

- [ ] **Step 5: Conferir no navegador que nada regrediu**

```bash
npm run dev
```
Abra `http://localhost:5173/`, e confirme os dois caminhos de entrada:
- "Abrir arquivos XML" → diálogo do sistema → selecione `samples/nfe-v1.xml` → o documento aparece na lista e na árvore.
- Arraste `samples/datapacket.xml` para a janela → o documento aparece.

Nenhum comportamento visível muda nesta tarefa; ela só passa a guardar o handle por baixo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fs/pickFiles.ts src/components/upload/DropZone.tsx src/store/useWorkspace.ts
git commit -m "Captura o handle de escrita ao abrir arquivos

Seletor do sistema e drag-drop passam a guardar o handle junto do
documento, o que permite salvar sem diálogo. No drop, as promessas de
handle são colhidas antes de qualquer await: DataTransferItem morre
quando o handler retorna."
```

---

### Task 6: Toast

**Files:**
- Create: `src/components/ui/Toast.tsx`

**Interfaces:**
- Consumes: `cn` de `src/lib/cn.ts`; `IconButton` de `src/components/ui/controls.tsx`.
- Produces, de `src/components/ui/Toast.tsx`:
  - `type ToastTone = 'success' | 'error'`
  - `pushToast(tone: ToastTone, message: string): void`
  - `ToastHost(): JSX.Element`

- [ ] **Step 1: Criar o componente**

```tsx
import { useEffect } from 'react'
import { create } from 'zustand'
import { CheckCircle2, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './controls'

/**
 * Avisos efêmeros de ação concluída.
 *
 * Separado da `FailureBar`, que é persistente e fica no fluxo da página: um
 * arquivo que não abriu precisa continuar visível até ser lido, um "salvo com
 * sucesso" não. Store própria e não estado do `App` para que qualquer camada
 * possa avisar sem receber prop nenhuma.
 */

export type ToastTone = 'success' | 'error'

interface Toast {
  id: string
  tone: ToastTone
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: string) => void
}

const DURATION = 4000

const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      DURATION,
    )
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Fora de componente: quem avisa costuma ser um handler, não um render. */
export function pushToast(tone: ToastTone, message: string): void {
  useToasts.getState().push(tone, message)
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}) {
  // Fecha com Esc: o toast cobre o rodapé da tabela enquanto está visível.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss(toast.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toast.id, onDismiss])

  const error = toast.tone === 'error'

  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border px-3 py-2 shadow-lg',
        'bg-[var(--surface)] text-[13px]',
        error ? 'border-removed/50' : 'border-brand-500/50',
      )}
    >
      {error ? (
        <TriangleAlert size={15} className="shrink-0 text-removed" />
      ) : (
        <CheckCircle2 size={15} className="shrink-0 text-brand-500" />
      )}
      <p className="min-w-0 flex-1">{toast.message}</p>
      <IconButton
        label="Dispensar aviso"
        className="size-6 shrink-0"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={13} />
      </IconButton>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam. `ToastHost` e `pushToast` ainda não têm chamador — a Task 7 os liga.

Se `lucide-react` não exportar `CheckCircle2` ou `TriangleAlert` nesta versão, `tsc` acusa; consulte os nomes disponíveis e escolha equivalentes (`Check`, `AlertTriangle`).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Toast.tsx
git commit -m "Toast para avisos efêmeros de ação concluída

Store própria em vez de estado do App: quem avisa é um handler, e
passar prop de aviso por três níveis para uma mensagem de quatro
segundos não se paga."
```

---

### Task 7: Ligar tudo — botão "Salvar"

**Files:**
- Create: `src/hooks/useSaveDocument.ts`
- Modify: `src/components/edit/ChangesBar.tsx` (arquivo inteiro)
- Modify: `src/App.tsx:1-36` (imports), `:91-97` (`ChangesBar`), `:230` (montar `ToastHost`)

**Interfaces:**
- Consumes: `saveDocument`, `SaveOutcome` (Task 4); `commitDocument` (Task 2); `pushToast` (Task 6).
- Produces: `useSaveDocument(): { save: (doc: XmlDocument) => Promise<void>; saving: boolean }`.

- [ ] **Step 1: Criar o hook de orquestração**

Crie `src/hooks/useSaveDocument.ts`:

```ts
import { useCallback, useState } from 'react'
import type { XmlDocument } from '../types/xml'
import { saveDocument } from '../lib/fs/saveDocument'
import { pushToast } from '../components/ui/Toast'
import { useWorkspace } from '../store/useWorkspace'

/**
 * Salvar: gravar, consolidar, avisar.
 *
 * A consolidação acontece só depois da gravação confirmada, e só quando o
 * arquivo de origem foi mesmo escrito. No caminho de download o original
 * continua intocado, então o banner de pendência permanece — limpá-lo ali
 * seria afirmar na tela algo que não aconteceu em disco.
 */
export function useSaveDocument() {
  const [saving, setSaving] = useState(false)
  const commitDocument = useWorkspace((s) => s.commitDocument)

  const save = useCallback(
    async (doc: XmlDocument) => {
      setSaving(true)
      try {
        const outcome = await saveDocument(doc)

        if (outcome.kind === 'saved') {
          commitDocument(doc.id, outcome.bytes)
          pushToast(
            'success',
            outcome.picked
              ? `Salvo em ${outcome.fileName}`
              : 'Alterações salvas com sucesso no arquivo',
          )
        } else if (outcome.kind === 'downloaded') {
          pushToast(
            'success',
            `${outcome.fileName} baixado — substitua o original manualmente.`,
          )
        }
        // `cancelled` não gera aviso: fechar o diálogo não é um erro.
      } catch (error) {
        pushToast(
          'error',
          error instanceof Error ? error.message : 'Não foi possível salvar.',
        )
      } finally {
        setSaving(false)
      }
    },
    [commitDocument],
  )

  return { save, saving }
}
```

- [ ] **Step 2: Trocar "Baixar" por "Salvar" na barra de alterações**

Substitua `src/components/edit/ChangesBar.tsx` inteiro:

```tsx
import { FileWarning, RotateCcw, Save } from 'lucide-react'
import type { XmlDocument } from '../../types/xml'
import { countMixedContent } from '../../lib/xml/serialize'
import { formatInt } from '../../lib/xml/coerce'
import { Button } from '../ui/controls'

interface Props {
  doc: XmlDocument
  editCount: number
  saving: boolean
  onRevertAll: () => void
  onSave: () => void
}

/**
 * Aparece só quando há alterações pendentes, o que já garante o requisito de
 * "salvar habilitado apenas com alterações": não existe barra sem edição.
 *
 * O download não vive mais aqui — ele está no ícone da barra superior, que
 * continua disponível mesmo sem edição nenhuma, porque reexportar um arquivo
 * apenas reindentado é um uso legítimo. Deixar "Baixar" e "Salvar" lado a lado
 * só convidaria ao clique errado.
 */
export function ChangesBar({
  doc,
  editCount,
  saving,
  onRevertAll,
  onSave,
}: Props) {
  const mixed = countMixedContent(doc)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-changed/40 bg-changed/[0.08] px-4 py-2">
      <p className="text-[12.5px]">
        <span className="num font-semibold text-changed">
          {formatInt(editCount)}
        </span>{' '}
        {editCount === 1 ? 'campo alterado' : 'campos alterados'} em memória —
        o arquivo em disco não foi tocado.
      </p>

      {mixed > 0 && (
        <p
          className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]"
          title="Nós com texto e filhos ao mesmo tempo: ao salvar, o texto é escrito antes dos filhos."
        >
          <FileWarning size={13} className="text-changed" />
          {formatInt(mixed)} nó(s) com conteúdo misto serão reordenados na
          gravação
        </p>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRevertAll}
          disabled={saving}
        >
          <RotateCcw size={13} />
          Desfazer tudo
        </Button>
        <Button size="sm" variant="solid" onClick={onSave} disabled={saving}>
          <Save size={13} />
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
```

O `Button` já trata `disabled` com `disabled:pointer-events-none disabled:opacity-40`.

- [ ] **Step 3: Ligar no `App.tsx`**

Três edições em `src/App.tsx`:

1. Imports — acrescente:
```ts
import { useSaveDocument } from './hooks/useSaveDocument'
import { ToastHost } from './components/ui/Toast'
```
`downloadXml` continua importado: a barra superior ainda o usa.

2. No corpo de `App`, junto das outras chamadas de hook:
```ts
  const { save, saving } = useSaveDocument()
```

3. Passar as props novas para a `ChangesBar`:
```tsx
        {doc && editCount > 0 && (
          <ChangesBar
            doc={doc}
            editCount={editCount}
            saving={saving}
            onRevertAll={() => store.revertDocument(doc.id)}
            onSave={() => void save(doc)}
          />
        )}
```

4. Montar o host de toasts como último filho do `<div className="flex h-full flex-col …">`, imediatamente antes do `</div>` que fecha esse container:
```tsx
        <ToastHost />
      </div>
    </DropZone>
```

- [ ] **Step 4: Verificar tipos e lint**

```bash
npm run lint && npm run build
```
Esperado: ambos passam.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSaveDocument.ts src/components/edit/ChangesBar.tsx src/App.tsx
git commit -m "Botão Salvar na barra de alterações

Grava, consolida o baseline e avisa. Como os indicadores de alterado
derivam de edits[docId], consolidar apaga banner, selo, valor riscado
e destaque da célula de uma vez."
```

---

### Task 8: Verificação no navegador e documentação

O que não dá para verificar fora do navegador. Esta tarefa é o portão que decide se a funcionalidade está pronta.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das tarefas 1-7.
- Produces: nada de código.

- [ ] **Step 1: Subir o app**

```bash
npm run dev
```
Abra `http://localhost:5173/` em **Chrome ou Edge** (a File System Access API não existe em Firefox nem Safari).

Antes de começar, faça uma cópia de trabalho — os `samples/` são versionados e não devem ser sobrescritos pelo teste. Deixe-a na raiz do repositório, que é fácil de achar no diálogo do sistema:
```bash
cp samples/nfe-v1.xml teste-salvar.xml
```
Ela é apagada no Step 6. **Não commite este arquivo.**

- [ ] **Step 2: Percorrer o caminho feliz**

1. "Abrir arquivos XML" → selecione `teste-salvar.xml`.
2. Vá em "Tabela", ou selecione um nó na árvore e use a aba "Nó".
3. Edite um campo de texto — por exemplo `xNome`, de `Distribuidora Aurora Ltda` para `Teste Salvar`.
4. **Confira que os quatro indicadores apareceram:** banner superior "1 campo alterado em memória…", selo "alterado" no painel direito, valor de origem riscado abaixo do campo, e a célula com barra e fundo âmbar na tabela.
5. Clique em **Salvar**.

Esperado, tudo junto:
- Um prompt de permissão de escrita do navegador na primeira vez; conceda.
- Toast `Alterações salvas com sucesso no arquivo`.
- **Os quatro indicadores somem.** O banner desaparece inteiro.
- A árvore continua expandida como estava e o nó selecionado continua selecionado.

- [ ] **Step 3: Conferir que o disco mudou**

```bash
grep xNome teste-salvar.xml
```
Esperado: a linha contém `Teste Salvar`. Se ainda contiver `Distribuidora Aurora Ltda`, a gravação não aconteceu e o toast mentiu — pare e investigue antes de seguir.

- [ ] **Step 4: Percorrer os caminhos de erro**

Em Chrome, todo arquivo aberto pela aplicação carrega handle, então o diálogo "Salvar como" só é alcançado depois que um handle é descartado. Os dois casos abaixo formam uma sequência única, nesta ordem.

**4a — falha de gravação.** Com `teste-salvar.xml` aberto e já salvo uma vez, apague o arquivo em disco:
```bash
rm teste-salvar.xml
```
Edite outro campo na interface e clique em Salvar.

Esperado: toast vermelho começando com `Não foi possível salvar:`, e o banner **permanece** com as edições intactas. Nada foi consolidado.

Se em vez do erro o navegador recriar o arquivo e salvar com sucesso, anote o comportamento e vá direto para 4b pelo caminho alternativo — este Chrome não expõe a exclusão, e a mensagem de erro fica coberta apenas pelo teste de permissão negada.

**4b — cancelar o diálogo.** A falha de 4a descartou o handle, então clique em Salvar de novo: agora o diálogo "Salvar como" aparece. Feche-o sem escolher arquivo.

Esperado: **nenhum toast e nenhuma mudança de estado** — banner, selo, valor riscado e destaque da célula todos intactos. Cancelar não é erro.

*Caminho alternativo,* se 4a não produziu erro: comente temporariamente as três linhas do bloco `if (known) { … }` em `src/lib/fs/saveDocument.ts`, o que força todo salvamento pelo diálogo, execute 4b, e **descomente antes de commitar**.

- [ ] **Step 5: Conferir o caminho de download**

Abra `http://localhost:5173/` no **Firefox**. Abra um sample, edite um campo, clique em Salvar.

Esperado:
- O arquivo é baixado com o nome original.
- Toast: `nfe-v1.xml baixado — substitua o original manualmente.`
- **O banner permanece.** O arquivo de origem não foi tocado, e limpar os indicadores ali seria mentir.

- [ ] **Step 6: Limpar e rodar a verificação completa**

```bash
rm -f teste-salvar.xml
npm run smoke && npm run lint && npm run build
git status --short
```
Esperado: as seções `buildProfiles` e `commitEdits` todas `OK`, lint limpo, build sem erro, e `git status` sem `teste-salvar.xml` nem alterações em `samples/`.

- [ ] **Step 7: Documentar no README**

Na seção sobre edição do `README.md`, registre o fluxo novo. Cubra, em prosa que combine com o texto existente:
- "Salvar" grava no arquivo de origem quando o navegador suporta a File System Access API (Chrome, Edge), sem diálogo, se o arquivo foi aberto pelo seletor ou arrastado para a janela.
- Sem handle, o navegador pergunta onde gravar; sem a API, o arquivo é baixado e o aviso de pendência continua, porque o original não mudou.
- Depois de salvar, o arquivo em disco vira a origem: "Desfazer tudo" não volta mais ao conteúdo anterior.
- Nós com conteúdo misto são reordenados na gravação, como já eram na exportação.

Ajuste também a linha 207 (`O download sai com o nome exato do arquivo importado…`) se ela ficar imprecisa com o botão de salvar por perto.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "Documenta o fluxo de salvar no README"
```

---

## Ordem e dependências

```
1 profiles.ts ──┐
                ├──> 2 commit.ts + store ──┐
3 handles.ts ───┼──> 4 saveDocument.ts ────┼──> 7 ChangesBar + App ──> 8 verificação
                └──> 5 pickFiles + DropZone┘
6 Toast ────────────────────────────────────┘
```

As tarefas 3, 4, 5 e 6 não dependem de 1 e 2, e 6 não depende de ninguém — dá para paralelizar se houver mais de um implementador. As tarefas 1→2 e 7→8 são estritamente sequenciais.

## Fora de escopo

Confirmado no spec, não implementar:
- Persistir handles entre recarregamentos da página (exigiria IndexedDB).
- Salvar vários documentos de uma vez. "Salvar" age sobre o documento ativo.
- Detecção de conflito se o arquivo mudar no disco entre abrir e salvar.

## Limitação conhecida

`showSaveFilePicker` e `requestPermission` exigem ativação transitória do usuário, que expira poucos segundos após o clique. `saveDocument` serializa o documento antes de chamar o seletor; em um XML muito grande, essa serialização síncrona pode consumir a ativação e o navegador recusar o diálogo com `SecurityError`. O caminho com handle já concedido não é afetado. Se aparecer na prática, a correção é chamar o seletor antes de serializar.
