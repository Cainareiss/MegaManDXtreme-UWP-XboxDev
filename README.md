# Mega Man DXtreme UWP

> **Port não oficial e não comercial de Mega Man DXtreme para UWP clássico e Xbox Dev Mode.** Este projeto não é um lançamento oficial da CAPCOM, não é afiliado, autorizado nem endossado pela CAPCOM ou pelos criadores de Mega Man DXtreme. A adaptação técnica para UWP/Xbox é mantida por Cainareiss.

Mega Man, Mega Man X, seus personagens, nomes, artes, músicas e demais elementos originais da franquia pertencem à CAPCOM e aos respectivos titulares. O conteúdo original do fangame pertence aos seus criadores. Este repositório não reivindica a autoria desses materiais; os créditos originais exibidos dentro do jogo foram preservados.

## Lançamento

O MSIX x64 e as notas da versão estão na página de [Releases](https://github.com/Cainareiss/MegaManDXtreme-UWP-XboxDev/releases). O projeto usa UWP clássico com `Windows.UI.Xaml` e o WebView do sistema. O alvo mínimo é Windows 10 build 17763, incluindo Xbox Dev Mode.

O port é disponibilizado para preservação e testes não comerciais. Para manter os saves locais, instale uma atualização sobre o aplicativo existente sem desinstalá-lo. A validação em hardware Xbox continua em andamento.

## Compilação

Abra `MegaManDXtreme.sln` no Visual Studio com a carga de trabalho UWP e o Windows 10 SDK instalados. Selecione `Release | x64` para criar um pacote sem assinatura. Certificados privados e senhas ficam somente na máquina de desenvolvimento. Para assinar uma compilação local, informe o caminho do certificado e a senha como propriedades do MSBuild:

```powershell
msbuild MegaManDXtreme.sln /p:Configuration=Release /p:Platform=x64 `
  /p:MegaManDXtremeSigningPfx="C:\caminho\certificado.pfx" `
  /p:MegaManDXtremeSigningPassword="senha-local-do-certificado"
```

## Créditos

Créditos reproduzidos da tela de créditos incluída em Mega Man DXtreme. Os nomes e a grafia foram preservados como aparecem no jogo.

### Mega Man DXtreme

- Direção, programação e roteiro: **Tomycase**
- Design de fases: **Kennen'B', GiaTheRose, SolrenSun, Tomycase**
- Sprites adicionais: **Kennen'B', SolrenSun, Tomycase**
- Música adicional: **mega sfc, kuwata, SolrenSun**
- Testes: **GiaTheRose, SolrenSun, Kennen'B', OmegaZeeZ, TioVoctor, Nautical Nova, Cat Yard, RED1, SlickNickArts**

### Equipe original de Mega Man Xtreme

- Direção: **Ohko13Caz**
- Planejamento: **Shino Okamura**
- Programação: **Hana Yoshimura, Asagiri, Wada, Kenoh (Kubori-Na)**
- Cenários: **Ryutaro's Mama, Yoshio Misaki**
- Personagens: **K23-7219-Toda, Kenichi Miyahara, Ueda & Ando**
- Design original: **Sensei**
- Som: **Toshio Kajino, Saori Maeda**
- Testes: **Nabe Hashimoto and Robayan 75**
- Agradecimentos especiais: **Sadamoto, Inafking, Niida, Komiya, Roy Ozaki**
- Produtor: **Tatsuya Minami**
- Produtor executivo: **Yoshiki Okamoto**

### Port UWP

**Cainareiss** adaptou e mantém o port para UWP clássico e Xbox Dev Mode. Esse crédito não representa autoria do jogo ou dos assets originais.
