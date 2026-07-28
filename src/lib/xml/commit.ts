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
