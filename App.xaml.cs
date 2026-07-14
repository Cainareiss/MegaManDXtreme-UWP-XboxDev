// App.xaml.cs — Mega Man DXtreme UWP  v4.0 (merge)
// Motor: WebView nativo UWP (Windows.UI.Xaml.Controls.WebView) — sem WebView2,
// sem Windows App SDK. 100% UWP clássico para máxima compatibilidade com Xbox.

using System;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace MegaManDXtreme
{
    sealed partial class App : Application
    {
        public App()
        {
            this.InitializeComponent();
            this.RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;

            // Captura crashes não tratados para evitar fechamento silencioso
            // e grava no log persistente (visível via Xbox Device Portal).
            this.UnhandledException += OnUnhandledException;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            AppLogger.Log("App", "OnLaunched");

            Frame rootFrame = Window.Current.Content as Frame;

            if (rootFrame == null)
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = rootFrame;
            }

            if (e.PrelaunchActivated == false)
            {
                if (rootFrame.Content == null)
                {
                    rootFrame.Navigate(typeof(MainPage), e.Arguments);
                }
                Window.Current.Activate();
                AppLogger.Log("App", "Window ativada");
            }
        }

        private void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            AppLogger.Log("App", $"NavigationFailed: {e.SourcePageType.FullName}");
            throw new Exception($"Falha ao carregar Page {e.SourcePageType.FullName}: {e.Exception}");
        }

        private void OnUnhandledException(object sender, Windows.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            AppLogger.LogException("App.UnhandledException", e.Exception ?? new Exception(e.Message));
            e.Handled = true; // impede fechamento imediato — deixa a MainPage mostrar erro
        }
    }
}
