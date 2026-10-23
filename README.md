# Gestão Patrimonial — demonstração DeLunaTech

Edição pública de demonstração para hospedagem estática (por exemplo, GitHub Pages). A aplicação abre diretamente, sem login, Firebase, Firestore ou sincronização remota.

## Armazenamento e privacidade

- Os registros são gravados em `localStorage` no navegador atual.
- Os dados não são enviados a um banco de dados da DeLunaTech.
- Cada navegador/dispositivo possui sua própria base local.
- Limpar os dados do site no navegador pode apagar os registros. Use dados fictícios na demonstração.
- A aplicação não oferece recuperação remota nem sincronização entre dispositivos.

## Publicação

1. Envie o conteúdo desta pasta para o repositório do GitHub Pages.
2. Ative GitHub Pages para a branch/pasta publicada.
3. Abra o endereço publicado e teste cadastro, consulta, transferência, baixa e relatórios.

## Identidade visual

A interface usa a paleta DeLunaTech (azul profundo `#0A1E4A`, azul tech `#0066FF`, ciano `#00D1FE`, azul claro `#4DD0FF`, branco e cinzas). O emblema da empresa é usado na marca do cabeçalho. O ícone de instalação é exclusivo da aplicação patrimonial e usa uma representação geométrica de inventário, não o emblema oficial.

## Limitações conhecidas

- O armazenamento local é específico do navegador e não é um banco central.
- A leitura/importação de planilhas usa a biblioteca SheetJS via CDN e, por isso, requer conexão com a internet para carregar essa funcionalidade se ela não estiver em cache.
- Esta versão é demonstrativa; não deve ser usada para guardar dados patrimoniais reais ou sensíveis.
