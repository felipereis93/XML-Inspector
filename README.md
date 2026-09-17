# Prisma XML

Visualizador e analisador de XML. Abre vários arquivos, navega a estrutura,
filtra registros, totaliza qualquer campo numérico e compara duas versões
lado a lado. Edita valores e atributos e grava de volta no arquivo de origem.
O XML em si nunca sai da máquina — só passa pela API local o necessário para
autenticação.

Acesso é por login. Existe uma conta de administrador, que é quem aprova
(ou cria diretamente) as demais contas — ver "Login e usuários" abaixo.

```bash
npm install
npm run dev      # sobe API (:5174) e frontend (:5173) juntos — http://localhost:5173
npm run smoke    # confere parser, totais, filtros e diff nos XMLs de samples/
npm run e2e      # confere o fluxo de salvar num navegador de verdade

# Diagnóstico de um arquivo real, sem abrir o navegador:
npx tsx scripts/diagnose.ts "D:\caminho\ARQUIVO.XML"
```

## Login e usuários

Na primeira vez que a API sobe (`npm run dev` ou `npm run server`), sem
nenhum usuário no banco, ela cria a conta de administrador e imprime a senha
gerada **uma única vez** no terminal:

```
──────────────────────────────────────────────
 Conta de administrador criada
 usuário: admin
 senha:   <gerada aleatoriamente>
 Troque a senha assim que possível.
──────────────────────────────────────────────
```

Para fixar usuário/senha do admin em vez de gerar (útil em CI ou para
recriar um ambiente), defina `ADMIN_USERNAME`/`ADMIN_PASSWORD` antes de subir
a API pela primeira vez — só tem efeito enquanto a tabela de usuários está
vazia.

