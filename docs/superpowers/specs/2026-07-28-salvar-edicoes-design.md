# Salvar edições no arquivo

Data: 2026-07-28
Status: aprovado, pronto para plano de implementação

## Problema

Editar um campo no Prisma XML marca a alteração em quatro lugares — banner
superior, badge "alterado" no inspetor, valor original riscado, destaque da
célula na tabela — mas não há como confirmar a edição. O único caminho de saída
é "Baixar", que joga uma cópia na pasta de Downloads e deixa o usuário
substituir o original na mão.

Falta o passo que fecha o fluxo: gravar no arquivo de origem e limpar os
indicadores de pendência.

## Restrição de partida

O Prisma XML roda inteiramente no navegador. Não há backend nem banco de dados,
e a tela inicial promete "Nada sai do seu navegador". Arquivos entram por
`<input type=file>` e drag-drop, que entregam objetos `File` somente-leitura —
nenhum caminho de escrita existe hoje.

**Decisão:** usar a File System Access API. Arquivos abertos pelo seletor do
sistema (`showOpenFilePicker`) ou soltos na janela (`getAsFileSystemHandle`)
carregam um handle de escrita, e "Salvar" grava por cima do original sem
diálogo. A promessa de privacidade continua intacta: nada trafega pela rede.

Onde a API não existe (Firefox, Safari) ou o handle não está disponível, o
comportamento degrada em dois passos: `showSaveFilePicker` quando o navegador
suporta — e o handle escolhido passa a valer para os próximos saves — senão
download, com o toast dizendo que baixou e não que salvou.

## Decisão central: qual documento vira o baseline

Nenhum dos quatro indicadores tem estado próprio. Todos derivam de
`edits[docId]` comparado com `docs`, o documento original. Limpar o status é,
portanto, decidir qual documento passa a ser o baseline.

A escolha foi **consolidar o overlay**: após gravação confirmada,
`docs[i] = applyEdits(doc, edits)` e `edits[docId]` é apagado. Os quatro
indicadores somem juntos sem que nenhum componente de exibição seja tocado.
Custa uma passagem O(n) sobre o array de nós, sem worker; os ids de nó não
mudam, então árvore expandida, nó selecionado e scroll ficam onde estavam.

Junto disso, `bytes` e `profiles` são recalculados. Sem isso, a defasagem de
perfis que hoje é temporária — documentada em `edits.ts:183` como aceitável
durante a edição — viraria permanente, e as sugestões de faixa e amostras dos
filtros passariam a descrever um arquivo que não existe mais.

### Alternativas descartadas

**Reparsear o arquivo escrito.** Fidelidade total com o disco, inclusive a
reordenação de conteúdo misto que o serializador aplica. Descartada pelo custo:
reparse a cada save, perceptível em arquivos grandes, e ids de nó que podem
mudar — perdendo expansão, seleção e scroll a cada salvamento.

**Flag `saved` por documento.** Espalharia a condição por cinco componentes e
deixaria o overlay "alterado" vivo na store, pronto para reaparecer de forma
inconsistente na edição seguinte.

### Limitação aceita

Consolidar diverge do disco em um caso: nós com conteúdo misto (texto e filhos
no mesmo nó), que o serializador reordena ao escrever. Essa divergência já
existe hoje na exportação e a `ChangesBar` já avisa sobre ela; o aviso continua
cobrindo o caso. Para NF-e e DATAPACKET, os formatos-alvo, a contagem é zero.

### Consequência aceita

Depois de salvar, "Desfazer tudo" não volta ao conteúdo pré-save. O arquivo em
disco passou a ser a origem. É a semântica normal de salvar, e é irreversível.

## Arquitetura

O I/O de arquivo fica fora da store e fora dos componentes. A store faz apenas
uma transição de estado pura, o que a mantém verificável em `scripts/smoke.ts`
sem navegador — como o resto do núcleo já é.

