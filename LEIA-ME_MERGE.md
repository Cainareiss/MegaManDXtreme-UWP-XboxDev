# Mega Man DXtreme — UWP 100% nativo (v4.0, mesclado)

Este projeto mescla:
- **`MegaManDXtreme_UWP_Final`**: a base arquitetural correta (WebView clássico
  do UWP — `Windows.UI.Xaml.Controls.WebView`, sem WebView2/WinUI3/Windows App SDK).
  É essa base que fica, porque WebView2 é a causa mais provável dos crashes
  no Xbox (depende do runtime Edge Chromium + Windows App SDK, historicamente
  instável em Xbox Dev Mode).
- **`MegaManDXtreme_src_ARM64`**: de onde vieram os *recursos* que valiam a
  pena preservar, adaptados para rodar sem WebView2.

## O que foi trazido da versão WebView2/WinUI3 e adaptado

| Recurso | Como foi adaptado |
|---|---|
| `AppLogger.cs` (log persistente em `LocalState/app.log` + `Logs/crash_*.log`) | Copiado sem alterações — só usa `Windows.Storage`, 100% compatível com UWP clássico. Agora é chamado em toda a `MainPage` e `App`. |
| Timeout de 20s no carregamento | Reimplementado com `Task.Delay` + `CancellationTokenSource`, chamando `ShowError` se `GAME_READY` não chegar a tempo. |
| Protocolo de mensagens em JSON (`type: vibrate/saveState/loadState/forceReload/crashLog/log`) | Mantido, mas o transporte mudou de `chrome.webview.postMessage` (WebView2) para `window.external.notify(JSON.stringify(...))` (`ScriptNotify` no C#), que é o único canal que o WebView clássico oferece. |
| Correções de gameplay do `xbox-bridge.js` v3.2 (mapeamento de botões X/Y/LB/RB/LT/RT corrigido, stick analógico direito, `forceGamepadDetection` com `GamepadEvent` real, reuso do `AudioContext`) | Todas preservadas no `GameFiles/xbox-bridge-uwp.js` mesclado. |
| Fullscreen explícito para Xbox | Adicionado `ApplicationView.TryEnterFullScreenMode()` (equivalente UWP clássico ao `AppWindowPresenterKind.FullScreen` do WinUI3). |
| Notificação de gamepad conectado para o JS | Reimplementada via `InvokeScriptAsync("eval", ...)` disparando `uwpGamepadAdded`. |

## O que foi mantido da versão WebView nativa (correto, não mexi)

- `GameWebView.InvokeScriptAsync("eval", ...)` para rodar JS (o WebView
  clássico não tem `AddScriptToExecuteOnDocumentCreatedAsync`).
- `injectCss()` e `waitForC2AndNotify()` **dentro do próprio bridge JS** —
  evita que o overlay de loading suma antes do motor Construct 2 terminar
  de inicializar (isso já existia certo na v1.1 e eu mantive).
- `ScriptNotify` como único canal JS→C# (o WebView clássico não tem
  `WebMessageReceived`).

## O que foi removido de propósito

- Toda referência a `Microsoft.Web.WebView2`, `Microsoft.WindowsAppSDK`,
  `MainWindow.xaml(.cs)` e o namespace `Microsoft.UI.Xaml.*` — nada disso
  entra no `.csproj` novo.
- O código morto de `OnNavigationStarting` que existia na v1.1 (não fazia
  nada de fato, pois o WebView clássico só permite injetar script depois
  que a navegação completa).

## Arquivos criados do zero para fechar o projeto

A versão "Final" que você mandou **não tinha `.csproj`/`.sln`** — só os
arquivos soltos (`App.xaml`, `MainPage.xaml`, etc.). Criei:
- `MegaManDXtreme.csproj` — projeto UWP clássico (`TargetPlatformIdentifier=UAP`,
  `TargetPlatformVersion=10.0.19041.0`, `TargetPlatformMinVersion=10.0.17763.0`,
  igual ao `Package.appxmanifest`), **sem** SDK-style/WinUI3, plataforma ARM64.
