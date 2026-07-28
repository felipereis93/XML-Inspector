/**
 * Verificação do fluxo de salvar, no navegador: `npm run e2e`.
 *
 * O `smoke` cobre o núcleo puro, mas parava na porta do navegador: gravar passa
 * por `showOpenFilePicker`, prompt de permissão e `createWritable`, que são
 * diálogos nativos do sistema — nenhuma automação clica neles. Por isso o
 * caminho mais importante da aplicação ficou sem cobertura até aqui.
 *
 * A saída é injetar um `FileSystemFileHandle` falso antes do primeiro script da
 * página. O restante roda de verdade: seletor, registro do handle, edição,
 * serialização, gravação, consolidação e limpeza dos indicadores. O que se
 * perde é só a camada que o navegador não deixa automatizar; o que se ganha é
 * pegar por comando a regressão que antes só aparecia na tela de alguém.
 *
 * Em `.mjs` e fora do `tsc -b` de propósito: assim `npm run build` não passa a
 * depender do `playwright-core` estar instalado.
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5199
const URL = `http://localhost:${PORT}/`
const XML = readFileSync(join(root, 'samples', 'nfe-v1.xml'), 'utf8')

/* ------------------------------------------------------------------ */
/* Infra                                                               */
/* ------------------------------------------------------------------ */

/**
 * O binário do Chromium não vem no `playwright-core`. Procuramos onde o
 * Playwright normalmente já deixou um, e aceitamos um caminho explícito por
 * variável de ambiente para quem instala fora do padrão.
 */
function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM

  const caches = [
    join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'),
    join(process.env.HOME ?? '', '.cache', 'ms-playwright'),
    join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright'),
  ].filter((dir) => dir && existsSync(dir))

  for (const cache of caches) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium-')) continue
      for (const exe of [
        join(cache, entry, 'chrome-win64', 'chrome.exe'),
        join(cache, entry, 'chrome-win', 'chrome.exe'),
        join(cache, entry, 'chrome-linux', 'chrome'),
        join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ]) {
        if (existsSync(exe)) return exe
      }
    }
  }

  throw new Error(
    'Chromium não encontrado. Rode `npx playwright install chromium` ou ' +
      'aponte PLAYWRIGHT_CHROMIUM para o executável.',
  )
}

async function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL)
      if (res.ok) return proc
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  proc.kill()
  throw new Error(`O dev server não respondeu em ${URL} dentro de 60s.`)
}

/**
 * Handle de escrita falso, instalado antes de qualquer script da página.
 *
 * `modo` decide qual metade da API existe, que é o que separa os três caminhos
 * de `saveDocument`: gravar no handle guardado, abrir "Salvar como", ou cair no
 * download.
 */
function stub(modo) {
  return [
    (args) => {
      const { xml, modo } = args
      window.__escrito = null
      window.__abriuDialogo = false

      const handle = {
        kind: 'file',
        name: 'e2e.xml',
        async getFile() {
          return new File([xml], 'e2e.xml', { type: 'application/xml' })
        },
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async createWritable() {
          return {
            async write(data) {
              window.__escrito = data
            },
            async close() {},
          }
        },
      }

      window.showOpenFilePicker = async () => [handle]

      if (modo === 'semApi') {
        delete window.showSaveFilePicker
        delete window.showOpenFilePicker
      } else if (modo === 'cancela') {
        window.showSaveFilePicker = async () => {
          window.__abriuDialogo = true
          throw new DOMException('cancelado', 'AbortError')
        }
      } else {
        window.showSaveFilePicker = async () => {
          window.__abriuDialogo = true
          return handle
        }
      }
    },
    { xml: XML, modo },
  ]
}

