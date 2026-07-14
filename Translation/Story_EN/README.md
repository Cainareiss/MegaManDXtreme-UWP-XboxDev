# Roteiro para traducao

Esta pasta fica fora de `GameFiles` e nao entra no pacote MSIX.

O roteiro completo vem de `GameFiles/Dialogues.xml`:

- `dialogues_en.json`: fonte canonica para a futura importacao.
- `dialogues_en.csv`: versao para editar em planilha.
- `dialogues_en.txt`: versao confortavel para leitura.

Os arquivos `context_en.*` contem textos narrativos auxiliares encontrados em
event sheets, telas, tutoriais e creditos. Eles ajudam a evitar que algum texto
relacionado fique de fora, mas nao substituem `dialogues_en.*`.

Preencha somente o campo/coluna `portuguese`. Nao altere `id`, `dialogue`,
`line`, `occurrence` ou `speaker`. Preserve comandos como `<C ...>` e
`<TW ...>`, alem das quebras de linha, na traducao em portugues.

O XML original possui duas falas com o mesmo ID em `Confronts Techno-2`.
`occurrence` diferencia essas duas entradas sem descartar texto.
