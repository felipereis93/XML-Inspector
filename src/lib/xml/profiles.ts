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
