const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const translationDir = path.join(workspace, 'Translation');
const submittedPath = path.join(
    translationDir, 'Story_PTBR', 'dialogues_pt-br.txt');
const canonicalPath = path.join(
    translationDir, 'Story_EN', 'dialogues_en.json');
const contextPath = path.join(
    translationDir, 'Story_EN', 'context_en.json');
const outputPath = path.join(workspace, 'GameFiles', 'ptbr-text.js');
const contextOutputPath = path.join(
    translationDir, 'Story_PTBR', 'context_pt-br.generated.json');

function parseSubmittedText(contents) {
    const entries = new Map();
    const pattern =
        /^\[([^\]]+)\][^\r\n]*\r?\n([\s\S]*?)^PT-BR:[ \t]*\r?\n([\s\S]*?)(?=^={72}[ \t]*$)/gm;
    let match;
    while ((match = pattern.exec(contents)) !== null) {
        entries.set(match[1], {
            english: match[2].trim(),
            portuguese: match[3].trim()
        });
    }
    return entries;
}

function toGameAlphabet(value) {
    return value
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...');
}

function commandTags(value) {
    return value.match(/<(?:C|TW)\b[^>]*>/g) || [];
}

function restoreLeadingColor(english, portuguese) {
    const color = english.match(/^\s*(<C\b[^>]*>)/);
    if (color && !/^\s*<C\b/.test(portuguese))
        return color[1] + portuguese;
    return portuguese;
}

const submitted = parseSubmittedText(
    fs.readFileSync(submittedPath, 'utf8').replace(/^\uFEFF/, ''));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));

const dialogues = {};
let restoredColors = 0;
const errors = [];

for (const entry of canonical.entries) {
    const translated = submitted.get(entry.id);
    if (!translated || !translated.portuguese) {
        errors.push(`Traducao ausente: ${entry.id}`);
        continue;
    }

    let portuguese = toGameAlphabet(translated.portuguese);
    const beforeColor = portuguese;
    portuguese = restoreLeadingColor(entry.english, portuguese);
    if (beforeColor !== portuguese) restoredColors++;

    const englishWaits = commandTags(entry.english)
        .filter(tag => /^<TW\b/.test(tag));
    const portugueseWaits = commandTags(portuguese)
        .filter(tag => /^<TW\b/.test(tag));
    if (JSON.stringify(englishWaits) !== JSON.stringify(portugueseWaits))
        errors.push(`Comandos TW divergentes: ${entry.id}`);

    if (Object.prototype.hasOwnProperty.call(dialogues, entry.english) &&
        dialogues[entry.english] !== portuguese) {
        errors.push(`Traducao conflitante: ${entry.id}`);
    }
    dialogues[entry.english] = portuguese;
}

const contextById = {
    story_6a4386ca66d8:
        'Este jogo usa um sistema de SALVAMENTO AUTOMÁTICO.\n\n' +
        'Não feche o jogo enquanto o ícone de SALVAMENTO AUTOMÁTICO estiver na tela.',
    story_1cda5b37d3df:
        'Os itens coletados não serão salvos até que o chefe da fase seja derrotado.\n\n' +
        'Coletar um item em uma fase já concluída ativará o SALVAMENTO AUTOMÁTICO.',
    story_1e5a0dee7dbc:
        'Você pode mapear suas armas no Analógico Direito do controle e nas teclas ' +
        'numéricas 1-8 pelo menu de pausa.\n\nPressionar o Analógico Direito ou 9 ' +
        'voltará para o X-Buster.',
    story_68e71eebb941:
        'Depois de concluir uma fase, segure CIMA ao selecioná-la para ir direto ' +
        'à sala do chefe.',
    story_e7f4fe0a4cd9:
        'Os eventos de história das fases serão repetidos ao visitá-las novamente.\n\n' +
        'É como reler o capítulo de um livro!',
    story_18039127933e:
        'As vidas extras serão reiniciadas sempre que você entrar em uma fase.\n\n' +
        'Você pode escolher a quantidade inicial no menu EXTRAS.',
    story_69beac10bc7f:
        'Os chefes reagem de formas diferentes a certas armas.\n\nAlgumas podem ' +
        'anular as habilidades deles, então teste combinações diferentes!',
    story_50160b7ff767:
        'Você pode equipar ou remover partes da armadura individualmente no menu de pausa.',
    story_8efeaef95a2b:
        'Este projeto é um fangame sem fins lucrativos e não é apoiado nem afiliado ' +
        'à CAPCOM.\n\nTodo o material de MegaMan/Rockman, incluindo jogos, personagens, ' +
        'imagens, nomes e músicas, pertence à\n©CAPCOM Co., Ltd.',
    story_115ef6d01640:
        'Este projeto é um fangame sem fins lucrativos,',
    story_399888a655aa:
        'O arquivo será sobrescrito. Continuar?',
    story_4f8e73119bf4:
        'Você obteve o X-Buster!'
};