- `MegaManDXtreme.sln`
- `Properties/AssemblyInfo.cs`

## Certificado

Reaproveitei `MegaManDXtreme.pfx` do projeto ARM64 — o `Publisher` no
manifesto (`CN=MegaManDXtreme`) é o mesmo dos dois projetos originais, então
ele deve assinar sem problema. Se o Visual Studio reclamar de thumbprint,
gere um novo certificado de teste em **Package.appxmanifest → Packaging →
Choose Certificate → Create nova**.

## Testar no Windows 10 antes de gerar o .appx

Já deixei o projeto pronto pra isso — adicionei a plataforma **x64** ao lado
do ARM64 (que é só pro deploy final no Xbox). Passos:

1. **Ative o Modo de Desenvolvedor** no seu Windows 10: `Configurações →
   Atualização e Segurança → Para desenvolvedores → Modo de desenvolvedor`.
   Sem isso o Visual Studio não consegue implantar apps UWP localmente.
2. Abra `MegaManDXtreme.sln` no Visual Studio (com a carga de trabalho
   "Universal Windows Platform development" instalada).
3. Na barra de ferramentas, troque a plataforma de solução de `ARM64` para
   **`x64`** (seu PC provavelmente é x64; se for um PC ARM, use `ARM64`
   mesmo — o Snapdragon/Copilot+ roda ARM64 nativo).
4. Escolha `Debug` (mais fácil de debugar) ou `Release`.
5. Confirme que o alvo de depuração está como **"Máquina Local"** (não
   "Máquina Remota" — isso é só pra quando for testar no Xbox de verdade).
6. Aperte **F5**. O Visual Studio compila, implanta e abre o app direto na
   sua tela, sem gerar nenhum `.appx` manualmente — é o mesmo mecanismo que
   ele usaria pra empacotar, só que fica "solto" (loose deploy) em vez de
   virar um pacote assinado.

### O que dá pra validar assim
- Se o `GameFiles/index.html` carrega e o Construct 2 sobe (overlay de
  loading some, jogo aparece).
- Se o bridge JS está injetando certo — os logs dele vão pro arquivo
  `LocalState\app.log`. Caminho local dele:
  `%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState\app.log`
  (o `PackageFamilyName` aparece no `Output` do Visual Studio ao implantar,
  ou em `Configurações → Apps → Mega Man DXtreme → Configurações avançadas`).
- **Gamepad**: conecte um controle Xbox por USB ou Bluetooth no PC — a API
  `Windows.Gaming.Input.Gamepad` funciona igual no desktop e no console, então
  o bridge, o mapeamento de botões e a vibração já são testáveis 1:1.
- Save/Load state, reload, tela de erro (force um erro renomeando o
  `index.html` temporariamente pra ver o overlay vermelho).

### O que NÃO dá pra validar 100% assim
- Comportamento específico de fullscreen/TV do Xbox (`TryEnterFullScreenMode`
  se comporta um pouco diferente numa janela de desktop redimensionável).
- Timing de boot do Xbox Dev Mode (mais lento que um PC) — é por isso que o
  `c2DetectTimeoutMs` e o timeout de 20s existem; no PC tudo tende a carregar
  mais rápido, então bugs de "corrida" (race condition) de inicialização
  podem não aparecer localmente e só aparecer no console.
- Depois que estiver tudo ok em x64 local, faça o deploy real em
  `ARM64 | Release` numa **Máquina Remota** apontando pro IP do Xbox em Dev
  Mode pra validar essa parte.


## Deploy final no Xbox

1. Abra `MegaManDXtreme.sln` no Visual Studio (com a carga de trabalho
   "Universal Windows Platform development" instalada).
2. Configuração: `Release | ARM64` (ou `Debug | ARM64` para testar com o
   Device Portal do Xbox).
3. Deploy remoto para o Xbox em Dev Mode normalmente
   (Projeto → Propriedades → Depurar → Máquina remota → IP do Xbox).
4. Se aparecer erro de restore do `Microsoft.NETCore.UniversalWindowsPlatform`,
   rode `nuget restore` ou deixe o VS restaurar sozinho na primeira abertura.