const falhas = []
function conferir(rotulo, ok, detalhe = '') {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${rotulo}${detalhe ? `  ${detalhe}` : ''}`)
  if (!ok) falhas.push(rotulo)
}

const section = (titulo) => console.log(`\n— ${titulo} —`)

/* ------------------------------------------------------------------ */
/* Ações na interface                                                  */
/* ------------------------------------------------------------------ */

async function abrirPeloSeletor(page) {
  await page.getByRole('button', { name: /Abrir arquivos XML/i }).first().click()
  await page.waitForTimeout(1200)
}

async function abrirPeloInput(page) {
  // Sem `showOpenFilePicker` o componente cai no `<input type=file>`.
  await page.setInputFiles('input[type="file"]', {
    name: 'e2e.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(XML, 'utf8'),
  })
  await page.waitForTimeout(1200)
}

/** Edita o primeiro `xNome` pelo painel "Nó" do inspetor. */
async function editarNoInspetor(page, valor) {
  await page.getByRole('button', { name: /Expandir tudo/i }).click()
  await page.waitForTimeout(700)
  await page.locator('[role="treeitem"]').filter({ hasText: 'xNome' }).first().click()
  await page.getByRole('tab', { name: /^Nó$/ }).click()
  await page.waitForTimeout(400)

  const campo = page.locator('aside').last().locator('input').first()
  await campo.click()
  await campo.fill(valor)
  await campo.press('Enter')
  await page.waitForTimeout(600)
}

/** Edita a primeira célula da tabela — duplo clique abre o editor. */
async function editarNaTabela(page, valor) {
  await page.getByRole('tab', { name: /Tabela/i }).click()
  await page.waitForTimeout(1000)
  await page.locator('td').filter({ hasText: /\S/ }).first().dblclick()
  await page.waitForTimeout(400)

  const campo = page.locator('td input').first()
  await campo.fill(valor)
  await campo.press('Enter')
  await page.waitForTimeout(600)
}

const contarBanner = (page) => page.getByText(/alterado em memória/i).count()
const contarSelo = (page) => page.getByText(/^alterado$/i).count()
const textoToast = (page) =>
  page.locator('[role="status"]').innerText().catch(() => '')

async function salvar(page) {
  await page.getByRole('button', { name: /^Salvar$/ }).click()
  await page.waitForTimeout(2000)
}

/* ------------------------------------------------------------------ */
/* Cenários                                                            */
/* ------------------------------------------------------------------ */

async function cenario(browser, { titulo, modo, abrir, editar, esperado }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  const erros = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.addInitScript(...stub(modo))
  await page.goto(URL, { waitUntil: 'networkidle' })

  await abrir(page)
  await editar(page, 'EDITADO PELO E2E')

  section(titulo)
  conferir('banner acende com a edição pendente', (await contarBanner(page)) === 1)
  conferir('selo "alterado" aparece', (await contarSelo(page)) >= 1)

  await salvar(page)

  const banner = await contarBanner(page)
  const selo = await contarSelo(page)
  const escrito = await page.evaluate(() => window.__escrito ?? '')
  const toast = await textoToast(page)

  if (esperado.gravou) {
    conferir('conteúdo foi escrito no arquivo', escrito.length > 0, `${escrito.length} bytes`)
    conferir('o valor editado está no que foi gravado', escrito.includes('EDITADO PELO E2E'))
  } else {
    conferir('nada foi escrito pelo handle', escrito.length === 0)
  }

  conferir(
    `banner ${esperado.limpa ? 'some' : 'permanece'} depois de salvar`,
    esperado.limpa ? banner === 0 : banner === 1,
    `(banner=${banner})`,
  )
  conferir(
    `selo ${esperado.limpa ? 'some' : 'permanece'} depois de salvar`,
    esperado.limpa ? selo === 0 : selo >= 1,
    `(selo=${selo})`,
  )
  conferir(`toast: ${esperado.toast}`, toast.includes(esperado.toast), `(veio "${toast.replace(/\n/g, ' ')}")`)
  conferir('sem erro de runtime na página', erros.length === 0, erros.join(' | '))

  await page.close()
}

/* ------------------------------------------------------------------ */

const server = await startServer()
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--no-sandbox'],
})

try {
  // Caminho principal: handle capturado na abertura grava sem diálogo, a
  // consolidação apaga os quatro indicadores de uma vez.
  await cenario(browser, {
    titulo: 'painel "Nó": salva no handle guardado e limpa os indicadores',
    modo: 'handle',
    abrir: abrirPeloSeletor,
    editar: editarNoInspetor,
    esperado: {
      gravou: true,
      limpa: true,
      toast: 'Alterações salvas com sucesso no arquivo',
    },
  })

  await cenario(browser, {
    titulo: 'tabela: mesma coisa pelo editor de célula',
    modo: 'handle',
    abrir: abrirPeloSeletor,
    editar: editarNaTabela,
    esperado: {
      gravou: true,
      limpa: true,
      toast: 'Alterações salvas com sucesso no arquivo',
    },
  })

  // Sem a API — Firefox e Safari — "Salvar" baixa uma cópia. O arquivo de
  // origem não muda, mas os indicadores limpam do mesmo jeito: ali o download
  // é o único caminho possível, e um aviso que nunca apaga vira ruído. Quem
  // carrega a ressalva é o toast, e por isso o texto dele faz parte do teste.
  await cenario(browser, {
    titulo: 'sem File System Access: baixa, limpa os indicadores e avisa',
    modo: 'semApi',
    abrir: abrirPeloInput,
    editar: editarNoInspetor,
    esperado: {
      gravou: false,
      limpa: true,
      toast: 'baixado — substitua o original manualmente.',
    },
  })
} finally {
  await browser.close()
  server.kill()
}

console.log()
if (falhas.length) {
  console.error(`${falhas.length} verificação(ões) falharam:`)
  for (const f of falhas) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('Tudo OK.')