Qualquer pessoa pode pedir uma conta pela tela de login ("Solicitar
acesso"), mas ela nasce **pendente** e não consegue entrar até um admin
aprovar. O botão "Usuários" na barra superior (só visível para admin) lista
todas as contas e permite aprovar, bloquear, promover a admin ou excluir —
e também criar uma conta diretamente, já ativa. Ninguém altera a própria
conta por ali, para não haver risco de autobloqueio.

Sessão é um cookie httpOnly de 7 dias; sair invalida a sessão no servidor.

## Publicar em produção

O frontend (`dist/`) e a API (`server/`) são publicados em lugares
diferentes — o GitHub Pages só serve arquivo estático, não roda o processo
Node da API.

**Frontend, no GitHub Pages.** `.github/workflows/deploy-pages.yml` builda e
publica a cada push em `main` (exige, uma única vez, trocar em *Settings >
Pages > Build and deployment > Source* para "GitHub Actions"). `vite.config.ts`
já sai com `base: '/XML-Inspector/'` no build — sem isso os assets carregam
relativos à raiz do domínio, não à subpasta da página de projeto, e a página
fica em branco.

**API, em qualquer host que rode um processo Node persistente com disco**
(Render, Fly.io, Railway, uma VPS — a escolha é sua; o `Dockerfile` na raiz
funciona em qualquer um deles). Variáveis que importam nesse ambiente:

| Variável | Para quê |
| --- | --- |
| `PORT` | Porta que a API escuta — a maioria das plataformas injeta sozinha. |
| `DB_PATH` | Caminho do arquivo SQLite. Aponte para um volume persistente (`/data/app.db` no `Dockerfile`), senão o banco some a cada redeploy. |
| `ALLOWED_ORIGIN` | Origem do frontend publicado (`https://felipereis93.github.io`). Sem isso a API assume mesma origem e nenhum pedido de outro domínio consegue ler a resposta — é o que habilita CORS e troca o cookie de sessão para `SameSite=None; Secure`, necessário porque frontend e API vivem em domínios diferentes. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Opcional, fixa a conta de admin em vez de gerar senha aleatória no primeiro boot. |

Com a API no ar, aponte o build do frontend para ela: crie a variável de
repositório `API_URL` (*Settings > Secrets and variables > Actions >
Variables*) com a URL pública da API, e rode o workflow de novo (push ou
"Run workflow" manual). Sem essa variável o build sai apontando para `/api`
relativo — a página carrega, mas login fica indisponível, porque não há
nada respondendo em `/api` na origem do Pages.

```bash
docker build -t xml-inspector-api .
docker run -p 5174:5174 \
  -v xml-inspector-data:/data \
  -e ALLOWED_ORIGIN=https://felipereis93.github.io \
  xml-inspector-api
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
| `express` | API de autenticação | Único servidor HTTP do projeto (`server/`); login, cadastro e administração de usuários. |

Não usamos `diff` nem `jsdiff`: o comparador é estrutural (ver abaixo).
Comparar XML como texto reporta reindentação como mudança.

## Estrutura

```
server/
  db.ts                     abre o SQLite (node:sqlite) e cria as tabelas
  seed.ts                   cria a conta de administrador no primeiro boot
  auth.ts                   hash de senha (scrypt) e sessão (token + cookie)
  index.ts                  rotas Express: /api/auth/*, /api/admin/users
src/
  types/
    xml.ts                  modelo de dados (nós planos, perfis, filtros, diff)
    file-system-access.d.ts tipos da File System Access API
  lib/
    cn.ts                   composição de classes
    download.ts             âncora temporária para baixar um blob
    parsePool.ts            pool de Web Workers para parsing
    auth/api.ts             cliente fetch da API de autenticação
    fs/
      fileTypes.ts          extensões aceitas, compartilhadas por abrir e salvar
      pickFiles.ts          seletor e drop, capturando o handle de escrita
      handles.ts            registro de handles por documento + permissão
      saveDocument.ts       grava no arquivo de origem, ou pergunta, ou baixa
    xml/
      coerce.ts             texto -> número/data + formatação pt-BR
      parse.ts              XML -> documento plano
      profiles.ts           nós -> perfis de caminho (tipos, faixas, repetição)
      flatten.ts            árvore -> linhas visíveis; serialização de volta
      search.ts             busca global e fatiamento para realce
      schema.ts             detecção de esquema embutido (DATAPACKET)
      fields.ts             índice único de campos (atributos + tags)
      filters.ts            filtros por nome de campo
      edits.ts              overlay de edições e documento efetivo
      commit.ts             overlay -> baseline depois de gravar
      serialize.ts          documento -> string XML indentada + download
      stats.ts              soma/média/mín/máx/contagem e agrupamento
      table.ts              nós repetidos -> tabela dinâmica + CSV
      diff.ts               comparação estrutural entre dois documentos
  workers/parse.worker.ts   parsing fora da thread principal
  store/
    useWorkspace.ts         estado da aplicação
    useToasts.ts            fila de avisos efêmeros
    useAuth.ts              sessão do usuário logado
  hooks/
    useXmlAnalysis.ts       busca+filtros, agregação, tabela e diff memoizados
    useSaveDocument.ts      gravar -> consolidar -> avisar
    useDebounced.ts         atraso da busca
  components/
    layout/                 lista de documentos, inspetor de nó
    upload/DropZone.tsx     soltar arquivo na janela inteira + seletor
    edit/                   barra de alterações (salvar/desfazer) e campo editável
    tree/TreeView.tsx       árvore virtualizada
    table/NodeTable.tsx     tabela dinâmica virtualizada
    diff/DiffView.tsx       comparador lado a lado / em linha
    metrics/MetricsPanel.tsx  cards de totais e quebra por chave
    filters/FilterPanel.tsx   construtor de filtros
    auth/                   tela de login e painel de administração de usuários
    ui/                     controles, realce, régua de profundidade, toast
  AuthGate.tsx              login ou app, a partir da sessão
  App.tsx                   shell de três painéis
```

## Decisões que valem o comentário

**A árvore é um array plano.** Cada nó guarda `parent`, `children` e `path`, e é
referenciado por índice. Isso permite virtualizar, filtrar e agregar em O(n) sem
recursão, e transferir o documento do worker por structured clone sem custo de
ponteiro.

**Perfis de caminho.** `buildProfiles` percorre os nós uma vez e devolve um
perfil por caminho: quantas ocorrências, quantas numéricas, quantas de data,
mínimo, máximo, atributos vistos e se a tag se repete sob o mesmo pai. É daí que
saem, sem nenhuma configuração, a lista de campos totalizáveis e a lista de
tabelas candidatas. Ele mora em `lib/xml/profiles.ts`, separado do parser,
porque não é chamado só na abertura: consolidar uma gravação também refaz os
perfis, e depender de reparsear o arquivo para isso seria absurdo.

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

**Salvar escreve no arquivo de origem.** O botão "Salvar" da barra de alterações
grava o documento efetivo por cima do arquivo aberto, através da File System
Access API — hoje Chrome e Edge. O handle de escrita é capturado no próprio
gesto de abertura, tanto no seletor quanto no arquivo solto sobre a janela,
porque é a única oportunidade: não há como pedir depois o handle de um `File`
que já se tem em mãos. Com o handle guardado a gravação não abre diálogo nenhum;
o navegador pode pedir permissão de escrita na primeira vez.

Sem handle — a página foi recarregada, ou o arquivo chegou por um caminho que
não entrega handle — o navegador pergunta onde gravar, e o arquivo escolhido
passa a ser a origem: o nome dele substitui o antigo na lista lateral e no
rótulo de download, e os salvamentos seguintes vão para ele sem perguntar de
novo. Onde a API não existe (Firefox, Safari) o caminho é o download.

O download **também limpa os indicadores**, e vale explicar por quê: nesses
navegadores ele é o único caminho possível, então um aviso de pendência que
nunca apaga deixaria de sinalizar qualquer coisa. Quem carrega a ressalva é o
toast — `arquivo.xml baixado — substitua o original manualmente.` —, porque o
arquivo de origem de fato não mudou. É uma troca deliberada de precisão por
utilidade, e a alternativa foi testada em uso real antes da escolha.

Depois de uma saída confirmada as edições saem do overlay e viram o novo
baseline. Banner, selo, valor riscado e destaque de célula apagam de uma vez,
sem que nenhum componente precise saber que houve um salvamento — todos eles
nascem da comparação entre documento e overlay. A contrapartida é que "Desfazer
tudo" passa a valer a partir do que está em disco: não existe volta ao conteúdo
anterior à gravação. E só o overlay fotografado no instante do clique é
consolidado; o que for editado enquanto a escrita acontece continua pendente,
porque não entrou no arquivo.

Nós com conteúdo misto (texto e filhos juntos) são reordenados na gravação, com
o texto antes dos filhos — o mesmo que já acontecia na exportação. A barra de
alterações diz quantos são antes de salvar.

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
- O download da barra superior sai com o nome exato do arquivo importado e não
  sobrescreve nada: se já existir um arquivo com esse nome na pasta de
  downloads, o navegador salva como `nome (1).xml`. Escrever por cima do
  original é o que faz o botão "Salvar", e só onde a File System Access API
  existe.
- O diálogo nativo do sistema — o seletor de arquivo e o prompt de permissão —
  não abre em navegador headless, e nenhuma automação clica nele. `npm run e2e`
  contorna isso injetando um `FileSystemFileHandle` falso antes do primeiro
  script da página: o seletor, o registro do handle, a edição, a serialização,
  a gravação e a limpeza dos indicadores rodam de verdade, e só a camada que o
  navegador não deixa automatizar fica de fora. O que continua sem cobertura é
  a permissão de escrita concedida pelo usuário e o `createWritable` real.
- A exportação é equivalente em conteúdo, não byte a byte: o parser descarta
  comentários e normaliza espaço em branco, então o arquivo sai reindentado.
  Em nós com conteúdo misto (texto e filhos juntos) o texto é escrito antes dos
  filhos; a interface avisa quando o documento tem algum. Vale igual para a
  gravação — salvar reescreve o arquivo inteiro a partir da árvore em memória.
- As edições vivem em memória, e o handle de escrita também. Recarregar a página
  perde o rascunho e desfaz o vínculo com o arquivo: salve antes de fechar, e
  saiba que o primeiro "Salvar" depois de recarregar volta a perguntar onde
  gravar.