const creditReplacements = [
    ['Staff :', 'Equipe:'],
    ['Director-Programmer-Writing:', 'Direcao-Programacao-Roteiro:'],
    ['Level Design:', 'Design de Fases:'],
    ['Additional Sprite Work:', 'Sprites Adicionais:'],
    ['Additional Music Work:', 'Musicas Adicionais:'],
    ['Testers:', 'Testadores:'],
    ['Mega Man Xtreme Original Staff :', 'Equipe Original de Mega Man Xtreme:'],
    ['Director:', 'Direcao:'],
    ['Planner:', 'Planejamento:'],
    ['Programmer:', 'Programacao:'],
    ['Background Designer:', 'Design de Cenarios:'],
    ['Character Designer:', 'Design de Personagens:'],
    ['Original Design:', 'Design Original:'],
    ['Sound:', 'Som:'],
    ['Bug Checker:', 'Revisao de Bugs:'],
    ['Special Thanks:', 'Agradecimentos Especiais:'],
    ['Producer:', 'Producao:'],
    ['Executive Producer:', 'Producao Executiva:'],
    ['Thank you for playing!', 'Obrigado por jogar!']
];

const ui = {};
for (const entry of context.entries) {
    let portuguese = contextById[entry.id] || '';
    if (entry.id === 'story_80f9d27d7f28') {
        portuguese = entry.english;
        for (const pair of creditReplacements)
            portuguese = portuguese.split(pair[0]).join(pair[1]);
    }
    if (portuguese)
        ui[entry.english] = toGameAlphabet(portuguese);
}
ui['Unsaved progress in this stage will be lost, continue?'] =
    'O progresso não salvo nesta fase será perdido. Continuar?';
ui['PRESS ANY'] = 'PRESSIONE';

if (submitted.size !== canonical.lineCount)
    errors.push(`Esperadas ${canonical.lineCount} entradas, recebidas ${submitted.size}`);
if (errors.length)
    throw new Error(errors.join('\n'));

const generated =
    '(function (global) {\n' +
    "    'use strict';\n" +
    '    global.DXPTBR = ' +
    JSON.stringify({ dialogues, ui }, null, 4) + ';\n' +
    '}(window));\n';
fs.writeFileSync(outputPath, generated, 'utf8');
fs.writeFileSync(contextOutputPath, JSON.stringify({
    source: 'Translation/Story_EN/context_en.json',
    translatedDisplayEntries: Object.keys(ui).length,
    translations: ui
}, null, 2) + '\n', 'utf8');

console.log(`DIALOGUE_LINES=${canonical.lineCount}`);
console.log(`DIALOGUE_KEYS=${Object.keys(dialogues).length}`);
console.log(`UI_KEYS=${Object.keys(ui).length}`);
console.log(`RESTORED_COLOR_TAGS=${restoredColors}`);
console.log(`OUTPUT=${outputPath}`);
console.log(`CONTEXT_OUTPUT=${contextOutputPath}`);
