(function (global) {
    'use strict';

    var STORAGE_KEY = 'dx_language';
    var language = 'en';
    var menuDescriptions = {
        'Adjust the volume of Sound Effects': 'Ajustar volume dos efeitos',
        'Adjust the volume of Music': 'Ajustar volume da música',
        'Adjust the game screen size (locked in Full Screen)': 'Ajustar escala (bloqueada em tela cheia)',
        'Adjust the game screen size (locked in browser)': 'Ajustar escala (bloqueada no navegador)',
        'Toggle Fullscreen': 'Ativar ou desativar tela cheia',
        'Choose language / Selecionar idioma': 'Selecionar idioma',
        'Run game at 60 FPS (beta)': 'Executar o jogo a 60 FPS (beta)',
        'Use the SNES Mega Man X sprite set': 'Selecionar sprite extra'
    };
    var baseCharacters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:"\'?!-0123456789';
    var accentDefinitions = [
        ['Á', 'A', 'acute'], ['À', 'A', 'grave'],
        ['Â', 'A', 'circumflex'], ['Ã', 'A', 'tilde'],
        ['É', 'E', 'acute'], ['Ê', 'E', 'circumflex'],
        ['Í', 'I', 'acute'], ['Ó', 'O', 'acute'],
        ['Ô', 'O', 'circumflex'], ['Õ', 'O', 'tilde'],
        ['Ú', 'U', 'acute'], ['Ç', 'C', 'cedilla'],
        ['á', 'a', 'acute'], ['à', 'a', 'grave'],
        ['â', 'a', 'circumflex'], ['ã', 'a', 'tilde'],
        ['é', 'e', 'acute'], ['ê', 'e', 'circumflex'],
        ['í', 'i', 'acute'], ['ó', 'o', 'acute'],
        ['ô', 'o', 'circumflex'], ['õ', 'o', 'tilde'],
        ['ú', 'u', 'acute'], ['ç', 'c', 'cedilla']
    ];
    var accentCharacters = accentDefinitions.map(function (item) {
        return item[0];
    }).join('');
    var fitStates = {};
    var uiTranslations = global.DXPTBR ? global.DXPTBR.ui : {};
    var dialogueTranslations = global.DXPTBR
        ? global.DXPTBR.dialogues : {};
    var englishByPortuguese = {};
    var englishByUiPortuguese = {};
    var englishByDialoguePortuguese = {};
    var armorTextureState = {
        applied: null,
        frames: null,
        image: null,
        loading: false
    };
    var fileMenuTextureState = {
        applied: null,
        frames: null,
        image: null,
        loading: false
    };
    var armorFontImage = new Image();
    armorFontImage.src = 'textfont.png';
    Object.keys(menuDescriptions).forEach(function (english) {
        englishByPortuguese[menuDescriptions[english]] = english;
    });
    Object.keys(uiTranslations).forEach(function (english) {
        englishByUiPortuguese[uiTranslations[english]] = english;
    });
    Object.keys(dialogueTranslations).forEach(function (english) {
        englishByDialoguePortuguese[dialogueTranslations[english]] = english;
    });

    function normalizeTranslationKey(value) {
        return String(value || '').replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n').trim();
    }

    function buildNormalizedMap(dictionary) {
        var normalized = {};
        Object.keys(dictionary).forEach(function (key) {
            normalized[normalizeTranslationKey(key)] = dictionary[key];
        });
        return normalized;
    }

    var menuDescriptionsNormalized = buildNormalizedMap(menuDescriptions);
    var uiTranslationsNormalized = buildNormalizedMap(uiTranslations);
    var dialogueTranslationsNormalized =
        buildNormalizedMap(dialogueTranslations);
    var englishByPortugueseNormalized = buildNormalizedMap(englishByPortuguese);
    var englishByUiPortugueseNormalized =
        buildNormalizedMap(englishByUiPortuguese);
    var englishByDialoguePortugueseNormalized =
        buildNormalizedMap(englishByDialoguePortuguese);

    try {
        var stored = global.localStorage.getItem(STORAGE_KEY);
        if (stored === 'pt' || stored === 'en') language = stored;
    } catch (e) {}

    function setInstanceText(instance, text) {
        if (!instance || instance.text === text) return;
        instance.text = text;
        instance.text_changed = true;
        if (instance.runtime) instance.runtime.redraw = true;
    }

    function normalizeAtlasText(value) {
        return String(value || '')
            .replace(/[ÁÀÂÃ]/g, 'A').replace(/[ÉÊ]/g, 'E')
            .replace(/Í/g, 'I').replace(/[ÓÔÕ]/g, 'O')
            .replace(/Ú/g, 'U').replace(/Ç/g, 'C')
            .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e')
            .replace(/í/g, 'i').replace(/[óôõ]/g, 'o')
            .replace(/ú/g, 'u').replace(/ç/g, 'c');
    }

    function drawAtlasText(context, text, x, y) {
        if (!armorFontImage.complete) return;
        var value = normalizeAtlasText(text);
        for (var i = 0; i < value.length; i++) {
            var ch = value.charAt(i);
            if (ch === ' ') continue;
            var index = baseCharacters.indexOf(ch);
            if (index < 0) continue;
            var columns = Math.max(1, (armorFontImage.width / 8) | 0);
            context.drawImage(armorFontImage,
                (index % columns) * 8, ((index / columns) | 0) * 8, 8, 8,
                x + (i * 8), y, 8, 8);
        }
    }

    function collectArmorFrames(rt) {
        if (armorTextureState.frames) return armorTextureState.frames;
        var source = rt.getObjectByUID(248);
        var frames = [];
        if (source && source.type && source.type.all_frames) {
            for (var i = 0; i < source.type.all_frames.length; i++) {
                var frame = source.type.all_frames[i];
                if (frame && frame.texture_file === 'pausearmorpart-sheet0.png') {
                    frames.push({
                        frame: frame,
                        type: source.type,
                        originalImage: frame.texture_img
                    });
                }
            }
        }
        armorTextureState.frames = frames;
        return frames;
    }

    function buildArmorTexture(rt) {
        if (armorTextureState.canvas) return armorTextureState.canvas;
        if (!armorFontImage.complete) return null;
        var frames = collectArmorFrames(rt);
        if (!frames.length || !frames[0].originalImage ||
            !frames[0].originalImage.complete) return null;

        var original = frames[0].originalImage;
        var canvas = document.createElement('canvas');
        canvas.width = original.naturalWidth || original.width;
        canvas.height = original.naturalHeight || original.height;
        var context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(original, 0, 0);

        var labels = [
            { clear: [72, 8, 112, 36],
                lines: [[76, 8, 'PARTE DOS PES'],
                    [76, 20, 'DASH RAPIDO'], [76, 32, 'DASH AEREO']] },
            { clear: [72, 68, 112, 28],
                lines: [[76, 68, 'PARTE DO CORPO'],
                    [76, 80, 'ESCUDO MAIOR']] },
            { clear: [72, 118, 120, 28],
                lines: [[76, 118, 'PARTE DO BRACO'],
                    [76, 130, 'CARREGA ESPECIAIS']] },
            { clear: [44, 164, 120, 18],
                lines: [[48, 164, 'PARTE DA CABECA'],
                    [48, 176, 'CARREGA ARMAS']] }
        ];

        context.fillStyle = 'rgba(0,0,0,1)';
        for (var i = 0; i < labels.length; i++) {
            var clear = labels[i].clear;
            context.fillRect(clear[0], clear[1], clear[2], clear[3]);
            for (var j = 0; j < labels[i].lines.length; j++) {
                var line = labels[i].lines[j];
                drawAtlasText(context, line[2], line[0], line[1]);
            }
        }

        armorTextureState.canvas = canvas;
        return canvas;
    }

    function replaceArmorFrameTexture(rt, frame, image) {
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
            } catch (err) {}
        }
    }

    function applyGeneratedArmorTextureLanguage(rt, isPortuguese) {
        var frames = collectArmorFrames(rt);
        if (!frames.length) return;
        var image = isPortuguese ? buildArmorTexture(rt) : null;
        if (isPortuguese && !image) return;
        if (armorTextureState.applied === isPortuguese) return;

        for (var i = 0; i < frames.length; i++) {
            replaceArmorFrameTexture(rt, frames[i].frame,
                isPortuguese ? image : frames[i].originalImage);
        }
        if (frames[0].type &&
            typeof frames[0].type.updateAllCurrentTexture === 'function')
            frames[0].type.updateAllCurrentTexture();
        armorTextureState.applied = isPortuguese;
        rt.redraw = true;
    }

    function collectTextureFrames(rt, state, textureFile) {
        if (state.frames) return state.frames;
        var frames = [];
        if (!rt || !rt.types_by_index) return frames;
        for (var ti = 0; ti < rt.types_by_index.length; ti++) {
            var type = rt.types_by_index[ti];
            if (!type || !type.all_frames) continue;
            for (var fi = 0; fi < type.all_frames.length; fi++) {
                var frame = type.all_frames[fi];
                if (!frame || frame.texture_file !== textureFile) continue;
                frames.push({
                    type: type,
                    frame: frame,
                    originalImage: frame.texture_img
                });
            }
        }
        state.frames = frames;
        return frames;
    }

    function loadReplacementImage(state, path) {
        if (state.image && state.image.complete && state.image.width)
            return state.image;
        if (state.loading) return null;

        state.loading = true;
        var image = new Image();
        state.image = image;
        image.onload = function () {
            state.loading = false;
            state.applied = null;
            applyToRuntime();
        };
        image.onerror = function () {
            state.loading = false;
        };
        image.src = path;
        return null;
    }

    function replaceLocalizationFrameTexture(rt, frame, image) {
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
            } catch (err) {}
        }
    }

    function applyReplacementTextureLanguage(rt, state, textureFile,
        replacementPath, isPortuguese) {
        var frames = collectTextureFrames(rt, state, textureFile);
        if (!frames.length) return;

        var image = null;
        if (isPortuguese) {
            image = loadReplacementImage(state, replacementPath);
            if (!image) return;
        }
        if (state.applied === isPortuguese) return;

        var touchedTypes = [];
        for (var i = 0; i < frames.length; i++) {
            replaceLocalizationFrameTexture(rt, frames[i].frame,
                isPortuguese ? image : frames[i].originalImage);
            if (touchedTypes.indexOf(frames[i].type) === -1)
                touchedTypes.push(frames[i].type);
        }
        for (var t = 0; t < touchedTypes.length; t++) {
            if (typeof touchedTypes[t].updateAllCurrentTexture === 'function')
                touchedTypes[t].updateAllCurrentTexture();
            touchedTypes[t].has_loaded_textures = !!rt.glwrap;
        }
        state.applied = isPortuguese;
        rt.redraw = true;
    }

    function applyArmorTextureLanguage(rt, isPortuguese) {
        applyReplacementTextureLanguage(rt, armorTextureState,
            'pausearmorpart-sheet0.png', 'pausearmorpart-ptbr.png',
            isPortuguese);
    }

    function applyFileMenuTextureLanguage(rt, isPortuguese) {
        applyReplacementTextureLanguage(rt, fileMenuTextureState,
            'filesmenubg-sheet0.png', 'filesmenubg-ptbr.png',
            isPortuguese);
    }

    function syncArmorTranslation(rt, isPortuguese) {
        applyArmorTextureLanguage(rt, isPortuguese);
        var overlayUids = [900330, 900331, 900332, 900333, 900334,
            900335, 900336, 900337, 900338];
        for (var i = 0; i < overlayUids.length; i++)
            setVisible(rt, overlayUids[i], false);
    }

    function fontConfig(textureFile) {
        var name = String(textureFile || '').replace(/\\/g, '/')
            .split('/').pop().toLowerCase();
        if (name === 'textfont.png')
            return { base: baseCharacters + '()/©', width: 8, height: 8 };
        if (name === 'dialogfont.png')
            return { base: baseCharacters, width: 8, height: 8 };
        return null;
    }

    function drawAccent(context, x, y, kind) {
        context.fillStyle = '#ffffff';
        if (kind === 'acute') {
            context.fillRect(x + 4, y, 2, 1);
            context.fillRect(x + 3, y + 1, 1, 1);
        } else if (kind === 'grave') {
            context.fillRect(x + 2, y, 2, 1);
            context.fillRect(x + 4, y + 1, 1, 1);
        } else if (kind === 'circumflex') {
            context.fillRect(x + 3, y, 2, 1);
            context.fillRect(x + 2, y + 1, 1, 1);
            context.fillRect(x + 5, y + 1, 1, 1);
        } else if (kind === 'tilde') {
            context.fillRect(x + 2, y, 2, 1);
            context.fillRect(x + 4, y + 1, 2, 1);
        } else if (kind === 'cedilla') {
            context.fillRect(x + 3, y + 7, 2, 1);
            context.fillRect(x + 4, y + 6, 1, 1);
        }
    }

    function extendFontImage(type, image, config) {
        if (type.__dxExtendedFont || !image.width || !image.height) return;
        var columns = Math.floor(image.width / config.width);
        var total = config.base.length + accentDefinitions.length;
        var rows = Math.ceil(total / columns);
        var canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = rows * config.height;
        var context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0);

        for (var i = 0; i < accentDefinitions.length; i++) {
            var definition = accentDefinitions[i];
            var sourceIndex = config.base.indexOf(definition[1]);
            var targetIndex = config.base.length + i;
            var sx = (sourceIndex % columns) * config.width;
            var sy = Math.floor(sourceIndex / columns) * config.height;
            var tx = (targetIndex % columns) * config.width;
            var ty = Math.floor(targetIndex / columns) * config.height;
            if (definition[2] === 'cedilla') {
                context.drawImage(image, sx, sy, config.width,
                    config.height - 1, tx, ty, config.width,
                    config.height - 1);
            } else {
                context.drawImage(image, sx, sy, config.width,
                    config.height - 1, tx, ty + 1, config.width,
                    config.height - 1);
            }
            drawAccent(context, tx, ty, definition[2]);
        }
        type.texture_img = canvas;
        type.__dxExtendedFont = true;
    }

    function prepareFontType(type) {
        var config = fontConfig(type && type.texture_file);
        var image = type && type.texture_img;
        if (!config || !image || type.__dxExtendedFont) return;
        if (typeof type.__dxExtendedFont === 'undefined')
            type.__dxExtendedFont = false;
        var apply = function () {
            extendFontImage(type, image, config);
        };
        if (image.complete && image.width) apply();
        else if (image.addEventListener)
            image.addEventListener('load', apply, false);
    }

    function extendCharacterSet(characterSet, textureFile) {
        var config = fontConfig(textureFile);
        if (!config) return characterSet;
        return config.base + accentCharacters;
    }

    function applyAccentWidths(instance) {
        if (!instance || !instance.characterWidthList) return;
        for (var i = 0; i < accentDefinitions.length; i++) {
            var accented = accentDefinitions[i][0];
            var base = accentDefinitions[i][1];
            if (instance.characterWidthList[base])
                instance.characterWidthList[accented] =
                    instance.characterWidthList[base];
        }
    }

    function fitInstanceText(instance) {
        if (!instance || typeof instance.rebuildText !== 'function' ||
            typeof instance.characterScale !== 'number') return;
        var config = fontConfig(instance.type && instance.type.texture_file);
        if (!config) return;
        var stateKey = String(instance.uid);
        var state = fitStates[stateKey];
        if (!state) {
            state = {
                baseScale: instance.characterScale,
                text: null,
                language: null
            };
            fitStates[stateKey] = state;
        }
        if (state.text === instance.text &&
            state.language === language) return;
        state.text = instance.text;
        state.language = language;

        var targetScale = state.baseScale;
        if (language === 'pt' &&
            String(instance.type.texture_file).toLowerCase()
                .indexOf('dialogfont.png') !== -1) {
            var scales = [targetScale, targetScale * 0.875,
                targetScale * 0.75];
            for (var i = 0; i < scales.length; i++) {
                instance.characterScale = scales[i];
                instance.text_changed = true;
                instance.rebuildText();
                if (instance.textHeight <= instance.height) break;
            }
        } else if (instance.characterScale !== targetScale) {
            instance.characterScale = targetScale;
            instance.text_changed = true;
        }
    }

    function setVisible(rt, uid, visible) {
        var instance = rt.getObjectByUID(uid);
        if (!instance) return;
        var opacity = visible ? 1 : 0;
        if (instance.visible !== visible || instance.opacity !== opacity) {
            instance.visible = visible;
            instance.opacity = opacity;
            rt.redraw = true;
        }
    }

    function hideInstance(rt, uid) {
        var instance = rt.getObjectByUID(uid);
        if (!instance) return;
        if (instance.visible) {
            instance.visible = false;
            rt.redraw = true;
        }
    }

    function copyEffectParams(source, target, rt) {
        if (!source || !target ||
            !source.effect_params || !target.effect_params) return;
        for (var i = 0; i < source.effect_params.length; i++) {
            if (!source.effect_params[i] || !target.effect_params[i])
                continue;
            for (var j = 0; j < source.effect_params[i].length; j++) {
                if (target.effect_params[i][j] !== source.effect_params[i][j]) {
                    target.effect_params[i][j] = source.effect_params[i][j];
                    rt.redraw = true;
                }
            }
        }
    }

    function showTranslatedLike(rt, originalUid, translatedUid) {
        var source = rt.getObjectByUID(originalUid);
        var target = rt.getObjectByUID(translatedUid);
        if (!target) return;
        var opacity = source && typeof source.opacity === 'number'
            ? source.opacity : 1;
        if (!target.visible || target.opacity !== opacity) {
            target.visible = true;
            target.opacity = opacity;
            rt.redraw = true;
        }
        copyEffectParams(source, target, rt);
        hideInstance(rt, originalUid);
    }

    function syncTranslatedList(rt, originals, translated, isPortuguese) {
        for (var i = 0; i < originals.length; i++) {
            if (isPortuguese) {
                showTranslatedLike(rt, originals[i], translated[i]);
            } else {
                setVisible(rt, originals[i], true);
                setVisible(rt, translated[i], false);
            }
        }
    }

    function syncPressAnyTranslation(rt, isPortuguese) {
        var originals = [317, 318, 319, 320, 321];
        var translated = [900320, 900321, 900322, 900323, 900324];
        for (var i = 0; i < originals.length; i++) {
            var source = rt.getObjectByUID(originals[i]);
            var target = rt.getObjectByUID(translated[i]);

            if (source) {
                source.visible = true;
                source.opacity = isPortuguese ? 0 : 1;
                rt.redraw = true;
            }

            if (!target) continue;
            if (isPortuguese) {
                target.visible = true;
                target.opacity = 1;
                copyEffectParams(source, target, rt);
            } else {
                target.visible = false;
                target.opacity = 0;
            }
            rt.redraw = true;
        }
    }

    function translatePreservingWhitespace(value, dictionary,
        normalizedDictionary) {
        if (typeof value !== 'string' || !value) return value;
        var trimmed = value.replace(/^\s+|\s+$/g, '');
        var translated = dictionary[trimmed];
        if (!translated && normalizedDictionary)
            translated = normalizedDictionary[normalizeTranslationKey(trimmed)];
        if (!translated) return value;
        var start = value.indexOf(trimmed);
        return value.slice(0, start) + translated +
            value.slice(start + trimmed.length);
    }

    function translateRuntimeText(value) {
        var translated;
        if (language !== 'pt') {
            translated = translatePreservingWhitespace(value,
                englishByUiPortuguese, englishByUiPortugueseNormalized);
            if (translated !== value) return translated;
            translated = translatePreservingWhitespace(value,
                englishByPortuguese, englishByPortugueseNormalized);
            if (translated !== value) return translated;
            return translatePreservingWhitespace(value,
                englishByDialoguePortuguese,
                englishByDialoguePortugueseNormalized);
        }

        translated = translatePreservingWhitespace(value, uiTranslations,
            uiTranslationsNormalized);
        if (translated !== value) return translated;
        translated = translatePreservingWhitespace(value, menuDescriptions,
            menuDescriptionsNormalized);
        if (translated !== value) return translated;
        return translatePreservingWhitespace(value, dialogueTranslations,
            dialogueTranslationsNormalized);
    }

    function alignOptionsCursor(rt, isPortuguese) {
        var cursor = rt.getObjectByUID(1931);
        if (!cursor || !cursor.instance_vars) return;
        var selected = Number(cursor.instance_vars[2]);
        if (selected < 0 || selected > 5) return;

        var originalUids = [1927, 1928, 1929, 1930, 356, 2723];
        var portugueseUids =
            [900020, 900021, 900022, 900023, 900024, 900025];
        var target = rt.getObjectByUID(
            (isPortuguese ? portugueseUids : originalUids)[selected]);
        if (!target) return;

        var targetX = target.x;
        var targetY = target.y + 1;
        if (!isPortuguese) {
            if (typeof target.update_bbox === 'function')
                target.update_bbox();
            if (target.bbox) {
                targetX = target.bbox.left;
                targetY = target.bbox.top + 1;
            }
        }
        if (cursor.x !== targetX || cursor.y !== targetY) {
            cursor.x = targetX;
            cursor.y = targetY;
            if (typeof cursor.set_bbox_changed === 'function')
                cursor.set_bbox_changed();
            rt.redraw = true;
        }
    }

    function applyKnownTextVisuals(rt) {
        var toPortuguese = language === 'pt';
        var dictionary = toPortuguese
            ? uiTranslations : englishByUiPortuguese;
        var types = rt.types_by_index;
        for (var i = 0; i < types.length; i++) {
            var instances = types[i] && types[i].instances;
            if (!instances) continue;
            for (var j = 0; j < instances.length; j++) {
                var instance = instances[j];
                if (!instance || typeof instance.text !== 'string') continue;
            var translated = translatePreservingWhitespace(
                    instance.text, dictionary,
                    toPortuguese ? uiTranslationsNormalized :
                        englishByUiPortugueseNormalized);
                if (translated !== instance.text)
                    setInstanceText(instance, translated);
                fitInstanceText(instance);
            }
        }
    }

    function applyMenuVisuals(rt) {
        if (!rt.running_layout) return;
        var isPortuguese = language === 'pt';
        var layout = rt.running_layout.name;
        var i;

        if (layout === 'Settings') {
            var settingsOriginal = [1935, 1936, 1937, 1938, 1940];
            var settingsPortuguese = [900010, 900011, 900012, 900013, 900014];
            syncTranslatedList(rt, settingsOriginal, settingsPortuguese,
                isPortuguese);
            syncTranslatedList(rt, [1934], [900031], isPortuguese);

            setInstanceText(rt.getObjectByUID(900002),
                isPortuguese ? 'IDIOMA' : 'LANGUAGE');

            var description = rt.getObjectByUID(1949);
            if (description) {
                if (isPortuguese &&
                    translateRuntimeText(description.text) !==
                    description.text) {
                    setInstanceText(description,
                        translateRuntimeText(description.text));
                } else if (!isPortuguese &&
                    translateRuntimeText(description.text) !==
                    description.text) {
                    setInstanceText(description,
                        translateRuntimeText(description.text));
                }
            }
        } else if (layout === 'Options') {
            var optionsOriginal = [1927, 1928, 1929, 1930, 356, 2723];
            var optionsPortuguese = [900020, 900021, 900022, 900023, 900024, 900025];
            syncTranslatedList(rt, optionsOriginal, optionsPortuguese,
                isPortuguese);
            syncTranslatedList(rt, [1926], [900030], isPortuguese);
            alignOptionsCursor(rt, isPortuguese);
        } else if (layout === 'Extra') {
            var extraOriginal = [1956, 1961, 1958, 1959, 1960, 2721];
            var extraPortuguese =
                [900110, 900111, 900112, 900113, 900114, 900115];
            syncTranslatedList(rt, extraOriginal, extraPortuguese,
                isPortuguese);
            setVisible(rt, 900120, false);
            setVisible(rt, 900121, false);

            var extraDescription = rt.getObjectByUID(1969);
            if (extraDescription) {
                if (isPortuguese &&
                    translateRuntimeText(extraDescription.text) !==
                    extraDescription.text) {
                    setInstanceText(extraDescription,
                        translateRuntimeText(extraDescription.text));
                } else if (!isPortuguese &&
                    translateRuntimeText(extraDescription.text) !==
                    extraDescription.text) {
                    setInstanceText(extraDescription,
                        translateRuntimeText(extraDescription.text));
                }
            }
        } else if (layout === 'Title Screen') {
            var titleOriginal = [358, 359, 360, 2039];
            var titlePortuguese = [900200, 900201, 900202, 900203];
            syncTranslatedList(rt, titleOriginal, titlePortuguese,
                isPortuguese);
        } else if (layout === 'Files Menu') {
            applyFileMenuTextureLanguage(rt, isPortuguese);
            setVisible(rt, 363, true);
            setVisible(rt, 900210, false);
        }

        var pauseOriginal = [2379, 2381, 2382, 2383];
        var pausePortuguese = [900300, 900301, 900302, 900303];
        if (rt.getObjectByUID(2379)) {
            syncTranslatedList(rt, pauseOriginal, pausePortuguese,
                isPortuguese);
            syncTranslatedList(rt, [2376], [900304], isPortuguese);

            syncPressAnyTranslation(rt, isPortuguese);

            syncArmorTranslation(rt, isPortuguese);
        }
    }

    function applyToRuntime() {
        var rt = typeof global.cr_getC2Runtime === 'function'
            ? global.cr_getC2Runtime() : null;
        if (!rt || !rt.types_by_index) return;

        applyMenuVisuals(rt);
        applyKnownTextVisuals(rt);
    }

    function setLanguage(value) {
        language = value === 'pt' ? 'pt' : 'en';
        try { global.localStorage.setItem(STORAGE_KEY, language); } catch (e) {}
        applyToRuntime();
        try {
            document.dispatchEvent(new CustomEvent('dxLanguageChanged', {
                detail: { language: language }
            }));
        } catch (e) {}
    }

    global.DXLocalization = {
        getLanguage: function () { return language; },
        setLanguage: setLanguage,
        toggle: function () { setLanguage(language === 'en' ? 'pt' : 'en'); },
        apply: applyToRuntime,
        translateDialogue: function (value) {
            if (language !== 'pt') return value;
            var translated = translatePreservingWhitespace(value,
                dialogueTranslations, dialogueTranslationsNormalized);
            if (translated !== value) return translated;

            var fallback = value;
            var keys = Object.keys(dialogueTranslations).sort(function (a, b) {
                return b.length - a.length;
            });
            for (var i = 0; i < keys.length; i++) {
                if (fallback.indexOf(keys[i]) !== -1)
                    fallback = fallback.split(keys[i])
                        .join(dialogueTranslations[keys[i]]);
            }
            if (fallback === value && /[A-Za-z]/.test(value)) {
                global.__dxMissingTranslations =
                    global.__dxMissingTranslations || {};
                if (!global.__dxMissingTranslations[value]) {
                    global.__dxMissingTranslations[value] = true;
                    if (global.console && global.console.warn)
                        global.console.warn(
                            '[PT-BR] Texto sem tradução:', value);
                }
            }
            return fallback;
        },
        translateUiText: function (value) {
            return translatePreservingWhitespace(value,
                language === 'pt' ? uiTranslations :
                    englishByUiPortuguese,
                language === 'pt' ? uiTranslationsNormalized :
                    englishByUiPortugueseNormalized);
        },
        translateRuntimeText: translateRuntimeText,
        prepareFontType: prepareFontType,
        extendCharacterSet: extendCharacterSet,
        applyAccentWidths: applyAccentWidths,
        fitInstanceText: fitInstanceText
    };
}(window));
