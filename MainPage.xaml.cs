// MainPage.xaml.cs — Mega Man DXtreme UWP  v4.0 (merge)
// ─────────────────────────────────────────────────────────────────────────────
// Motor: Windows.UI.Xaml.Controls.WebView (EdgeHTML nativo do UWP).
//
// Por que não WebView2/WinUI3 (versão ARM64 anterior)?
//   WebView2 depende do runtime Edge Chromium e do Windows App SDK, que
//   historicamente têm causado crashes/instabilidade no Xbox (App Crashed /
//   fechamento silencioso em Dev Mode). O WebView clássico do UWP roda no
//   processo do próprio app, sem dependência externa, e é o que a Microsoft
//   documenta como suportado em Xbox Dev Mode para conteúdo HTML5 local.
//
// O que foi herdado da versão WebView2/WinUI3 (ARM64) nesta mesclagem:
//   - AppLogger (log persistente em LocalState/app.log + Logs/crash_*.log,
//     legível via Xbox Device Portal)
//   - Timeout de 20s no carregamento (detecta jogo travado sem depender só
//     de reload manual)
//   - Protocolo de mensagens estruturado em JSON (type: vibrate/saveState/
//     loadState/forceReload/crashLog/log) em vez de apenas prefixos de string
//   - Fullscreen explícito para Xbox
//   - Encaminhamento de eventos de gamepad conectado/desconectado para o JS
//
// O que foi mantido da versão WebView nativa (final) por ser a forma correta
// para este controle:
//   - GameWebView.InvokeScriptAsync("eval", ...) para injetar/rodar JS
//     (WebView clássico não tem AddScriptToExecuteOnDocumentCreatedAsync)
//   - ScriptNotify (window.external.notify) como único canal de mensagens JS→C#
//     (WebView clássico não tem WebMessageReceived/postMessage)
// ─────────────────────────────────────────────────────────────────────────────

using System;
using System.Threading;
using System.Threading.Tasks;
using Windows.ApplicationModel.Core;
using Windows.Data.Json;
using Windows.Gaming.Input;
using Windows.Storage;
using Windows.System;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Navigation;

namespace MegaManDXtreme
{
    public sealed partial class MainPage : Page
    {
        // ── Gamepad ──────────────────────────────────────────────────────────
        private Gamepad _activeGamepad;
        private CancellationTokenSource _vibrateCts;

        // ── Controle de carregamento / reload ───────────────────────────────
        private bool _gameLoaded;
        private int  _reloadCount;
        private const int MaxReloads = 3;
        private CancellationTokenSource _loadTimeoutCts;
        private bool _audioMonitorStarted;

        // ── Dispatcher (acesso seguro à UI a partir de threads/timers) ──────
        private readonly CoreDispatcher _dispatcher;

        public MainPage()
        {
            this.InitializeComponent();
            _dispatcher = Window.Current.Dispatcher;
            Window.Current.CoreWindow.KeyDown += OnCoreWindowKeyDown;
            Window.Current.CoreWindow.KeyUp += OnCoreWindowKeyUp;

            // Tela cheia sem barras do sistema (ideal para TV/Xbox)
            ApplicationView.GetForCurrentView()
                .SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);
            ApplicationView.GetForCurrentView().TryEnterFullScreenMode();

            // Eventos de ciclo de vida
            CoreApplication.Suspending += OnSuspending;
            CoreApplication.Resuming   += OnResuming;

            // Gamepad
            Gamepad.GamepadAdded   += OnGamepadAdded;
            Gamepad.GamepadRemoved += OnGamepadRemoved;
            if (Gamepad.Gamepads.Count > 0) _activeGamepad = Gamepad.Gamepads[0];

            // Botões A/B do controle navegam a tela de erro
            this.KeyDown += OnKeyDown;

            AppLogger.Log("MainPage", $"Construtor OK | Gamepads: {Gamepad.Gamepads.Count}");

            // Carrega o jogo quando a página estiver pronta
            this.Loaded += (s, e) =>
            {
                this.Focus(FocusState.Programmatic);
                LoadGame();
            };
        }

        // ── CARREGAMENTO ─────────────────────────────────────────────────────

        private void LoadGame()
        {
            SetStatus("Carregando jogo...");
            StartLoadTimeout();
            GameWebView.Source = new Uri("ms-appx-web:///GameFiles/index.html");
        }

