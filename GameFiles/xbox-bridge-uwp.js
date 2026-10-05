/**
 * xbox-bridge-uwp.js — Mega Man DXtreme UWP  v4.0 (merge)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mescla de:
 *   - xbox-bridge.js v3.2 (motor WebView2/WinUI3)      → lógica de gameplay
 *   - xbox-bridge-uwp.js v1.1 (motor WebView nativo)   → camada de transporte
 *
 * Motor de destino: Windows.UI.Xaml.Controls.WebView (EdgeHTML nativo do UWP).
 * WebView2 foi abandonado nesta versão porque crashava no Xbox.
 *
 * Transporte C#: como o WebView nativo só expõe window.external.notify(string)
 * (evento ScriptNotify), TODAS as mensagens estruturadas viajam como um único
 * JSON.stringify(...) por chamada — o C# faz JSON.Parse e despacha por "type",
 * igual fazia o WV2 (case "vibrate"/"saveState"/"loadState"/"forceReload"/"crashLog").
 *
 * Herdado de v3.1/v3.2 (mantido):
 *   - KEY_MAP corrigido (X=a, Y=s, LB=q, RB=e, LT/RT=Space)
 *   - Analog stick direito também mapeado para movimento
 *   - forceGamepadDetection usa GamepadEvent real
 *   - AudioContext reaproveitado (resume promise-based)
 *   - c2DetectTimeoutMs=1000 (Xbox inicializa o C2 mais devagar)
 *   - Removida a duplicação de crash logger que existia no arquivo original v3.2
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
    'use strict';

    if (global.__xboxBridgeLoaded) {
        console.log('[Bridge] já ativo — ignorando reinjeção.');
        return;
    }
    global.__xboxBridgeLoaded = true;

    // ── CONFIGURAÇÃO ─────────────────────────────────────────────────────────
    var CFG = {
        fallbackPollMs:    16,
        deadzone:          0.20,
        triggerThreshold:  0.25,
        repeatDelay:       400,
        repeatRate:        80,
        logEveryNFrames:   600,
        c2DetectTimeoutMs: 1000,
        vibrateHit:    { left: 0.3, right: 0.5, ms: 120 },
        vibratePickup: { left: 0.1, right: 0.3, ms:  80 },
        vibrateDeath:  { left: 0.8, right: 0.8, ms: 400 },
    };

    // ── TRANSPORTE (WebView nativo UWP) ─────────────────────────────────────
    // Único ponto de saída para o C# — troca chrome.webview.postMessage por
    // window.external.notify, que é o que o WebView clássico do UWP suporta.
    function notifyUWP(obj) {
        try {
            var msg = (typeof obj === 'string') ? obj : JSON.stringify(obj);
            if (global.external && global.external.notify) global.external.notify(msg);
        } catch (e) { /* silencioso — não pode travar o jogo */ }
    }

    // ── LOGGING (em lote, para não floodar o notify) ────────────────────────
    var _logQueue = [];
    var _logTimer = null;

    function _log(msg) {
        console.log('[XboxBridge] ' + msg);
        _logQueue.push('[Bridge] ' + msg);
        if (!_logTimer) {
            _logTimer = setTimeout(function () {
                var batch = _logQueue.join('\n');
                _logQueue = [];
                _logTimer = null;
                notifyUWP({ type: 'log', entry: batch });
            }, 50);
        }
    }

    // ── CRASH LOGGER ─────────────────────────────────────────────────────────
    // Captura erros JS e envia para o C# salvar em LocalState/Logs/
    var _sessionStart = new Date().toISOString();

    function _flushCrashLog(entry) {
        notifyUWP({ type: 'crashLog', entry: entry, session: _sessionStart });
    }

    global.addEventListener('error', function (e) {
        var msg = '[CRASH][' + new Date().toISOString() + '] '
            + (e.message || 'UnknownError')
            + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0);
        _flushCrashLog(msg);
        _log('CRASH capturado: ' + msg);
    });

    global.addEventListener('unhandledrejection', function (e) {
        var reason = e.reason ? (e.reason.stack || e.reason.message || String(e.reason)) : 'UnhandledRejection';
        var msg = '[UNHANDLED_PROMISE][' + new Date().toISOString() + '] ' + reason;
        _flushCrashLog(msg);
        _log('Promise rejeitada: ' + msg);
    });

    // Intercepta console.error para também capturar erros do C2Runtime
    var _origConsoleError = console.error;
    console.error = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = '[CONSOLE_ERROR][' + new Date().toISOString() + '] ' + args.join(' ');
        _flushCrashLog(msg);
        _origConsoleError.apply(console, arguments);
    };

    _log('CrashLogger ativo — sessão: ' + _sessionStart);

    // ── VIBRAÇÃO ─────────────────────────────────────────────────────────────
    // No WebView nativo não existe AddScriptToExecuteOnDocumentCreatedAsync,
    // então não há shim __uwpVibrate separado: chama notifyUWP direto.
    function vibrate(left, right, ms) {
        notifyUWP({ type: 'vibrate', left: left || 0, right: right || 0, ms: ms || 200 });
    }

    if (typeof navigator.vibrate !== 'function') {
        Object.defineProperty(navigator, 'vibrate', {
            value: function (pattern) {
                var ms = Array.isArray(pattern) ? pattern[0] : (pattern || 100);
                vibrate(0.5, 0.5, ms);
                return true;
            },
            writable: false,
            configurable: true,
        });
        _log('navigator.vibrate shim instalado');
    }

    // ── SAVE STATE API ──────────────────────────────────────────────────────
    function saveState(stateObj) {
        notifyUWP({ type: 'saveState', data: stateObj });
        _log('SaveState enviado');
    }

    function loadState() {
        notifyUWP({ type: 'loadState' });
        _log('LoadState solicitado');
    }

    var _persistentSaveInstalled = false;
    var _persistentSaveTimer = null;
    var _restoringPersistentSave = false;

    function collectPersistentSave() {
        var keys = {};
        try {
            for (var i = 0; i < global.localStorage.length; i++) {
                var key = global.localStorage.key(i);
                if (!key) continue;
                keys[key] = global.localStorage.getItem(key);
            }
        } catch (e) {
            _log('Falha ao coletar localStorage: ' + e.message);
            return null;
        }
        return {
            version: 2,
            savedAt: new Date().toISOString(),
            localStorage: keys
        };
    }

    function flushPersistentSave() {
        if (_restoringPersistentSave || !global.__uwpSaveRestored) return;
        if (_persistentSaveTimer) {
            clearTimeout(_persistentSaveTimer);
            _persistentSaveTimer = null;
        }
        var snapshot = collectPersistentSave();
        if (snapshot) saveState(snapshot);
    }

    function persistConstructSave(slot, json) {
        if (!slot || typeof json !== 'string' || !json.length) return;
        try {
            global.localStorage.setItem('__c2save_' + slot, json);
            _log('Construct save espelhado: ' + slot +
                ' (' + json.length + ' bytes)');
        } catch (e) {
            _log('Falha ao espelhar Construct save: ' + e.message);
        }
        flushPersistentSave();
    }

    global.__uwpPersistConstructSave = persistConstructSave;

    function schedulePersistentSave(key) {
        if (_restoringPersistentSave) return;
        // Construct WebStorage stores progress as File0, File1, etc.
        // Include all keys, including settings and explicit slot deletions.
        if (_persistentSaveTimer) clearTimeout(_persistentSaveTimer);
        _persistentSaveTimer = setTimeout(flushPersistentSave, 350);
    }

    function restorePersistentSave(data) {
        _restoringPersistentSave = true;
        try {
            if (data && data.localStorage) {
                var keys = data.localStorage;
                Object.keys(keys).forEach(function (key) {
                    if (typeof keys[key] === 'string')
                        global.localStorage.setItem(key, keys[key]);
                });
                _log('Save persistente restaurado: ' +
                    Object.keys(keys).length + ' chaves');
            } else {
                _log('Nenhum save persistente recebido');
            }
        } catch (e) {
            _log('Erro restaurando save persistente: ' + e.message);
            return;
        } finally {
            _restoringPersistentSave = false;
        }
        global.__uwpSaveRestored = true;
        try {
            document.dispatchEvent(new CustomEvent('uwpSaveRestored', {
                detail: data || null
            }));
        } catch (err) {}
    }

    global.__uwpGetPersistentSave = function () {
        if (!global.__uwpSaveRestored || _restoringPersistentSave) return '';
        var snapshot = collectPersistentSave();
        return snapshot ? JSON.stringify(snapshot) : '';
    };
    global.__uwpStorageChanged = schedulePersistentSave;

    function installPersistentSaveBridge() {
        if (_persistentSaveInstalled || !global.localStorage) return;
        _persistentSaveInstalled = true;

        document.addEventListener('uwpStateLoaded', function (e) {
            restorePersistentSave(e.detail);
        });

        try {
            var proto = global.Storage && global.Storage.prototype;
            if (proto && proto.setItem && !proto.__dxUwpSaveWrapped) {
                var originalSetItem = proto.setItem;
                var originalRemoveItem = proto.removeItem;
                var originalClear = proto.clear;
                proto.setItem = function (key, value) {
                    var ret = originalSetItem.call(this, key, value);
                    if (this === global.localStorage)
                        schedulePersistentSave(String(key || ''));
                    return ret;
                };
                proto.removeItem = function (key) {
                    var ret = originalRemoveItem.call(this, key);
                    if (this === global.localStorage)
                        schedulePersistentSave(String(key || ''));
                    return ret;
                };
                proto.clear = function () {
                    var ret = originalClear.call(this);
                    if (this === global.localStorage) schedulePersistentSave('');
                    return ret;
                };
                proto.__dxUwpSaveWrapped = true;
            }
        } catch (e) {
            _log('Nao foi possivel interceptar localStorage: ' + e.message);
        }

        document.addEventListener('uwpSuspend', flushPersistentSave);
        global.addEventListener('beforeunload', flushPersistentSave);
        loadState();
    }

    installPersistentSaveBridge();

    // ── MAPEAMENTO BOTAO → TECLA (corrigido) ────────────────────────────────
    //
    //   Botão Xbox  │ Tecla C2 │ keyCode │ Função
    //   ────────────┼──────────┼─────────┼──────────────────────────────
    //   A           │ Z        │ 90      │ Pular
    //   B           │ X        │ 88      │ Atirar
    //   X           │ A        │ 65      │ Arma especial
    //   Y           │ S        │ 83      │ Slide/Dash
    //   LB          │ Q        │ 81      │ Arma anterior
    //   RB          │ E        │ 69      │ Próxima arma
    //   LT          │ Space    │ 32      │ Ação extra
    //   RT          │ Space    │ 32      │ Ação extra
    //   D-Pad/LS/RS │ Setas    │ 37-40   │ Movimento
    //   View (⧉)    │ Escape   │ 27      │ Pausar
    //   Menu (≡)    │ Enter    │ 13      │ Confirmar

    var BTN = {
        A: 0, B: 1, X: 2, Y: 3,
        LB: 4, RB: 5, LT: 6, RT: 7,
        VIEW: 8, MENU: 9,
        L3: 10, R3: 11,
        DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
    };

    var KEY_MAP = {};
    KEY_MAP[BTN.DPAD_LEFT]  = { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 };
    KEY_MAP[BTN.DPAD_RIGHT] = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 };
    KEY_MAP[BTN.DPAD_UP]    = { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 };
    KEY_MAP[BTN.DPAD_DOWN]  = { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 };
    KEY_MAP[BTN.A]  = { key: 'z', code: 'KeyZ', keyCode: 90, vibrate: CFG.vibrateHit };
    KEY_MAP[BTN.B]  = { key: 'x', code: 'KeyX', keyCode: 88 };
    KEY_MAP[BTN.X]  = { key: 'a', code: 'KeyA', keyCode: 65 };
    KEY_MAP[BTN.Y]  = { key: 's', code: 'KeyS', keyCode: 83 };
    KEY_MAP[BTN.LB] = { key: 'q', code: 'KeyQ', keyCode: 81 };
    KEY_MAP[BTN.RB] = { key: 'e', code: 'KeyE', keyCode: 69 };
    KEY_MAP[BTN.LT] = { key: ' ', code: 'Space', keyCode: 32 };
    KEY_MAP[BTN.RT] = { key: ' ', code: 'Space', keyCode: 32 };
    KEY_MAP[BTN.VIEW] = { key: 'Escape', code: 'Escape', keyCode: 27 };
    KEY_MAP[BTN.MENU] = { key: 'Enter', code: 'Enter', keyCode: 13 };
    // Analog stick esquerdo
    KEY_MAP['ax_left']  = KEY_MAP[BTN.DPAD_LEFT];
    KEY_MAP['ax_right'] = KEY_MAP[BTN.DPAD_RIGHT];
    KEY_MAP['ax_up']    = KEY_MAP[BTN.DPAD_UP];
    KEY_MAP['ax_down']  = KEY_MAP[BTN.DPAD_DOWN];
    // Analog stick direito
    KEY_MAP['ax2_left']  = KEY_MAP[BTN.DPAD_LEFT];
    KEY_MAP['ax2_right'] = KEY_MAP[BTN.DPAD_RIGHT];
    KEY_MAP['ax2_up']    = KEY_MAP[BTN.DPAD_UP];
    KEY_MAP['ax2_down']  = KEY_MAP[BTN.DPAD_DOWN];

    // ── COMBOS E LONG PRESS ──────────────────────────────────────────────────
    var _comboState    = {};
    var _viewHoldTimer = null;

    function checkCombos() {
        if (_comboState[BTN.Y] && _comboState[BTN.MENU]) {
            _log('Combo Y+Menu: toggle mute');
            fireKey({ key: 'm', code: 'KeyM', keyCode: 77 }, 'keydown');
            setTimeout(function () {
                fireKey({ key: 'm', code: 'KeyM', keyCode: 77 }, 'keyup');
            }, 80);
        }
    }

    function onViewPressed(pressed) {
        if (pressed) {
            _viewHoldTimer = setTimeout(function () {
                _log('View 2s hold: recarregando página');
                notifyUWP({ type: 'forceReload' });
            }, 2000);
        } else {
            clearTimeout(_viewHoldTimer);
            _viewHoldTimer = null;
        }
    }

    // ── ESTADO ───────────────────────────────────────────────────────────────
    var prevState    = {};
    var repeatTimers = {};
    var axisState    = { left: false, right: false, up: false, down: false };
    var axis2State   = { left: false, right: false, up: false, down: false };
    var frameCount   = 0;
    var _fallbackTimer  = null;
    var _fallbackActive = false;
    var _audioUnlocked  = false;
    var _audioCtx       = null;
    var _languageActionPressed = false;
    var _fpsActionPressed = false;
    var _fps60Enabled = false;
    var _fpsRaf = 0;
    var SPRITE_SELECTION_ENABLED = false;
    var SPRITE_MODES = ['original', 'snes', 'mary'];
    var SPRITE_PACKS = {
        snes: {
            image: 'spritepacks/snes-atlas.png',
            manifest: 'spritepacks/snes-atlas.json'
        },
        mary: {
            image: 'spritepacks/mary-atlas.png',
            manifest: 'spritepacks/mary-atlas.json'
        }
    };
    var _spriteMode = 'original';
    var _spriteApplied = null;
    var _spritePacks = {};
    var _spriteCanvases = {};
    var _playerFrameState = null;
    var _spriteActionPressed = false;
    var _extraSyntheticSelected = false;
    var _extraNavPressed = false;
    var _extraSpriteOverlay = null;
    var _lastExtraSelected = -1;
    var _tvFilter = 'pixel';
    var _tvResolution = 'perfect';
    var _settingsVisualActionPressed = false;
    var _tvScanlineOverlay = null;
    var _displayMetrics = null;
    var _keyboardMode = false;
    var _stickComboPressed = false;
    var _autoSaveAnyButtonPressed = false;
    var _autoSavePromptPending = false;
    var _autoSavePromptTriggered = false;

    try {
        _fps60Enabled =
            global.localStorage.getItem('dx_60fps_beta') === '1';
        _spriteMode = global.localStorage.getItem('dx_sprite_mode') ||
            (global.localStorage.getItem('dx_snes_sprite') === '1'
                ? 'snes' : 'original');
        if (!SPRITE_SELECTION_ENABLED)
            _spriteMode = 'original';
        var storedFilter = global.localStorage.getItem('dx_tv_filter');
        var storedResolution =
            global.localStorage.getItem('dx_tv_resolution');
        if (storedFilter === 'pixel' || storedFilter === 'smooth' ||
            storedFilter === 'crt')
            _tvFilter = storedFilter;
        if (storedResolution === 'perfect' ||
            storedResolution === 'letterbox' ||
            storedResolution === 'fullscreen')
            _tvResolution = storedResolution;
    } catch (e) {}

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function applyDeadzone(v, dz) {
        var abs = Math.abs(v);
        if (abs < dz) return 0;
        return Math.sign(v) * (abs - dz) / (1.0 - dz);
    }

    function fireKey(ki, type) {
        var init = {
            key: ki.key, code: ki.code, keyCode: ki.keyCode,
            which: ki.keyCode, charCode: 0,
            bubbles: true, cancelable: true, composed: true
        };
        global.dispatchEvent(new KeyboardEvent(type, init));
        document.dispatchEvent(new KeyboardEvent(type, init));
        var canvas = document.getElementById('c2canvas');
        if (canvas) canvas.dispatchEvent(new KeyboardEvent(type, init));
    }

    function handleButton(id, nowPressed) {
        var was = !!prevState[id];
        if (was === nowPressed) return;
        prevState[id] = nowPressed;

        _comboState[id] = nowPressed;

        if (id === BTN.VIEW) onViewPressed(nowPressed);
        if (nowPressed) checkCombos();

        var ki = KEY_MAP[id];
        if (!ki) return;

        if (nowPressed) {
            fireKey(ki, 'keydown');
            if (ki.vibrate) vibrate(ki.vibrate.left, ki.vibrate.right, ki.vibrate.ms);
            repeatTimers[id] = setTimeout(function () {
                repeatTimers[id] = setInterval(function () {
                    if (prevState[id]) fireKey(ki, 'keydown');
                    else clearInterval(repeatTimers[id]);
                }, CFG.repeatRate);
            }, CFG.repeatDelay);
        } else {
            fireKey(ki, 'keyup');
            clearTimeout(repeatTimers[id]);
            clearInterval(repeatTimers[id]);
            delete repeatTimers[id];
        }
    }

    function handleAxes(axes) {
        var x = applyDeadzone(axes[0] || 0, CFG.deadzone);
        var y = applyDeadzone(axes[1] || 0, CFG.deadzone);
        var n = { left: x < -0.5, right: x > 0.5, up: y < -0.5, down: y > 0.5 };
        if (n.left  !== axisState.left)  handleButton('ax_left',  n.left);
        if (n.right !== axisState.right) handleButton('ax_right', n.right);
        if (n.up    !== axisState.up)    handleButton('ax_up',    n.up);
        if (n.down  !== axisState.down)  handleButton('ax_down',  n.down);
        axisState = n;

        if (axes.length >= 4) {
            var x2 = applyDeadzone(axes[2] || 0, CFG.deadzone);
            var y2 = applyDeadzone(axes[3] || 0, CFG.deadzone);
            var n2 = { left: x2 < -0.5, right: x2 > 0.5, up: y2 < -0.5, down: y2 > 0.5 };
            if (n2.left  !== axis2State.left)  handleButton('ax2_left',  n2.left);
            if (n2.right !== axis2State.right) handleButton('ax2_right', n2.right);
            if (n2.up    !== axis2State.up)    handleButton('ax2_up',    n2.up);
            if (n2.down  !== axis2State.down)  handleButton('ax2_down',  n2.down);
            axis2State = n2;
        }
    }

    function setSpriteFontText(instance, text) {
        if (!instance || instance.text === text) return;
        instance.text = text;
        instance.text_changed = true;
        if (instance.runtime) instance.runtime.redraw = true;
    }

    function pollLanguageOption() {
        try {
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            if (!rt || !rt.running_layout) return;

            if (global.DXLocalization) global.DXLocalization.apply();
            if (rt.running_layout.name !== 'Settings') {
                _languageActionPressed = false;
                return;
            }

            var cursor = rt.getObjectByUID(1939);
            var value = rt.getObjectByUID(900003);
            var language = global.DXLocalization
                ? global.DXLocalization.getLanguage() : 'en';
            setSpriteFontText(value, language === 'pt' ? 'PORTUGUÊS' : 'ENGLISH');

            var selected = cursor && cursor.instance_vars
                ? Number(cursor.instance_vars[2]) : -1;
            if (selected !== 4) {
                _languageActionPressed = false;
                return;
            }

            var pads = navigator.getGamepads ? navigator.getGamepads() : [];
            var gp = null;
            for (var i = 0; i < pads.length; i++) {
                if (pads[i] && pads[i].connected) {
                    gp = pads[i];
                    break;
                }
            }
            if (!gp) return;

            var left = !!(gp.buttons[BTN.DPAD_LEFT] &&
                gp.buttons[BTN.DPAD_LEFT].pressed);
            var right = !!(gp.buttons[BTN.DPAD_RIGHT] &&
                gp.buttons[BTN.DPAD_RIGHT].pressed);
            var axis = gp.axes && gp.axes.length ? gp.axes[0] : 0;
            var pressed = left || right ||
                axis < -0.6 || axis > 0.6;

            if (pressed && !_languageActionPressed && global.DXLocalization) {
                global.DXLocalization.toggle();
                language = global.DXLocalization.getLanguage();
                setSpriteFontText(value,
                    language === 'pt' ? 'PORTUGUÊS' : 'ENGLISH');
                _log('Idioma alterado para: ' + language);
            }
            _languageActionPressed = pressed;
        } catch (e) {
            _log('Language option erro: ' + e.message);
        }
    }

    function pollPresentationSettings() {
        try {
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            if (!rt || !rt.running_layout ||
                rt.running_layout.name !== 'Settings') {
                _settingsVisualActionPressed = false;
                return;
            }

            var cursor = rt.getObjectByUID(1939);
            var filterValue = rt.getObjectByUID(1942);
            var resolutionValue = rt.getObjectByUID(1941);
            var language = global.DXLocalization
                ? global.DXLocalization.getLanguage() : 'en';
            setSpriteFontText(filterValue, filterLabel(language));
            setSpriteFontText(resolutionValue, resolutionLabel(language));

            if (filterValue) {
                filterValue.x = 160;
                filterValue.width = 56;
                if (typeof filterValue.set_bbox_changed === 'function')
                    filterValue.set_bbox_changed();
            }
            if (resolutionValue) {
                resolutionValue.x = 112;
                resolutionValue.width = 104;
                if (typeof resolutionValue.set_bbox_changed === 'function')
                    resolutionValue.set_bbox_changed();
            }

            var selected = cursor && cursor.instance_vars
                ? Number(cursor.instance_vars[2]) : -1;
            var description = rt.getObjectByUID(1949);
            if (description && selected === 2)
                setSpriteFontText(description, language === 'pt'
                    ? 'Escolher filtro de imagem'
                    : 'Choose the image filter');
            else if (description && selected === 3)
                setSpriteFontText(description, language === 'pt'
                    ? 'Escolher modo de resolução'
                    : 'Choose the display mode');

            var pads = navigator.getGamepads ? navigator.getGamepads() : [];
            var gp = null;
            for (var i = 0; i < pads.length; i++) {
                if (pads[i] && pads[i].connected) {
                    gp = pads[i];
                    break;
                }
            }
            if (!gp) return;

            var left = !!(gp.buttons[BTN.DPAD_LEFT] &&
                gp.buttons[BTN.DPAD_LEFT].pressed);
            var right = !!(gp.buttons[BTN.DPAD_RIGHT] &&
                gp.buttons[BTN.DPAD_RIGHT].pressed);
            var axis = gp.axes && gp.axes.length ? gp.axes[0] : 0;
            var pressed = left || right || axis < -0.6 || axis > 0.6;
            if (pressed && !_settingsVisualActionPressed) {
                var delta = (right || axis > 0.6) ? 1 : -1;
                if (selected === 2)
                    setDisplayFilter(cycleValue(
                        TV_FILTERS, _tvFilter, delta), true);
                else if (selected === 3)
                    setDisplayResolution(cycleValue(
                        TV_RESOLUTIONS, _tvResolution, delta), true);
            }
            _settingsVisualActionPressed =
                (selected === 2 || selected === 3) && pressed;
            rt.redraw = true;
        } catch (e) {
            _log('Configuracoes de video erro: ' + e.message);
        }
    }

    var _lastFrameTime = 0;
    var _framePaceTimer = null;

    function performanceFrame(now) {
        if (!_fps60Enabled) {
            _fpsRaf = 0;
            return;
        }
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        if (rt && rt.running_layout) {
            // Forçar redraw a cada frame para manter 60 FPS estável
            rt.redraw = true;
            // Resetar last_tick_time se o delta ficou muito grande (evita lag spike)
            if (_lastFrameTime > 0) {
                var elapsed = now - _lastFrameTime;
                // Se o frame demorou mais de 50ms (menos de 20 FPS), resetar o
                // tempo de tick do C2 para evitar que ele tente compensar com
                // timesteps gigantes (que causam stuttering / framerate instável)
                if (elapsed > 50 && typeof rt.last_tick_time === 'number') {
                    rt.last_tick_time = now - 16.67; // simula 1 frame normal
                }
            }
        }
        _lastFrameTime = now || 0;
        _fpsRaf = global.requestAnimationFrame(performanceFrame);
    }

    function set60FpsMode(enabled, persist) {
        _fps60Enabled = !!enabled;
        global.__uwp60FpsBeta = _fps60Enabled;
        if (persist) {
            try {
                global.localStorage.setItem(
                    'dx_60fps_beta', _fps60Enabled ? '1' : '0');
            } catch (e) {}
        }

        var canvas = document.getElementById('c2canvas');
        if (canvas) {
            canvas.style.willChange =
                _fps60Enabled ? 'transform' : 'auto';
            canvas.style.backfaceVisibility =
                _fps60Enabled ? 'hidden' : 'visible';
        }
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        if (rt) {
            rt.__uwpFramePacer = null;
            rt.last_tick_time = 0;
            rt.redraw = true;
        }

        // Limpar frame pacer anterior antes de iniciar novo
        if (_framePaceTimer) {
            clearInterval(_framePaceTimer);
            _framePaceTimer = null;
        }

        if (_fps60Enabled && !_fpsRaf) {
            _lastFrameTime = 0;
            _fpsRaf = global.requestAnimationFrame(performanceFrame);
            // Timer de segurança: garante que o C2 não "adormeça" entre RAFs
            _framePaceTimer = setInterval(function () {
                var rtNow = typeof global.cr_getC2Runtime === 'function'
                    ? global.cr_getC2Runtime() : null;
                if (rtNow && rtNow.running_layout) rtNow.redraw = true;
            }, 8);
        } else if (!_fps60Enabled && _fpsRaf) {
            global.cancelAnimationFrame(_fpsRaf);
            _fpsRaf = 0;
            _lastFrameTime = 0;
        }
        _log('60 FPS beta: ' + (_fps60Enabled ? 'ON' : 'OFF'));
    }


    var TV_FILTERS = ['pixel', 'smooth', 'crt'];
    var TV_RESOLUTIONS = ['perfect', 'letterbox', 'fullscreen'];

    function cycleValue(values, current, delta) {
        var index = values.indexOf(current);
        if (index < 0) index = 0;
        index = (index + delta + values.length) % values.length;
        return values[index];
    }

    function persistDisplaySettings() {
        try {
            global.localStorage.setItem('dx_tv_filter', _tvFilter);
            global.localStorage.setItem(
                'dx_tv_resolution', _tvResolution);
        } catch (e) {}
    }

    function ensureTvScanlineOverlay() {
        if (_tvScanlineOverlay) return _tvScanlineOverlay;
        var overlay = document.createElement('div');
        overlay.id = 'dx-tv-scanlines';
        overlay.style.position = 'fixed';
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483000';
        overlay.style.backgroundImage =
            'repeating-linear-gradient(to bottom,' +
            'rgba(0,0,0,0) 0,rgba(0,0,0,0) 2px,' +
            'rgba(0,0,0,.22) 2px,rgba(0,0,0,.22) 4px)';
        document.body.appendChild(overlay);
        _tvScanlineOverlay = overlay;
        return overlay;
    }

    function applyDisplayFilter() {
        var canvas = document.getElementById('c2canvas');
        if (!canvas) return;
        var filter = 'none';
        if (_tvFilter === 'smooth')
            filter = 'contrast(102%) saturate(105%)';
        else if (_tvFilter === 'crt')
            filter = 'contrast(110%) saturate(108%)';
        canvas.style.setProperty('filter', filter, 'important');
        canvas.style.setProperty('-webkit-filter', filter, 'important');
        canvas.style.setProperty('image-rendering',
            _tvFilter === 'smooth' ? 'auto' : 'pixelated', 'important');

        var overlay = ensureTvScanlineOverlay();
        if (_tvFilter !== 'crt') {
            overlay.style.display = 'none';
            return;
        }
        var rect = canvas.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.left = rect.left + 'px';
        overlay.style.top = rect.top + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
    }

    function setDisplayFilter(value, persist) {
        if (TV_FILTERS.indexOf(value) < 0) return;
        _tvFilter = value;
        global.__uwpTvFilter = _tvFilter;
        if (persist) persistDisplaySettings();
        scaleCanvas();
        _log('Filtro de imagem: ' + _tvFilter);
    }

    function setDisplayResolution(value, persist) {
        if (TV_RESOLUTIONS.indexOf(value) < 0) return;
        _tvResolution = value;
        global.__uwpTvResolution = _tvResolution;
        global.__uwpFullscreen = _tvResolution === 'fullscreen';
        if (persist) persistDisplaySettings();
        scaleCanvas();
        _log('Resolucao de TV: ' + _tvResolution);
    }

    function filterLabel(language) {
        if (_tvFilter === 'smooth')
            return language === 'pt' ? 'SUAVE' : 'SMOOTH';
        if (_tvFilter === 'crt') return 'CRT';
        return 'PIXEL';
    }

    function resolutionLabel(language) {
        if (_tvResolution === 'letterbox')
            return language === 'pt' ? 'BORDAS PRETAS' : 'LETTERBOX';
        if (_tvResolution === 'fullscreen')
            return language === 'pt' ? 'TELA CHEIA' : 'FULLSCREEN';
        return 'PERFECT PIXEL';
    }

    function normalizeSpriteMode(mode) {
        mode = String(mode || 'original').toLowerCase();
        return SPRITE_MODES.indexOf(mode) >= 0 ? mode : 'original';
    }

    function spriteModeLabel(mode, language) {
        mode = normalizeSpriteMode(mode);
        if (mode === 'original') return 'ORIGINAL';
        if (mode === 'snes') return 'SNES';
        if (mode === 'mary') return 'MARY';
        return language === 'pt' ? 'ORIGINAL' : 'ORIGINAL';
    }

    function loadLocalText(path) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        if (xhr.overrideMimeType)
            xhr.overrideMimeType('application/json');
        xhr.send(null);
        if (xhr.status && xhr.status !== 200)
            throw new Error(path + ' status ' + xhr.status);
        return xhr.responseText;
    }

    function ensureSpritePack(mode) {
        mode = normalizeSpriteMode(mode);
        if (mode === 'original') return null;
        if (_spritePacks[mode]) return _spritePacks[mode];

        var definition = SPRITE_PACKS[mode];
        if (!definition) return null;

        var pack = {
            mode: mode,
            image: null,
            manifest: null,
            frames: null,
            ready: false,
            loading: true
        };
        _spritePacks[mode] = pack;

        try {
            pack.manifest = JSON.parse(loadLocalText(definition.manifest));
        } catch (e) {
            pack.loading = false;
            _log('Falha ao ler sprite pack ' + mode + ': ' + e.message);
            return pack;
        }

        var img = new Image();
        pack.image = img;
        img.onload = function () {
            pack.ready = true;
            pack.loading = false;
            _spriteCanvases[mode] = null;
            _spriteApplied = null;
            _log('Sprite pack carregado: ' + mode);
            applySpriteMode();
        };
        img.onerror = function () {
            pack.loading = false;
            _log('Falha ao carregar sprite pack ' + mode);
        };
        img.src = definition.image;
        return pack;
    }

    function getPlayableSpriteFrames(pack) {
        if (!pack || !pack.manifest || !pack.manifest.frames) return [];
        if (pack.frames) return pack.frames;
        var source = pack.manifest.frames;
        var frames = [];
        for (var i = 0; i < source.length; i++) {
            var frame = source[i];
            if (!frame || frame.playable === false) continue;
            if (frame.w > 0 && frame.h > 0)
                frames.push(frame);
        }
        if (!frames.length) {
            for (var j = 0; j < source.length; j++) {
                if (source[j] && source[j].w > 0 && source[j].h > 0)
                    frames.push(source[j]);
            }
        }
        pack.frames = frames;
        _log('Sprite pack ' + pack.mode + ': ' + frames.length +
            ' frames jogaveis');
        return frames;
    }

    function capturePlayerFrameState(rt) {
        if (_playerFrameState && _playerFrameState.length)
            return _playerFrameState;
        _playerFrameState = [];
        if (!rt || !rt.types_by_index) return _playerFrameState;

        for (var ti = 0; ti < rt.types_by_index.length; ti++) {
            var type = rt.types_by_index[ti];
            if (!type || !type.all_frames) continue;
            for (var fi = 0; fi < type.all_frames.length; fi++) {
                var frame = type.all_frames[fi];
                if (!frame || frame.texture_file !== 'playerx-sheet0.png') continue;
                _playerFrameState.push({
                    type: type,
                    frame: frame,
                    originalImage: frame.texture_img
                });
            }
        }
        if (_playerFrameState.length)
            _log('Frames do jogador capturados: ' + _playerFrameState.length);
        return _playerFrameState;
    }

    function buildSpriteModeCanvas(rt, mode) {
        mode = normalizeSpriteMode(mode);
        if (mode === 'original') return null;
        if (_spriteCanvases[mode]) return _spriteCanvases[mode];
        var pack = ensureSpritePack(mode);
        if (!pack || !pack.ready || !pack.image ||
            !pack.image.complete || !pack.image.width) return null;
        var frames = capturePlayerFrameState(rt);
        if (!frames.length || !frames[0].originalImage) return null;
        var boxes = getPlayableSpriteFrames(pack);
        if (!boxes.length) return null;

        var source = frames[0].originalImage;
        var canvas = document.createElement('canvas');
        canvas.width = source.naturalWidth || source.width || 512;
        canvas.height = source.naturalHeight || source.height || 512;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (var i = 0; i < frames.length; i++) {
            var frame = frames[i].frame;
            var box = boxes[i % boxes.length];
            var dw = frame.width;
            var dh = frame.height;
            var scale = Math.min((dw - 4) / box.w, (dh - 1) / box.h);
            if (!isFinite(scale) || scale <= 0) scale = 1;
            if (scale > 1.45) scale = 1.45;
            var tw = Math.max(1, Math.round(box.w * scale));
            var th = Math.max(1, Math.round(box.h * scale));
            var tx = Math.round(frame.offx + ((dw - tw) / 2));
            var ty = Math.round(frame.offy + dh - th);
            ctx.clearRect(frame.offx, frame.offy, dw, dh);
            ctx.drawImage(pack.image, box.x, box.y, box.w, box.h,
                tx, ty, tw, th);
        }

        _spriteCanvases[mode] = canvas;
        return canvas;
    }

    function replaceFrameTexture(rt, frame, image) {
        if (!frame || !image || frame.texture_img === image) return;
        try {
            if (rt.glwrap && frame.webGL_texture)
                rt.glwrap.deleteTexture(frame.webGL_texture);
        } catch (e) {}
        frame.texture_img = image;
        frame.webGL_texture = null;
        if (rt.glwrap) {
            try {
                frame.webGL_texture = rt.glwrap.loadTexture(
                    image, false, rt.linearSampling, frame.pixelformat);
            } catch (err) {
                _log('Falha ao recriar textura do sprite: ' + err.message);
            }
        }
    }

    function applySpriteMode() {
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        if (!rt || !rt.types_by_index) return;
        var frames = capturePlayerFrameState(rt);
        if (!frames.length) return;

        var activeMode = normalizeSpriteMode(_spriteMode);
        var image = null;
        if (activeMode !== 'original') {
            image = buildSpriteModeCanvas(rt, activeMode);
            if (!image) return;
        }

        if (_spriteApplied === activeMode) return;
        var touchedTypes = [];
        for (var i = 0; i < frames.length; i++) {
            var targetImage = activeMode !== 'original'
                ? image : frames[i].originalImage;
            replaceFrameTexture(rt, frames[i].frame, targetImage);
            if (touchedTypes.indexOf(frames[i].type) === -1)
                touchedTypes.push(frames[i].type);
        }
        for (var t = 0; t < touchedTypes.length; t++) {
            if (typeof touchedTypes[t].updateAllCurrentTexture === 'function')
                touchedTypes[t].updateAllCurrentTexture();
            touchedTypes[t].has_loaded_textures = !!rt.glwrap;
        }
        _spriteApplied = activeMode;
        rt.redraw = true;
        _log('Sprite mode: ' + activeMode);
    }

    function setSpriteMode(mode, persist) {
        if (!SPRITE_SELECTION_ENABLED)
            mode = 'original';
        _spriteMode = normalizeSpriteMode(mode);
        if (persist) {
            try {
                global.localStorage.setItem('dx_sprite_mode', _spriteMode);
                global.localStorage.setItem('dx_snes_sprite',
                    _spriteMode === 'snes' ? '1' : '0');
            } catch (e) {}
        }
        if (_spriteMode !== 'original') ensureSpritePack(_spriteMode);
        _spriteApplied = null;
        applySpriteMode();
    }

    function cycleSpriteMode(delta, persist) {
        var current = SPRITE_MODES.indexOf(normalizeSpriteMode(_spriteMode));
        if (current < 0) current = 0;
        var next = (current + delta + SPRITE_MODES.length) %
            SPRITE_MODES.length;
        setSpriteMode(SPRITE_MODES[next], persist);
    }

    function setSnesSpriteMode(enabled, persist) {
        setSpriteMode(enabled ? 'snes' : 'original', persist);
    }

    function hideExtraSpriteOverlay() {
        if (_extraSpriteOverlay)
            _extraSpriteOverlay.root.style.display = 'none';
    }

    function hideExtraSpriteObjects(rt) {
        if (!rt || !rt.getObjectByUID) return;
        var objects = [900120, 900121];
        for (var i = 0; i < objects.length; i++) {
            var instance = rt.getObjectByUID(objects[i]);
            if (!instance) continue;
            instance.visible = false;
            instance.opacity = 0;
            if (typeof instance.set_bbox_changed === 'function')
                instance.set_bbox_changed();
        }
        rt.redraw = true;
    }

    function ensureExtraSpriteOverlay() {
        if (_extraSpriteOverlay) return _extraSpriteOverlay;
        var root = document.createElement('div');
        var label = document.createElement('span');
        var value = document.createElement('span');
        root.id = 'dx-sprite-option';
        root.style.position = 'fixed';
        root.style.left = '0';
        root.style.top = '0';
        root.style.zIndex = '2147483647';
        root.style.pointerEvents = 'none';
        root.style.display = 'none';
        label.style.position = 'fixed';
        value.style.position = 'fixed';
        label.style.fontFamily = 'monospace';
        value.style.fontFamily = 'monospace';
        label.style.fontWeight = 'bold';
        value.style.fontWeight = 'bold';
        label.style.textShadow = '1px 1px 0 #001030';
        value.style.textShadow = '1px 1px 0 #001030';
        root.appendChild(label);
        root.appendChild(value);
        document.body.appendChild(root);
        _extraSpriteOverlay = { root: root, label: label, value: value };
        return _extraSpriteOverlay;
    }

    function updateExtraSpriteOverlayLegacy(active) {
        var canvas = document.getElementById('c2canvas');
        if (!canvas) {
            hideExtraSpriteOverlay();
            return;
        }
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            hideExtraSpriteOverlay();
            return;
        }
        var overlay = ensureExtraSpriteOverlay();
        var language = global.DXLocalization
            ? global.DXLocalization.getLanguage() : 'en';
        var scaleX = rect.width / 240;
        var scaleY = rect.height / 160;
        var y = rect.top + (116 * scaleY);
        var fontSize = Math.max(8, Math.round(8 * scaleY));
        var color = active ? '#ffffff' : '#78d8ff';
        overlay.root.style.display = 'block';
        overlay.label.textContent = language === 'pt'
            ? 'SPRITES SNES' : 'SNES SPRITES';
        overlay.value.textContent = (_spriteMode === 'snes')
            ? (language === 'pt' ? 'SIM' : 'ON')
            : (language === 'pt' ? 'NÃO' : 'OFF');
        overlay.label.style.left = (rect.left + (24 * scaleX)) + 'px';
        overlay.label.style.top = y + 'px';
        overlay.value.style.left = (rect.left + (184 * scaleX)) + 'px';
        overlay.value.style.top = y + 'px';
        overlay.label.style.fontSize = fontSize + 'px';
        overlay.value.style.fontSize = fontSize + 'px';
        overlay.label.style.color = color;
        overlay.value.style.color = color;
    }

    function updateExtraSpriteOverlay(active) {
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        if (!SPRITE_SELECTION_ENABLED) {
            hideExtraSpriteObjects(rt);
            hideExtraSpriteOverlay();
            return;
        }
        var labelObject = rt && rt.getObjectByUID
            ? rt.getObjectByUID(900120) : null;
        var valueObject = rt && rt.getObjectByUID
            ? rt.getObjectByUID(900121) : null;
        if (labelObject && valueObject) {
            hideExtraSpriteOverlay();
            var languageObject = global.DXLocalization
                ? global.DXLocalization.getLanguage() : 'en';
            labelObject.x = 24;
            labelObject.y = 116;
            valueObject.x = 168;
            valueObject.y = 116;
            labelObject.visible = true;
            valueObject.visible = true;
            labelObject.opacity = active ? 1 : 0.75;
            valueObject.opacity = active ? 1 : 0.75;
            setSpriteFontText(labelObject, 'SPRITE');
            setSpriteFontText(valueObject,
                spriteModeLabel(_spriteMode, languageObject));
            if (typeof labelObject.set_bbox_changed === 'function')
                labelObject.set_bbox_changed();
            if (typeof valueObject.set_bbox_changed === 'function')
                valueObject.set_bbox_changed();
            if (rt) rt.redraw = true;
            return;
        }

        var canvas = document.getElementById('c2canvas');
        if (!canvas) {
            hideExtraSpriteOverlay();
            return;
        }
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            hideExtraSpriteOverlay();
            return;
        }
        var overlay = ensureExtraSpriteOverlay();
        var language = global.DXLocalization
            ? global.DXLocalization.getLanguage() : 'en';
        var scaleX = rect.width / 240;
        var scaleY = rect.height / 160;
        var y = rect.top + (116 * scaleY);
        var fontSize = Math.max(8, Math.round(8 * scaleY));
        var color = active ? '#ffffff' : '#78d8ff';
        overlay.root.style.display = 'block';
        overlay.label.textContent = 'SPRITES';
        overlay.value.textContent = spriteModeLabel(_spriteMode, language);
        overlay.label.style.left = (rect.left + (24 * scaleX)) + 'px';
        overlay.label.style.top = y + 'px';
        overlay.value.style.left = (rect.left + (168 * scaleX)) + 'px';
        overlay.value.style.top = y + 'px';
        overlay.label.style.fontSize = fontSize + 'px';
        overlay.value.style.fontSize = fontSize + 'px';
        overlay.label.style.color = color;
        overlay.value.style.color = color;
    }

    function pollPerformanceOption() {
        try {
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            if (!rt || !rt.running_layout) return;
            if (rt.running_layout.name !== 'Extra') {
                _fpsActionPressed = false;
                _spriteActionPressed = false;
                _extraSyntheticSelected = false;
                _extraNavPressed = false;
                _lastExtraSelected = -1;
                hideExtraSpriteOverlay();
                return;
            }

            var cursor = rt.getObjectByUID(1957);
            var value = rt.getObjectByUID(900102);
            var language = global.DXLocalization
                ? global.DXLocalization.getLanguage() : 'en';
            setSpriteFontText(value, _fps60Enabled
                ? (language === 'pt' ? 'SIM' : 'ON')
                : (language === 'pt' ? 'NÃO' : 'OFF'));

            var selected = cursor && cursor.instance_vars
                ? Number(cursor.instance_vars[2]) : -1;
            updateExtraSpriteOverlay(false);

            var pads = navigator.getGamepads ? navigator.getGamepads() : [];
            var gp = null;
            for (var i = 0; i < pads.length; i++) {
                if (pads[i] && pads[i].connected) {
                    gp = pads[i];
                    break;
                }
            }
            if (!gp) return;

            var left = !!(gp.buttons[BTN.DPAD_LEFT] &&
                gp.buttons[BTN.DPAD_LEFT].pressed);
            var right = !!(gp.buttons[BTN.DPAD_RIGHT] &&
                gp.buttons[BTN.DPAD_RIGHT].pressed);
            var axis = gp.axes && gp.axes.length ? gp.axes[0] : 0;
            var pressed = left || right || axis < -0.6 || axis > 0.6;
            if (selected === 5 && pressed && !_fpsActionPressed)
                set60FpsMode(right || axis > 0.6, true);
            _fpsActionPressed = selected === 5 && pressed;
            _spriteActionPressed = false;
            _extraSyntheticSelected = false;
            _lastExtraSelected = selected;
        } catch (e) {
            _log('Opcoes Extras erro: ' + e.message);
        }
    }

    function releaseSyntheticKeys() {
        for (var id in prevState) {
            if (prevState[id] && KEY_MAP[id])
                fireKey(KEY_MAP[id], 'keyup');
        }
        prevState = {};
        axisState = { left: false, right: false, up: false, down: false };
        axis2State = { left: false, right: false, up: false, down: false };
    }

    function setKeyboardMode(enabled) {
        _keyboardMode = !!enabled;
        global.__uwpKeyboardMode = _keyboardMode;
        if (_keyboardMode) {
            startFallback();
            _log('Modo de entrada: TECLADO (L3+R3)');
        } else {
            stopFallback();
            releaseSyntheticKeys();
            _log('Modo de entrada: GAMEPAD (L3+R3)');
        }
    }

    function pollInputModeCombo() {
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        var gp = null;
        for (var i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) {
                gp = pads[i];
                break;
            }
        }
        if (!gp) {
            _stickComboPressed = false;
            return;
        }

        var l3 = !!(gp.buttons[BTN.L3] && gp.buttons[BTN.L3].pressed);
        var r3 = !!(gp.buttons[BTN.R3] && gp.buttons[BTN.R3].pressed);
        var combo = l3 && r3;
        if (combo && !_stickComboPressed)
            setKeyboardMode(!_keyboardMode);
        _stickComboPressed = combo;
    }

    // ── FALLBACK POLL (quando o C2 não gerencia o gamepad nativamente) ────────
    function startFallback() {
        if (_fallbackTimer) return;
        _fallbackTimer  = setInterval(fallbackPoll, CFG.fallbackPollMs);
        _fallbackActive = true;
        _log('Fallback de teclado ATIVO');
    }

    function stopFallback() {
        if (!_fallbackTimer) return;
        clearInterval(_fallbackTimer);
        _fallbackTimer  = null;
        _fallbackActive = false;
        _log('Fallback de teclado PARADO');
    }

    function fallbackPoll() {
        var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        var gp = null;
        for (var i = 0; i < gamepads.length; i++)
            if (gamepads[i] && gamepads[i].connected) { gp = gamepads[i]; break; }
        if (!gp) return;

        frameCount++;
        if (frameCount % CFG.logEveryNFrames === 0)
            _log('Fallback poll ok. Gamepad: ' + gp.id.substring(0, 40));

        for (var b = 0; b < gp.buttons.length; b++) {
            var btn = gp.buttons[b];
            var pressed = (b === BTN.LT || b === BTN.RT)
                ? btn.value > CFG.triggerThreshold : btn.pressed;
            handleButton(b, pressed);
        }
        handleAxes(gp.axes);
    }

    function pollAutoSaveAnyPrompt() {
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        var layout = rt && rt.running_layout ? rt.running_layout.name : '';
        if (layout !== 'Auto Save') {
            _autoSaveAnyButtonPressed = false;
            _autoSavePromptPending = false;
            _autoSavePromptTriggered = false;
            return;
        }
        if (_fallbackActive) return;

        // FIX PT-BR crash: se os objetos traduzidos estão visíveis, o jogo já está
        // usando o sistema de localização para detectar input — não devemos enviar
        // Enter sintético, pois isso causaria duplo-trigger e crash.
        if (rt && rt.getObjectByUID) {
            var ptbrObj = rt.getObjectByUID(900320);
            if (ptbrObj && ptbrObj.visible && ptbrObj.opacity > 0) {
                // Os objetos PT-BR estão ativos — o Construct 2 vai capturar o
                // botão diretamente; não precisamos de fallback sintético.
                _autoSaveAnyButtonPressed = false;
                _autoSavePromptPending = false;
                _autoSavePromptTriggered = false;
                return;
            }
        }

        var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        var gp = null;
        for (var i = 0; i < gamepads.length; i++)
            if (gamepads[i] && gamepads[i].connected) { gp = gamepads[i]; break; }
        if (!gp) return;

        var pressed = false;
        for (var b = 0; b < gp.buttons.length; b++) {
            var button = gp.buttons[b];
            if (!button) continue;
            if ((b === BTN.LT || b === BTN.RT)
                ? button.value > CFG.triggerThreshold : button.pressed) {
                pressed = true;
                break;
            }
        }

        if (pressed && !_autoSaveAnyButtonPressed &&
            !_autoSavePromptPending && !_autoSavePromptTriggered) {
            _autoSavePromptPending = true;
            setTimeout(function () {
                _autoSavePromptPending = false;
                var current = typeof global.cr_getC2Runtime === 'function'
                    ? global.cr_getC2Runtime() : null;
                var currentLayout = current && current.running_layout
                    ? current.running_layout.name : '';
                if (currentLayout !== 'Auto Save') return;
                // Verificação adicional: checar novamente se PT-BR não está ativo
                if (current && current.getObjectByUID) {
                    var ptbrCheck = current.getObjectByUID(900320);
                    if (ptbrCheck && ptbrCheck.visible && ptbrCheck.opacity > 0) return;
                }
                _autoSavePromptTriggered = true;
                _log('Auto Save: fallback de Enter apos gamepad nativo');
                fireKey(KEY_MAP[BTN.MENU], 'keydown');
                setTimeout(function () {
                    fireKey(KEY_MAP[BTN.MENU], 'keyup');
                }, 60);
            }, 120);
        }
        _autoSaveAnyButtonPressed = pressed;
    }

    // ── DETECÇÃO C2 GAMEPAD ────────────────────────────────────────────────────
    function checkC2GamepadActive() {
        try {
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            if (!rt || !global.cr || !global.cr.plugins_ ||
                !global.cr.plugins_.gamepad || !rt.types_by_index) {
                return false;
            }
            for (var i = 0; i < rt.types_by_index.length; i++) {
                var type = rt.types_by_index[i];
                if (type && type.plugin &&
                    type.plugin instanceof global.cr.plugins_.gamepad) {
                    return true;
                }
            }
            return false;
        } catch (e) { return false; }
    }

    function forceGamepadDetection() {
        var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (var i = 0; i < gamepads.length; i++) {
            var gp = gamepads[i];
            if (!gp || !gp.connected) continue;
            _log('Forçando gamepadconnected para: "' + gp.id + '"');
            try {
                var ev;
                if (typeof GamepadEvent !== 'undefined') {
                    ev = new GamepadEvent('gamepadconnected', { gamepad: gp, bubbles: true });
                } else {
                    ev = new Event('gamepadconnected', { bubbles: true });
                    ev.gamepad = gp;
                }
                window.dispatchEvent(ev);
            } catch (e) { _log('Erro ao forçar gamepadconnected: ' + e.message); }
        }
    }

    // ── WEBAUDIO UNLOCK ─────────────────────────────────────────────────────
    function unlockWebAudio() {
        try {
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            var c2ctx = rt && rt.audio_context;
            if (c2ctx && c2ctx.state === 'suspended' && c2ctx.resume) {
                var c2resume = c2ctx.resume();
                if (c2resume && c2resume.catch) {
                    c2resume.catch(function (e) {
                        _log('C2 AudioContext resume: ' + e.message);
                    });
                }
            }
            if (c2ctx && c2ctx.state === 'running') {
                _audioUnlocked = true;
                return;
            }
            if (_audioUnlocked) return;
            var Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            if (!_audioCtx || _audioCtx.state === 'closed') {
                _audioCtx = new Ctx();
            }
            var ctx = _audioCtx;
            if (ctx.state === 'suspended') {
                var resumed = ctx.resume();
                if (resumed && resumed.catch) {
                    resumed.catch(function (e) { _log('AudioContext resume: ' + e.message); });
                }
            }
            var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
            var src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
            _audioUnlocked = true;
            _log('WebAudio unlocked');
        } catch (e) { _log('WebAudio unlock falhou: ' + e.message); }
    }

    // ── ESCALA DO CANVAS (pixel-perfect) ─────────────────────────────────────
    var _lastScaleLog = '';

    function getTvViewport() {
        var doc = document.documentElement || {};
        var body = document.body || {};
        var raw = [
            [_displayMetrics && _displayMetrics.viewWidth,
                _displayMetrics && _displayMetrics.viewHeight, 'uwp.view'],
            [global.innerWidth, global.innerHeight, 'inner'],
            [doc.clientWidth, doc.clientHeight, 'document'],
            [body.clientWidth, body.clientHeight, 'body'],
            [screen && screen.availWidth, screen && screen.availHeight,
                'screen.avail'],
            [screen && screen.width, screen && screen.height, 'screen']
        ];
        var candidates = [];
        for (var i = 0; i < raw.length; i++) {
            var w = Number(raw[i][0]) || 0;
            var h = Number(raw[i][1]) || 0;
            if (w >= 240 && h >= 160)
                return { w: w, h: h, source: raw[i][2] };
        }
        return { w: 1280, h: 720, source: 'fallback' };
    }

    function getSafeTvBounds(viewport) {
        var left = 0;
        var right = 0;
        var top = 0;
        var bottom = 0;
        var metrics = _displayMetrics;

        if (metrics && Number(metrics.visibleWidth) > 0 &&
            Number(metrics.visibleHeight) > 0) {
            var hostWidth = Number(metrics.windowWidth) ||
                Number(metrics.viewWidth) || viewport.w;
            var hostHeight = Number(metrics.windowHeight) ||
                Number(metrics.viewHeight) || viewport.h;
            var scaleX = viewport.w / hostWidth;
            var scaleY = viewport.h / hostHeight;
            var visibleX = Math.max(0, Number(metrics.visibleX) || 0);
            var visibleY = Math.max(0, Number(metrics.visibleY) || 0);
            var hostLeft = Math.round(visibleX * scaleX);
            var hostTop = Math.round(visibleY * scaleY);
            var hostRight = Math.round(Math.max(0,
                hostWidth - visibleX - Number(metrics.visibleWidth)) * scaleX);
            var hostBottom = Math.round(Math.max(0,
                hostHeight - visibleY - Number(metrics.visibleHeight)) * scaleY);
            left = Math.max(left, hostLeft);
            right = Math.max(right, hostRight);
            top = Math.max(top, hostTop);
            bottom = Math.max(bottom, hostBottom);
        }

        var width = Math.max(240, viewport.w - left - right);
        var height = Math.max(160, viewport.h - top - bottom);
        if (width > viewport.w || height > viewport.h)
            return { x: 0, y: 0, w: viewport.w, h: viewport.h };
        return { x: left, y: top, w: width, h: height };
    }

    function scaleCanvas() {
        var canvas = document.getElementById('c2canvas');
        var div    = document.getElementById('c2canvasdiv');
        if (!canvas) return;

        var viewport = getTvViewport();
        var safe = getSafeTvBounds(viewport);
        var mode = _tvResolution;
        var cw;
        var ch;
        if (mode === 'fullscreen') {
            cw = safe.w;
            ch = safe.h;
        } else if (mode === 'letterbox') {
            var fitScale = Math.min(safe.w / 240, safe.h / 160);
            cw = Math.floor(240 * fitScale);
            ch = Math.floor(160 * fitScale);
        } else {
            var scale = Math.floor(Math.min(safe.w / 240,
                safe.h / 160));
            if (scale < 1) scale = Math.min(safe.w / 240,
                safe.h / 160);
            cw = Math.floor(240 * scale);
            ch = Math.floor(160 * scale);
        }

        var canvasLeft = Math.round(safe.x + ((safe.w - cw) / 2));
        var canvasTop = Math.round(safe.y + ((safe.h - ch) / 2));

        canvas.style.setProperty('position', 'fixed', 'important');
        canvas.style.setProperty('left', canvasLeft + 'px', 'important');
        canvas.style.setProperty('top', canvasTop + 'px', 'important');
        canvas.style.setProperty('width', cw + 'px', 'important');
        canvas.style.setProperty('height', ch + 'px', 'important');
        canvas.style.setProperty('max-width', safe.w + 'px', 'important');
        canvas.style.setProperty('max-height', safe.h + 'px', 'important');

        if (div) {
            div.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'display:flex;align-items:center;justify-content:center;' +
                'background:#000;';
        }
        applyDisplayFilter();
        var logKey = viewport.source + ':' + viewport.w + 'x' + viewport.h +
            ':' + mode +
            ':safe=' + safe.x + ',' + safe.y + ',' + safe.w + 'x' + safe.h +
            ':' + _tvFilter +
            '->' + cw + 'x' + ch;
        if (logKey !== _lastScaleLog) {
            _lastScaleLog = logKey;
            _log('TV viewport ' + viewport.source + '=' + viewport.w + 'x' +
                viewport.h + ' | mode=' +
                mode +
                ' | safe=' + safe.x + ',' + safe.y + ' ' +
                safe.w + 'x' + safe.h +
                ' | filter=' + _tvFilter +
                ' | canvas=' + cw + 'x' + ch);
        }
    }

    global.addEventListener('resize', scaleCanvas);
    global.__uwpSetWindowWidth = function (width) {
        global.__uwpRequestedWidth = Number(width) || 0;
        scaleCanvas();
    };
    global.__uwpSetWindowHeight = function (height) {
        global.__uwpRequestedHeight = Number(height) || 0;
        scaleCanvas();
    };
    global.__uwpSetDisplayMetrics = function (metrics) {
        _displayMetrics = metrics || null;
        global.__uwpDisplayMetrics = _displayMetrics;
        scaleCanvas();
        setTimeout(scaleCanvas, 100);
    };
    global.__uwpSetFullscreen = function (enabled) {
        global.__uwpFullscreen = _tvResolution === 'fullscreen';
        _log('Pedido de fullscreen do Construct ignorado; modo atual=' +
            _tvResolution + ' request=' + !!enabled);
        scaleCanvas();
        try { global.dispatchEvent(new Event('resize')); } catch (e) {}
        setTimeout(scaleCanvas, 50);
        setTimeout(scaleCanvas, 250);
        setTimeout(scaleCanvas, 750);
    };

    if (screen.orientation && typeof screen.orientation.lock === 'function')
        screen.orientation.lock('landscape').catch(function () {});

    // ── CSS DE TELA (cursor, canvas, sem scroll) ──────────────────────────────
    // Feito aqui no JS (herdado da v1.1) em vez de round-trip C#→WebView.InvokeScriptAsync,
    // assim funciona mesmo se a injeção do bridge pelo C# atrasar.
    function injectCss() {
        if (document.getElementById('uwp-css')) return;
        var s = document.createElement('style');
        s.id = 'uwp-css';
        s.textContent =
            'html,body{margin:0!important;padding:0!important;overflow:hidden!important;' +
            'background:#000!important;width:100vw!important;height:100vh!important;}' +
            '#c2canvasdiv{position:fixed!important;top:0!important;left:0!important;' +
            'width:100%!important;height:100%!important;display:flex!important;' +
            'align-items:center!important;justify-content:center!important;background:#000!important;}' +
            '#c2canvas{display:block!important;image-rendering:pixelated!important;' +
            'image-rendering:crisp-edges!important;max-width:96vw!important;' +
            'max-height:96vh!important;}' +
            '*{cursor:none!important;touch-action:none;user-select:none;-webkit-user-select:none;}';
        (document.head || document.documentElement).appendChild(s);
        _log('CSS injetado');
    }

    // ── GAME READY — espera o C2 inicializar antes de avisar o C# ─────────────
    // Evita esconder o overlay de loading cedo demais (tela preta enquanto o
    // motor Construct 2 ainda está de boot).
    function waitForC2AndNotify() {
        var tries = 0;
        (function check() {
            tries++;
            var rt = typeof global.cr_getC2Runtime === 'function'
                ? global.cr_getC2Runtime() : null;
            var ready = !!(rt && rt.running_layout);
            if (ready || tries >= 100) { // máx 10s
                if (ready) {
                    unlockWebAudio();
                    forceGamepadDetection();
                }
                _log(ready ? 'C2 pronto ✓' : 'C2 não detectado — notificando mesmo assim');
                notifyUWP('GAME_READY');
            } else {
                setTimeout(check, 100);
            }
        })();
    }

    // ── EVENTOS ─────────────────────────────────────────────────────────────
    global.addEventListener('gamepadconnected', function (e) {
        _log('Gamepad conectado: "' + e.gamepad.id + '"');
        unlockWebAudio();
        setTimeout(function () {
            if (_keyboardMode) {
                startFallback();
            } else if (checkC2GamepadActive()) {
                _log('C2 gamepad plugin ativo — parando fallback');
                stopFallback();
            } else {
                _log('C2 não detectou gamepad — ativando fallback');
                startFallback();
            }
        }, CFG.c2DetectTimeoutMs);
    });

    global.addEventListener('gamepaddisconnected', function () {
        _log('Gamepad desconectado — limpando estado');
        for (var id in prevState)
            if (prevState[id] && KEY_MAP[id]) fireKey(KEY_MAP[id], 'keyup');
        prevState  = {};
        axisState  = { left: false, right: false, up: false, down: false };
        axis2State = { left: false, right: false, up: false, down: false };
    });

    document.addEventListener('keydown', function () { unlockWebAudio(); }, { passive: true });
    document.addEventListener('uwpSuspend', function () { stopFallback(); });
    document.addEventListener('uwpResume',  function () {
        if (_keyboardMode) startFallback();
        setTimeout(forceGamepadDetection, 300);
    });
    document.addEventListener('uwpGamepadAdded', function () {
        _log('UWP: gamepad adicionado (evento C#)');
        setTimeout(forceGamepadDetection, 200);
    });
    document.addEventListener('uwpStateLoaded', function (e) {
        _log('UWP: save state recebido do C#');
    });

    // ── INIT ────────────────────────────────────────────────────────────────
    function init() {
        global.__uwpKeyboardMode = false;
        global.__uwp60FpsBeta = _fps60Enabled;
        global.__uwpTvFilter = _tvFilter;
        global.__uwpTvResolution = _tvResolution;
        global.__uwpFullscreen = _tvResolution === 'fullscreen';
        _log('DXtreme UWP Bridge v4.0 iniciando (WebView nativo)...');
        _log('KEY_MAP teclado: A=z B=x X=a Y=s LB=q RB=e LT/RT=Space');
        _log('L3+R3 alterna entre gamepad nativo e modo teclado');
        injectCss();
        scaleCanvas();
        setTimeout(scaleCanvas, 50);
        setTimeout(scaleCanvas, 250);
        setTimeout(scaleCanvas, 1000);
        set60FpsMode(_fps60Enabled, false);
        setSpriteMode(_spriteMode, false);
        forceGamepadDetection();

        var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        var hasGp = false;
        for (var i = 0; i < gamepads.length; i++)
            if (gamepads[i] && gamepads[i].connected) { hasGp = true; break; }

        if (hasGp) {
            unlockWebAudio();
            _log('Controle detectado na abertura — verificando C2 em ' + (CFG.c2DetectTimeoutMs + 500) + 'ms');
            setTimeout(function () {
                if (_keyboardMode) {
                    startFallback();
                } else if (!checkC2GamepadActive()) {
                    _log('C2 não detectou — ativando fallback');
                    startFallback();
                } else {
                    _log('C2 gerenciando gamepad nativo — OK');
                }
            }, CFG.c2DetectTimeoutMs + 500);
        } else {
            _log('Sem controle detectado — fallback preventivo ativo');
            startFallback();
        }

        waitForC2AndNotify();
        setInterval(pollLanguageOption, 50);
        setInterval(pollPresentationSettings, 50);
        setInterval(pollPerformanceOption, 50);
        setInterval(pollAutoSaveAnyPrompt, 50);
        setInterval(applySpriteMode, 500);
        setInterval(pollInputModeCombo, CFG.fallbackPollMs);
        _log('Bridge pronto');
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        setTimeout(init, 200);

    // ── API PÚBLICA ─────────────────────────────────────────────────────────
    global.__xboxBridge = {
        startFallback: startFallback,
        stopFallback:  stopFallback,
        forceGamepad:  forceGamepadDetection,
        isActive:      function () { return _fallbackActive; },
        scaleCanvas:   scaleCanvas,
        unlockAudio:   unlockWebAudio,
        vibrate:       vibrate,
        saveState:     saveState,
        loadState:     loadState,
        set60Fps:      function (enabled) {
            set60FpsMode(enabled, true);
        },
        is60Fps:       function () { return _fps60Enabled; },
        setSnesSprites:function (enabled) {
            setSnesSpriteMode(enabled, true);
        },
        isSnesSprites: function () { return _spriteMode === 'snes'; },
        setSpriteMode:  function (mode) { setSpriteMode(mode, true); },
        getSpriteMode:  function () { return _spriteMode; },
        setTvFilter:    function (value) {
            setDisplayFilter(value, true);
        },
        setTvResolution:function (value) {
            setDisplayResolution(value, true);
        },
        getTvSettings:  function () {
            return {
                filter: _tvFilter,
                resolution: _tvResolution
            };
        },
        cfg:           CFG,
    };

})(window);
