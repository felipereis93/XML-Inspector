import type { DocumentEdits, NodeEdit, XmlDocument } from '../../types/xml'
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
 *
 * `fileName` acompanha o "Salvar como": o arquivo escolhido no diálogo passa a
 * ser a origem, e o nome dele precisa aparecer na lista lateral, no rótulo de
 * download e no `suggestedName` do próximo salvamento. Sem o parâmetro o nome
 * original é preservado.
 */
export function commitEdits(
  doc: XmlDocument,
  edits: DocumentEdits | undefined,
  bytes: number,
  fileName?: string,
): XmlDocument {
  const applied = applyEdits(doc, edits) ?? doc
  return {
    ...applied,
    bytes,
    fileName: fileName ?? applied.fileName,
    profiles: buildProfiles(applied.nodes),
  }
}

/**
 * O que continua pendente depois de consolidar `committed`.
 *
 * Gravar é assíncrono: entre o clique e o fim da escrita o usuário pode editar
 * mais. Essas edições posteriores **não** foram para o disco, então apagar o
 * overlay inteiro na volta as promoveria a baseline sem que existissem no
 * arquivo — o indicador de "alterado" apagaria e o valor sumiria em silêncio.
 *
 * Por isso a subtração é por chave e por conteúdo: um nó só sai do overlay se
 * o que está lá agora for igual ao que foi gravado. Qualquer nó reeditado
 * depois do snapshot permanece, e o banner continua aceso.
 *
 * A comparação é campo a campo, e não `JSON.stringify`, porque não depende da
 * ordem em que as chaves de `attrs` foram inseridas — `writeEdit` preserva a
 * ordem hoje, mas isso é detalhe de implementação e não uma garantia.
 */
export function remainingEdits(
  current: DocumentEdits,
  committed: DocumentEdits | undefined,
): DocumentEdits {
  if (!committed) return current

  const out: DocumentEdits = {}
  for (const key of Object.keys(current)) {
    const id = Number(key)
    const done = committed[id]
    if (done !== undefined && sameEdit(current[id], done)) continue
    out[id] = current[id]
  }
  return out
}

function sameEdit(a: NodeEdit, b: NodeEdit): boolean {
  if (a === b) return true
  if (a.value !== b.value) return false
  return sameAttrs(a.attrs, b.attrs)
}

function sameAttrs(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true
  const keys = a ? Object.keys(a) : []
  if (keys.length !== (b ? Object.keys(b).length : 0)) return false
  return keys.every((key) => a?.[key] === b?.[key])
}