### Módulos novos

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `src/lib/fs/handles.ts` | Registro `docId → FileSystemFileHandle`; `supportsFileSystemAccess()`; `ensureWritable()` | browser |
| `src/lib/fs/pickFiles.ts` | `pickXmlFiles()` via `showOpenFilePicker`, com queda para o `<input>` atual; `handlesFromDrop()` via `getAsFileSystemHandle()` | `handles.ts` |
| `src/lib/fs/saveDocument.ts` | `saveDocument(doc): Promise<SaveOutcome>` | `serialize`, `download`, `handles` |
| `src/hooks/useSaveDocument.ts` | Orquestra save → commit → toast; expõe `{ save, saving }` | os acima + store |
| `src/components/ui/Toast.tsx` | `useToasts` (zustand) + `<ToastHost/>`, auto-dismiss 4s | — |

O registro de handles é um `Map` de módulo, não estado zustand: handles são
objetos de browser não-clonáveis e nenhum componente renderiza a partir deles.
A decisão "tenho handle ou não" acontece no clique, não no render.

### Contrato de `saveDocument`

```ts
type SaveOutcome =
  | { kind: 'saved'; fileName: string; bytes: number; picked: boolean }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'cancelled' }
```

`kind: 'saved'` cobre os dois caminhos que realmente escrevem em disco — o
handle guardado e o `showSaveFilePicker`. `picked` distingue os dois apenas
para escolher a mensagem do toast. `kind: 'downloaded'` é só a queda para
navegadores sem a API, e não carrega `bytes` porque não consolida.

Serializa uma vez e devolve `bytes` para que `commitDocument` não precise
serializar de novo. Erros de gravação são propagados como exceção; cancelamento
é um desfecho normal, não um erro.

### Alterações em arquivos existentes

- **`src/lib/xml/parse.ts`** — extrair `buildProfiles(nodes)`. O helper
  `profile()` já existe (linha 195); `parseXml` passa a chamá-lo no fim, em uma
  passagem só, em vez de dentro do laço de traversal. Elimina a duplicação que
  existiria entre parse e commit ao custo de uma passagem O(n) adicional no
  parse.
- **`src/store/useWorkspace.ts`** — `commitDocument(docId, bytes)`:
  `docs[i] = { ...applyEdits(doc, edits), bytes, profiles: buildProfiles(nodes) }`
  e `delete edits[docId]`. Sem I/O.
- **`src/store/useWorkspace.ts`** — `addFiles(files, handles?)` ganha segundo
  parâmetro opcional `Map<File, FileSystemFileHandle>` e registra o handle por
  `doc.id` após o parse. A assinatura continua compatível com as props
  `(files: File[]) => void` existentes, então `DocumentList` e `Landing` não
  mudam.
- **`src/components/upload/DropZone.tsx`** — `FilePicker` usa `pickXmlFiles()`;
  o handler de drop coleta handles via `getAsFileSystemHandle()`. Ambos com
  detecção de feature e queda para o caminho atual.
- **`src/components/edit/ChangesBar.tsx`** — "Baixar" sai, "Salvar" entra como
  ação primária ao lado de "Desfazer tudo". Durante a gravação vira "Salvando…"
  desabilitado. O aviso de conteúdo misto permanece.
- **`src/App.tsx`** — monta `<ToastHost/>` e liga `useSaveDocument` à
  `ChangesBar`.

O download continua disponível no ícone da barra superior, que já existe e
funciona mesmo sem edição nenhuma — reexportar um arquivo apenas reindentado
segue sendo um uso legítimo.

## Fluxo de dados

```
[Salvar] → saveDocument(doc)
             ├── serializeDocument(doc)              → xml, bytes
             ├── handleFor(doc.id) → ensureWritable  → grava no arquivo original
             ├── sem handle, com suporte → showSaveFilePicker → grava + guarda handle
             └── sem suporte             → downloadXml
                   ↓
              SaveOutcome
                   ├─ saved      → commitDocument(doc.id, bytes) → pushToast
                   ├─ downloaded → pushToast, SEM commit (ver abaixo)
                   ├─ cancelled  → nada (nem toast, nem mudança de estado)
                   └─ throw      → pushToast(erro), edições intactas
```

### Por que o download não consolida

Consolidar significa afirmar que o arquivo de origem contém as edições. No
caminho de download isso é falso: uma cópia foi para a pasta de Downloads e o
original continua intocado. Limpar os indicadores ali seria mentir na tela pelo
mesmo motivo que o toast não diz "salvo".

O preço é que, em Firefox e Safari, o banner de pendência permanece depois de
baixar. Isso é a verdade do estado: o arquivo em disco realmente não foi
atualizado. Quem quiser zerar tem "Desfazer tudo". É também o comportamento
atual do botão "Baixar", que nunca limpou nada — nenhuma regressão.