        private void StartLoadTimeout()
        {
            _loadTimeoutCts?.Cancel();
            _loadTimeoutCts?.Dispose();
            _loadTimeoutCts = new CancellationTokenSource();
            var token = _loadTimeoutCts.Token;

            _ = Task.Delay(TimeSpan.FromSeconds(90), token).ContinueWith(t =>
            {
                if (t.IsCompletedSuccessfully && !_gameLoaded)
                {
                    _ = _dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
                        ShowError("Timeout de carregamento",
                            "O runtime não concluiu o carregamento em 90s.\n\n" +
                            "Consulte as linhas StartupProbe no app.log."));
                }
            }, TaskScheduler.Default);
        }

        private void OnNavigationFailed(object sender, WebViewNavigationFailedEventArgs e)
        {
            AppLogger.Log("MainPage", $"NavigationFailed: {e.WebErrorStatus}");
            ShowError("Falha ao carregar o jogo",
                $"Erro de navegação: {e.WebErrorStatus}\n" +
                $"Verifique se GameFiles/index.html está incluído no pacote como Content.");
        }

        private async void OnNavigationCompleted(WebView sender,
            WebViewNavigationCompletedEventArgs e)
        {
            AppLogger.Log("MainPage", $"NavigationCompleted success={e.IsSuccess}");

            if (!e.IsSuccess)
            {
                ShowError("Falha ao carregar o jogo",
                    $"Não foi possível abrir GameFiles/index.html.\n" +
                    $"Verifique se os arquivos estão incluídos no pacote como Content.");
                return;
            }

            await InjectBridgeAsync();
            _ = MonitorGameStartupAsync();
        }

        private async Task InjectBridgeAsync()
        {
            try
            {
                var bridgeFile = await StorageFile.GetFileFromApplicationUriAsync(
                    new Uri("ms-appx:///GameFiles/xbox-bridge-uwp.js"));
                string bridgeCode = await FileIO.ReadTextAsync(bridgeFile);

                // Único método de injeção disponível no WebView UWP clássico:
                // não existe AddScriptToExecuteOnDocumentCreatedAsync, então
                // injetamos via eval logo após a navegação completar.
                await GameWebView.InvokeScriptAsync("eval", new[] { bridgeCode });
                AppLogger.Log("Bridge", $"Injetado OK ({bridgeCode.Length} chars)");
            }
            catch (Exception ex)
            {
                AppLogger.Log("Bridge", $"InjectBridge ERRO: {ex.Message}");
                // Não fatal — o jogo pode funcionar sem o bridge (sem gamepad/vibração)
            }
        }

        private async Task MonitorGameStartupAsync()
        {
            string previousSnapshot = null;

            for (int attempt = 0; attempt < 180 && !_gameLoaded; attempt++)
            {
                try
                {
                    string snapshot = await GameWebView.InvokeScriptAsync("eval", new[]
                    {
                        "(function(){" +
                        "var rt=typeof window.cr_getC2Runtime==='function'?window.cr_getC2Runtime():null;" +
                        "var c=document.getElementById('c2canvas');" +
                        "var loading=rt&&rt.isloading?'1':'0';" +
                        "var progress=rt&&typeof rt.loadingprogress==='number'?Math.round(rt.loadingprogress*100):0;" +
                        "var layout=rt&&rt.running_layout?(rt.running_layout.name||'unnamed'):'';" +
                        "var renderer=rt?(rt.gl?'webgl':(rt.ctx?'canvas2d':'none')):'none';" +
                        "var lost=rt&&rt.is_WebGL_context_lost?'1':'0';" +
                        "var suspended=rt&&rt.isSuspended?'1':'0';" +
                        "var size=c?(c.width+'x'+c.height+'/'+c.clientWidth+'x'+c.clientHeight):'none';" +
                        "var err=window.__gameInitError||window.__gameResourceError||'';" +
                        "var ready=rt&&rt.running_layout&&!rt.isloading&&!rt.is_WebGL_context_lost&&c&&c.width>0&&c.height>0?'1':'0';" +
                        "return ready+'|'+(rt?'1':'0')+'|'+loading+'|'+progress+'|'+layout+'|'+renderer+'|'+lost+'|'+suspended+'|'+size+'|'+err;" +
                        "})()"
                    });

                    if (snapshot != previousSnapshot)
                    {
                        AppLogger.Log("StartupProbe",
                            "ready|runtime|loading|progress|layout|renderer|lost|suspended|size|error = " +
                            snapshot);
                        previousSnapshot = snapshot;
                    }

                    string[] fields = snapshot.Split(new[] { '|' }, 10);
                    if (fields.Length >= 1 && fields[0] == "1")
                    {
                        AppLogger.Log("StartupProbe",
                            "Runtime confirmado via InvokeScriptAsync");
                        OnGameReady();
                        return;
                    }

                    if (fields.Length == 10 && !string.IsNullOrWhiteSpace(fields[9]))
                    {
                        ShowError("Erro ao iniciar o jogo", fields[9]);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    AppLogger.Log("StartupProbe",
                        "InvokeScriptAsync ERRO: " + ex.Message);
                }

                await Task.Delay(500);
            }

            AppLogger.Log("StartupProbe",
                "Monitor terminou sem confirmar o runtime");
        }

        // ── MENSAGENS DO JAVASCRIPT (window.external.notify) ────────────────
        // O bridge manda ou uma string simples (GAME_READY / APP_QUIT) ou um
        // JSON {type:...} para tudo que precisa de dados estruturados.

        private void OnScriptNotify(object sender, NotifyEventArgs e)
        {
            string msg = e.Value ?? string.Empty;
            AppLogger.Log("ScriptNotify", msg);

            if (msg == "GAME_READY")
            {
                AppLogger.Log("MainPage",
                    "GAME_READY recebido; aguardando confirmação do runtime");
                return;
            }
            if (msg.StartsWith("GAME_INIT_ERROR:"))
            {
                string error = msg.Substring("GAME_INIT_ERROR:".Length);
                ShowError("Erro ao iniciar o jogo", error);
                return;
            }
            if (msg == "APP_QUIT")
            {
                Application.Current.Exit();
                return;
            }

            if (msg.StartsWith("{"))
            {
                HandleJsonMessage(msg);
            }
        }

        private void HandleJsonMessage(string msg)
        {
            try
            {
                JsonObject doc = JsonObject.Parse(msg);
                string type = GetStringProperty(doc, "type", string.Empty);

                switch (type)
                {
                    case "vibrate":
                        double left = GetDoubleProperty(doc, "left");
                        double right = GetDoubleProperty(doc, "right");
                        int ms = GetIntProperty(doc, "ms");
                        _ = SetVibrationAsync(left, right, ms);
                        break;

                    case "saveState":
                        IJsonValue dataValue = doc.GetNamedValue("data");
                        string rawData = dataValue != null ? dataValue.Stringify() : "null";
                        _ = SaveStateAsync(rawData);
                        break;

                    case "loadState":
                        _ = LoadStateAndSendAsync();
                        break;

                    case "forceReload":
                        AppLogger.Log("MainPage", "ForceReload solicitado pelo controle/bridge");
                        _ = _dispatcher.RunAsync(CoreDispatcherPriority.Normal,
                            () => { _ = ReloadAsync(); });
                        break;

                    case "crashLog":
                        string entry = GetStringProperty(doc, "entry", msg);
                        AppLogger.LogCrash(entry);
                        break;

                    case "log":
                        string logEntry = GetStringProperty(doc, "entry", msg);
                        AppLogger.Log("JS", logEntry);
                        break;
                }
            }
            catch (Exception ex)
            {
                AppLogger.Log("MainPage", $"HandleJsonMessage ERRO: {ex.Message} | msg={msg}");
            }
        }

        private void OnGameReady()
        {
            if (_gameLoaded) return;
            _gameLoaded = true;
            _reloadCount = 0;
            _loadTimeoutCts?.Cancel();

            AppLogger.Log("MainPage", "Jogo carregado ✓");
            if (!_audioMonitorStarted)
            {
                _audioMonitorStarted = true;
                _ = MonitorAudioAsync();
            }
            _ = _dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
                LoadingRing.IsActive = false;
            });
        }

        private async Task MonitorAudioAsync()
        {
            string previous = null;
            for (int attempt = 0; attempt < 1800; attempt++)
            {
                try
                {
                    string state = await GameWebView.InvokeScriptAsync("eval", new[]
                    {
                        "(function(){" +
                        "var rt=typeof window.cr_getC2Runtime==='function'?window.cr_getC2Runtime():null;" +
                        "if(!rt)return 'runtime=none';" +
                        "var layout=rt.running_layout?(rt.running_layout.name||'unnamed'):'none';" +
                        "var jsError=window.__gameInitError||'';" +
                        "var resourceError=window.__gameResourceError||'';" +
                        "var audio=typeof rt.getAudioDebugInfo==='function'?" +
                        "rt.getAudioDebugInfo():'audioPlugin=none';" +
                        "return 'layout='+layout+';'+audio+';jsError='+jsError+" +
                        "';resourceError='+resourceError;" +
                        "})()"
                    });
                    if (state != previous)
                    {
                        AppLogger.Log("AudioProbe", state);
                        previous = state;
                    }
                }
                catch (Exception ex)
                {
                    AppLogger.Log("AudioProbe", "ERRO: " + ex.Message);
                }
                await Task.Delay(1000);
            }
        }

        // ── VIBRAÇÃO ─────────────────────────────────────────────────────────

        private static double ClampDouble(double value, double min, double max)
        {
            if (value < min) return min;
            if (value > max) return max;
            return value;
        }

        private static string GetStringProperty(JsonObject obj, string name, string defaultValue)
        {
            if (obj.ContainsKey(name))
            {
                IJsonValue value = obj.GetNamedValue(name);
                if (value != null && value.ValueType == JsonValueType.String)
                    return value.GetString();
            }
            return defaultValue;
        }

        private static double GetDoubleProperty(JsonObject obj, string name, double defaultValue = 0.0)
        {
            if (obj.ContainsKey(name))
            {
                IJsonValue value = obj.GetNamedValue(name);
                if (value != null && value.ValueType == JsonValueType.Number)
                    return value.GetNumber();
            }
            return defaultValue;
        }

        private static int GetIntProperty(JsonObject obj, string name, int defaultValue = 0)
        {
            return (int)GetDoubleProperty(obj, name, defaultValue);
        }

        private async Task SetVibrationAsync(double left, double right, int durationMs)
        {
            _vibrateCts?.Cancel();
            _vibrateCts?.Dispose();
            _vibrateCts = new CancellationTokenSource();
            var token = _vibrateCts.Token;

            try
            {
                if (_activeGamepad == null) return;
                _activeGamepad.Vibration = new GamepadVibration
                {
                    LeftMotor  = ClampDouble(left, 0.0, 1.0),
                    RightMotor = ClampDouble(right, 0.0, 1.0),
                };
                await Task.Delay(durationMs, token);
                if (_activeGamepad != null)
                    _activeGamepad.Vibration = new GamepadVibration();
            }
            catch (OperationCanceledException) { /* nova vibração assumiu */ }
            catch (Exception ex) { AppLogger.Log("Vibration", ex.Message); }
        }

        // ── SAVE STATE ───────────────────────────────────────────────────────

        private async Task SaveStateAsync(string jsonData)
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder
                    .CreateFileAsync("savestate.json", CreationCollisionOption.ReplaceExisting);
                await FileIO.WriteTextAsync(file, jsonData);
                AppLogger.Log("SaveState", "Salvo OK");
            }
            catch (Exception ex)
            {
                AppLogger.Log("SaveState", $"Erro ao salvar: {ex.Message}");
            }
        }

        private async Task LoadStateAndSendAsync()
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder
                    .GetFileAsync("savestate.json");
                string data = await FileIO.ReadTextAsync(file);
                string script = $"document.dispatchEvent(new CustomEvent('uwpStateLoaded',{{detail:{data}}}));";
                await GameWebView.InvokeScriptAsync("eval", new[] { script });
                AppLogger.Log("SaveState", "Carregado e enviado");
            }
            catch (System.IO.FileNotFoundException)
            {
                AppLogger.Log("SaveState", "Sem save anterior");
                await GameWebView.InvokeScriptAsync("eval", new[]
                {
                    "document.dispatchEvent(new CustomEvent('uwpStateLoaded',{detail:null}));"
                });
            }
            catch (Exception ex)
            {
                AppLogger.Log("SaveState", $"Erro: {ex.Message}");
            }
        }

        // ── GAMEPAD ──────────────────────────────────────────────────────────

        private async void OnGamepadAdded(object sender, Gamepad gp)
        {
            if (_activeGamepad == null) _activeGamepad = gp;
            AppLogger.Log("Gamepad", $"Conectado. Total: {Gamepad.Gamepads.Count}");
            try
            {
                await GameWebView.InvokeScriptAsync("eval", new[]
                {
                    "document.dispatchEvent(new CustomEvent('uwpGamepadAdded'));"
                });
            }
            catch { }
        }

        private void OnGamepadRemoved(object sender, Gamepad gp)
        {
            if (_activeGamepad == gp)
            {
                _vibrateCts?.Cancel();
                _activeGamepad = Gamepad.Gamepads.Count > 0 ? Gamepad.Gamepads[0] : null;
            }
            AppLogger.Log("Gamepad", $"Desconectado. Total: {Gamepad.Gamepads.Count}");
        }

        // ── TECLADO DO CONTROLE (navegação na tela de erro) ─────────────────

        private void OnCoreWindowKeyDown(CoreWindow sender, KeyEventArgs e)
        {
            if (ShouldSuppressWebViewGamepadKey(e.VirtualKey))
                e.Handled = true;
        }

        private void OnCoreWindowKeyUp(CoreWindow sender, KeyEventArgs e)
        {
            if (ShouldSuppressWebViewGamepadKey(e.VirtualKey))
                e.Handled = true;
        }

        private bool ShouldSuppressWebViewGamepadKey(VirtualKey key)
        {
            if (ErrorOverlay.Visibility == Visibility.Visible)
                return key == VirtualKey.GamepadMenu ||
                       key == VirtualKey.GamepadView;

            return key == VirtualKey.GamepadB ||
                   key == VirtualKey.GamepadMenu ||
                   key == VirtualKey.GamepadView ||
                   key == VirtualKey.GoBack ||
                   key == VirtualKey.Escape ||
                   key == VirtualKey.Enter;
        }

        private async void OnKeyDown(object sender, KeyRoutedEventArgs e)
        {
            if (ErrorOverlay.Visibility != Visibility.Visible) return;

            if (e.Key == VirtualKey.GamepadA)
            {
                e.Handled = true;
                await ReloadAsync();
            }
            else if (e.Key == VirtualKey.GamepadB)
            {
                e.Handled = true;
                Application.Current.Exit();
            }
        }

        // ── RELOAD ───────────────────────────────────────────────────────────

        private async Task ReloadAsync()
        {
            if (_reloadCount >= MaxReloads)
            {
                ShowError("Falha persistente",
                    $"O jogo falhou ao carregar {MaxReloads} vezes.\n" +
                    $"Verifique se GameFiles/index.html está presente no pacote.");
                return;
            }

            _reloadCount++;
            _gameLoaded = false;
            AppLogger.Log("MainPage", $"Reload {_reloadCount}/{MaxReloads}");

            ErrorOverlay.Visibility = Visibility.Collapsed;
            SetStatus($"Recarregando ({_reloadCount}/{MaxReloads})...");
            await Task.Delay(500); // pequena pausa para a UI atualizar
            LoadGame();
        }

        // ── SUSPEND / RESUME ─────────────────────────────────────────────────

        private async void OnSuspending(object sender, Windows.ApplicationModel.SuspendingEventArgs e)
        {
            var deferral = e.SuspendingOperation.GetDeferral();
            try
            {
                AppLogger.Log("MainPage", "Suspendendo...");
                if (_activeGamepad != null)
                    _activeGamepad.Vibration = new GamepadVibration();

                await GameWebView.InvokeScriptAsync("eval", new[]
                {
                    "(function(){try{" +
                    "document.dispatchEvent(new CustomEvent('uwpSuspend'));" +
                    "var rt=window.cr_singletons&&window.cr_singletons[0];" +
                    "if(rt&&typeof rt.setSuspended==='function'&&rt.pauseCount===0)rt.setSuspended(true);" +
                    "}catch(e){}})();"
                });
            }
            catch (Exception ex) { AppLogger.Log("MainPage", $"OnSuspending ERRO: {ex.Message}"); }
            finally { deferral.Complete(); }
        }

        private async void OnResuming(object sender, object e)
        {
            AppLogger.Log("MainPage", "Retomando...");
            try
            {
                await GameWebView.InvokeScriptAsync("eval", new[]
                {
                    "(function(){try{" +
                    "document.dispatchEvent(new CustomEvent('uwpResume'));" +
                    "var rt=window.cr_singletons&&window.cr_singletons[0];" +
                    "if(rt&&typeof rt.setSuspended==='function'&&rt.pauseCount>0)rt.setSuspended(false);" +
                    "}catch(e){}})();"
                });
            }
            catch (Exception ex) { AppLogger.Log("MainPage", $"OnResuming ERRO: {ex.Message}"); }
        }

        // ── HELPERS DE UI ────────────────────────────────────────────────────

        private void SetStatus(string text)
        {
            LoadingText.Text = text;
            LoadingOverlay.Visibility = Visibility.Visible;
            LoadingRing.IsActive = true;
        }

        private void ShowError(string title, string message)
        {
            _loadTimeoutCts?.Cancel();
            AppLogger.Log("MainPage.Error", $"{title}: {message}");
            LoadingOverlay.Visibility = Visibility.Collapsed;
            LoadingRing.IsActive = false;
            ErrorTitle.Text   = title;
            ErrorMessage.Text = message;
            ErrorLogHint.Text = $"Log: LocalState\\app.log  (Device Portal → File Explorer)";
            ErrorOverlay.Visibility = Visibility.Visible;
        }
    }
}
