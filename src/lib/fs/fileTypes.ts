/**
 * Tipos de arquivo dos diálogos do sistema, em um lugar só.
 *
 * Abrir e salvar precisam concordar: um `dados.nfe` aberto pelo seletor e
 * depois levado ao "Salvar como" receberia um diálogo que só aceita `.xml`, e
 * o navegador trocaria a extensão do arquivo sem perguntar.
 *
 * A lista compartilhada é mais simples do que derivar a extensão de
 * `doc.fileName`: derivar exigiria mapear cada extensão ao seu MIME (`.svg` é
 * `image/svg+xml`, o resto é `application/xml`) e ainda deixaria as duas telas
 * livres para divergir de novo na próxima extensão adicionada.
 */
export const XML_FILE_TYPES: FilePickerAcceptType[] = [
  {
    description: 'Arquivos XML',
    accept: {
      'application/xml': ['.xml', '.nfe', '.xsd', '.rss', '.kml'],
      'image/svg+xml': ['.svg'],
    },
  },
]