Como os quatro indicadores derivam de `edits[docId]`, `commitDocument` os apaga
de uma vez:

- o banner desmonta, porque `editCount > 0` vira falso em `App.tsx:91`;
- o badge "alterado" e o valor riscado somem do `NodeInspector`, porque
  `isFieldEdited()` e `isNodeEdited()` passam a retornar falso;
- a célula perde `border-l-changed bg-changed/[0.08]` em `NodeTable.tsx:271`;
- o realce da linha some do `TreeView` (`TreeView.tsx:158`).

Nenhum desses arquivos precisa ser editado.

O botão fica habilitado apenas com alterações pendentes por construção: a
`ChangesBar` inteira só é montada quando `editCount > 0`. Durante a gravação,
`saving` o desabilita.

## Tratamento de erro

A regra que governa tudo: **só consolidar o baseline depois de uma gravação
confirmada.** Enquanto `write()`/`close()` não retornar, as edições continuam
intactas no overlay — um save que falha deixa o usuário exatamente onde estava.

| Situação | Como chega | Resposta |
|---|---|---|
| Usuário fecha o diálogo | `AbortError` de `showSaveFilePicker` | Silêncio. Sem toast, sem mudança de estado. |
| Permissão de escrita negada | `ensureWritable()` → `false` | Toast de erro: "Permissão de escrita negada para `arquivo.xml`." |
| Arquivo movido, apagado ou bloqueado | `NotFoundError` / `NoModificationAllowedError` | Toast de erro com o motivo; handle descartado do registro, próximo save reabre o diálogo. |
| Disco cheio ou falha de I/O | throw genérico | Toast de erro: "Não foi possível salvar: `<message>`." |
| Navegador sem a API | `supportsFileSystemAccess()` → `false` | Baixa, e o toast diz que baixou. |

`ensureWritable` merece atenção: handles vindos de `showOpenFilePicker` nascem
com permissão de leitura, e `requestPermission({ mode: 'readwrite' })` dispara
um prompt que **exige gesto do usuário**. A chamada acontece dentro do handler
do clique, nunca depois de um `await` que quebre a cadeia de ativação.

## Mensagens do toast

| Desfecho | Texto |
|---|---|
| Gravou no arquivo original | `Alterações salvas com sucesso no arquivo` |
| Gravou via "Salvar como" | `Salvo em nome-escolhido.xml` |
| Caiu para download | `arquivo.xml baixado — substitua o original manualmente.` |

O caso de download não diz "salvo". O arquivo em disco não foi tocado, e um
toast que mente sobre isso custa caro quando o usuário fecha a aba.

## Verificação

O projeto não tem framework de testes; o núcleo é verificado por
`scripts/smoke.ts`, um script `tsx` que roda fora do navegador e imprime
resultados para conferência. A verificação segue esse padrão.

### Em `scripts/smoke.ts` (lógica pura)

- `buildProfiles(nodes)` sobre um documento recém-parseado reproduz exatamente
  o `doc.profiles` que `parseXml` produziu — prova que a extração não mudou
  comportamento.
- `commitDocument`: documento + 3 edições → valores novos nos nós certos,
  `edits` vazio, `countEdits() === 0`, `isFieldEdited()` falso em todos os
  alvos, `bytes` igual ao tamanho do XML serializado.
- Round-trip: `serializeDocument(commit(doc, edits))` idêntico a
  `serializeDocument(applyEdits(doc, edits))` — consolidar não altera a saída.
- Idempotência: commitar sem edições pendentes não muda o documento.

### No navegador (o que só existe lá)

- Editar um campo → banner aparece → Salvar → os quatro indicadores somem
  juntos e o toast aparece.
- Reabrir o arquivo salvo e conferir que o valor novo está lá.
- Cancelar o diálogo → nada acontece, edições preservadas.
- Em navegador sem a API, Salvar baixa, o toast diz "baixado" e o banner
  permanece.

## Fora de escopo

- Persistir handles entre recarregamentos da página (exigiria IndexedDB).
- Salvar vários documentos de uma vez. "Salvar" age sobre o documento ativo.
- Detecção de conflito se o arquivo mudar no disco entre abrir e salvar.
