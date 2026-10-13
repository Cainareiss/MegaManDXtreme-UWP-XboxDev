# Mega Man DXtreme UWP 1.0.9.0 - Port nao oficial

Port NAO OFICIAL e nao comercial de Mega Man DXtreme para UWP classico e Xbox Dev Mode, mantido por Cainareiss. Nao e afiliado, autorizado ou endossado pela CAPCOM ou pela equipe original do fangame.

## Correcoes

- Restauracao do save iniciada pelo host apos o carregamento da pagina, eliminando a dependencia de uma notificacao JavaScript enviada durante a navegacao.
- Confirmacao explicita da restauracao antes de liberar a inicializacao e a gravacao de progresso.
- Erros da ponte ou da restauracao exibidos diretamente, evitando espera silenciosa pelo timeout de 90 segundos nesses casos.
- Protecao contra restauracoes simultaneas e testes de inicializacao antes/depois da restauracao.

## Download e instalacao

- `MegaManDXtreme_1.0.9.0_x64.msix`: aplicativo assinado para PC e Xbox Dev Mode.
- `MegaManDXtreme_1.0.9.0_x64_Dependencies.zip`: dependencias x64 geradas pelo build; use as necessarias no Device Portal.
- `MegaManDXtreme_1.0.9.0_x64.cer`: certificado PUBLICO para instalacao no PC. Nenhuma chave privada esta incluida.

Atualize sobre o aplicativo existente sem desinstalar para preservar os saves locais. A identidade do aplicativo foi mantida.

## Validacao

- MSBuild Release x64: 0 erros e 0 avisos.
- Testes automatizados de persistencia e inicializacao: passaram.
- Assinatura criptografica do pacote e arquivos JS/HTML embutidos: verificados.
- Instalacao e abertura no PC: confirmadas; log registrou progresso 100%, runtime confirmado e "Jogo carregado".
- Xbox: a correcao ainda precisa ser testada no console. O timeout relatado nao prova, sozinho, que esta era a unica causa.
- O pacote usa certificado autoassinado; a instalacao no PC exige confiar no certificado publico.

SHA-256 do MSIX: `7FA7950C8CD85C4B938DE543F0C443CF7D9BA3E38A5DDB67058EB62BEA268EF8`.

## Creditos

Mega Man DXtreme:

- Direcao, programacao e roteiro: **Tomycase**.
- Design de fases: **Kennen'B', GiaTheRose, SolrenSun, Tomycase**.
- Sprites adicionais: **Kennen'B', SolrenSun, Tomycase**.
- Musica adicional: **mega sfc, kuwata, SolrenSun**.
- Testes: **GiaTheRose, SolrenSun, Kennen'B', OmegaZeeZ, TioVoctor, Nautical Nova, Cat Yard, RED1, SlickNickArts**.

Mega Man, Mega Man X e os personagens, arte, musica e elementos originais da franquia pertencem a CAPCOM e aos respectivos titulares. O conteudo original do fangame pertence aos seus criadores; os creditos originais dentro do jogo foram preservados.

Os creditos completos, incluindo a equipe original de Mega Man Xtreme, estao no [README](https://github.com/Cainareiss/MegaManDXtreme-UWP-XboxDev#cr%C3%A9ditos).
