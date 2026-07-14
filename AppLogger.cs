using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using Windows.Storage;

namespace MegaManDXtreme
{
    /// <summary>
    /// Logger thread-safe para debug no Xbox.
    /// Logs vão para:
    ///   1. Debug.WriteLine() → visível no Output do Visual Studio via Remote Debug.
    ///   2. LocalState/app.log → legível via Xbox Device Portal → File Explorer
    ///   3. LocalState/Logs/crash_YYYY-MM-DD_HH-mm-ss.log → crashes separados por sessão
    /// </summary>
    internal static class AppLogger
    {
        private static readonly object _lock = new object();
        private static string _logPath;
        private static string _logsDir;
        private static string _crashLogPath;
        private static bool _initialized = false;
        private static readonly string _sessionId = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");

        private static void EnsureInitialized()
        {
            if (_initialized) return;
            lock (_lock)
            {
                if (_initialized) return;
                try
                {
                    var localFolder = ApplicationData.Current.LocalFolder.Path;

                    // Arquivo principal de log
                    _logPath = Path.Combine(localFolder, "app.log");
                    File.WriteAllText(_logPath,
                        $"=== Mega Man DXtreme Log — {DateTime.Now:yyyy-MM-dd HH:mm:ss} ===\n",
                        Encoding.UTF8);

                    // Pasta Logs/ para crash logs separados
                    _logsDir = Path.Combine(localFolder, "Logs");
                    Directory.CreateDirectory(_logsDir);

                    _crashLogPath = Path.Combine(_logsDir, $"crash_{_sessionId}.log");
                    File.WriteAllText(_crashLogPath,
                        $"=== Crash Log — Sessão {_sessionId} ===\n",
                        Encoding.UTF8);

                    _initialized = true;
                }
                catch
                {
                    _initialized = true;
                }
            }
        }

        public static void Log(string tag, string message)
        {
            EnsureInitialized();
            string line = $"[{DateTime.Now:HH:mm:ss.fff}] [{tag}] {message}";
            Debug.WriteLine(line);

            if (_logPath != null)
            {
                lock (_lock)
                {
                    try
                    {
                        var fi = new FileInfo(_logPath);
                        if (fi.Exists && fi.Length > 2 * 1024 * 1024)
                        {
                            File.WriteAllText(_logPath,
                                $"=== Log truncado em {DateTime.Now:HH:mm:ss} (>2MB) ===\n" + line + "\n",
                                Encoding.UTF8);
                        }
                        else
                        {
                            File.AppendAllText(_logPath, line + "\n", Encoding.UTF8);
                        }
                    }
                    catch { }
                }
            }
        }

        public static void LogException(string tag, Exception ex)
        {
            Log(tag, $"EXCEPTION {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
            LogCrash($"[{tag}] {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
        }

        /// <summary>
        /// Salva uma entrada de crash na pasta Logs/ (acessível pelo Device Portal).
        /// Chamado pelo handler de mensagens JS (tipo 'crashLog').
        /// </summary>
        public static void LogCrash(string entry)
        {
            EnsureInitialized();
            if (_crashLogPath == null) return;

            lock (_lock)
            {
                try
                {
                    File.AppendAllText(_crashLogPath,
                        $"[{DateTime.Now:HH:mm:ss.fff}] {entry}\n",
                        Encoding.UTF8);
                }
                catch { }
            }
        }

        /// <summary>
        /// Retorna o caminho da pasta Logs/ para exibição no Device Portal.
        /// Device Portal: http://[IP-XBOX]:11443 → File Explorer →
        ///   LocalAppData → MegaManDXtreme → LocalState → Logs
        /// </summary>
        public static string LogsDirectory => _logsDir;
    }
}
