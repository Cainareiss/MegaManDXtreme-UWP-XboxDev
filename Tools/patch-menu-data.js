const fs = require('fs');
const path = require('path');

const dataPath = path.resolve(__dirname, '..', 'GameFiles', 'data.js');
const raw = fs.readFileSync(dataPath, 'utf8');
const hadBom = raw.charCodeAt(0) === 0xFEFF;
const root = JSON.parse(raw.replace(/^\uFEFF/, ''));
const project = root.project;

function findInstance(layout, uid) {
    let found = null;
    function walk(value) {
        if (found || !Array.isArray(value)) return;
        if (value.length >= 3 && Array.isArray(value[0]) && value[2] === uid) {
            found = value;
            return;
        }
        value.forEach(walk);
    }
    walk(layout);
    if (!found) throw new Error(`Instancia UID ${uid} nao encontrada`);
    return found;
}

function findInstanceList(layout, uid) {
    let found = null;
    function walk(value) {
        if (found || !Array.isArray(value)) return;
        const index = value.findIndex(child =>
            Array.isArray(child) && child.length >= 3 &&
            Array.isArray(child[0]) && child[2] === uid);
        if (index >= 0) {
            found = value;
            return;
        }
        value.forEach(walk);
    }
    walk(layout);
    if (!found) throw new Error(`Lista da instancia UID ${uid} nao encontrada`);
    return found;
}

const options = project[5].find(layout => layout[0] === 'Options');
const optionPtUids = [900020, 900021, 900022, 900023, 900024, 900025];
const optionY = [47, 67, 87, 107, 127, 147];
optionPtUids.forEach((uid, index) => {
    findInstance(options, uid)[0][1] = optionY[index];
});
findInstance(options, 900020)[5][3] = 'CONFIGURAÇÕES';
findInstance(options, 900025)[0][0] = 72;
findInstance(options, 900025)[0][3] = 96;
const optionInstances = findInstanceList(options, 1926);
for (const uid of [900030]) {
    const existing = optionInstances.findIndex(instance =>
        Array.isArray(instance) && instance[2] === uid);
    if (existing >= 0) optionInstances.splice(existing, 1);
}

const settings = project[5].find(layout => layout[0] === 'Settings');
findInstance(settings, 900011)[5][3] = 'MÚSICA';
const settingsInstances = findInstanceList(settings, 1934);
for (const uid of [900031]) {
    const existing = settingsInstances.findIndex(instance =>
        Array.isArray(instance) && instance[2] === uid);
    if (existing >= 0) settingsInstances.splice(existing, 1);
}

const extra = project[5].find(layout => layout[0] === 'Extra');
findInstance(extra, 1952)[0][4] = 128;
findInstance(extra, 2721)[0][1] = 124;

const extraInstances = findInstanceList(extra, 2721);
const backIndex = extraInstances.findIndex(instance =>
    Array.isArray(instance) && instance[2] === 2721);

const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:"\'?!-0123456789';
const fpsAnchor = [
    [24, 108, 0, 104, 9, 0, 0, 0, 0, 0, 0, 0, [[0.5]]],
    522,
    900100,
    [['Run game at 60 FPS (beta)'], [0]],
    [],
    [0, 'EXTRA', 5, 1]
];
const fpsLabel = [
    [24, 108, 0, 104, 8, 0, 0, 1, 0, 0, 0, 0, [[1]]],
    525,
    900101,
    [['Fps60Label']],
    [[]],
    [8, 8, charset + '()', '60 FPS (BETA)', 1, 0, 0, 0, 0, 0, 0, 0]
];
const fpsValue = [
    [184, 108, 0, 32, 8, 0, 0, 1, 0, 0, 0, 0, [[1]]],
    525,
    900102,
    [['Fps60Value']],
    [[]],
    [8, 8, charset, 'OFF', 1, 0, 2, 0, 0, 0, 0, 0]
];

const extraPtLabels = [
    [900110, 28, 112, 'ESTILO MUSICAL'],
    [900111, 44, 112, 'VIDAS INICIAIS'],
    [900112, 60, 144, 'PONTOS DE CONTROLE'],
    [900113, 76, 128, 'CHEFES COM 16 HP'],
    [900114, 92, 112, 'PULAR HISTÓRIA'],
    [900115, 124, 48, 'VOLTAR']
].map(item => [
    [24, item[1], 0, item[2], 8, 0, 0, 1, 0, 0, 0, 0, [[1]]],
    525,
    item[0],
    [[`Locale${item[0]}`]],
    [[]],
    [8, 8, charset, item[3], 1, 1, 0, 0, 0, 0, 0, 0]
]);

for (const uid of [
    900100, 900101, 900102,
    900110, 900111, 900112, 900113, 900114, 900115
]) {
    const existing = extraInstances.findIndex(instance =>
        Array.isArray(instance) && instance[2] === uid);
    if (existing >= 0) extraInstances.splice(existing, 1);
}
const refreshedBackIndex = extraInstances.findIndex(instance =>
    Array.isArray(instance) && instance[2] === 2721);
extraInstances.splice(refreshedBackIndex, 0, fpsAnchor);
extraInstances.push(fpsLabel, fpsValue, ...extraPtLabels);

function makeText(uid, x, y, width, text, initiallyHidden) {
    return [
        [x, y, 0, width, 8, 0, 0, 1, 0, 0, 0, 0, [[1]]],
        525,
        uid,
        [[`Locale${uid}`]],
        [[]],
        [8, 8, charset, text, 1, initiallyHidden ? 1 : 0,
            0, 0, 0, 0, 0, 0]
    ];
}

optionInstances.push(
    makeText(900030, 96, 20, 48, 'OPÇÕES', true));
settingsInstances.push(
    makeText(900031, 68, 7, 104, 'CONFIGURAÇÕES', true));

const title = project[5].find(layout => layout[0] === 'Title Screen');
const titleInstances = findInstanceList(title, 358);
for (const uid of [900200, 900201, 900202, 900203]) {
    const existing = titleInstances.findIndex(instance =>
        Array.isArray(instance) && instance[2] === uid);
    if (existing >= 0) titleInstances.splice(existing, 1);
}
titleInstances.push(
    makeText(900200, 84, 96, 72, 'NOVO JOGO', true),
    makeText(900201, 84, 112, 72, 'CONTINUAR', true),
    makeText(900202, 96, 128, 48, 'OPÇÕES', true),
    makeText(900203, 104, 144, 32, 'SAIR', true)
);

const files = project[5].find(layout => layout[0] === 'Files Menu');
const fileInstances = findInstanceList(files, 363);
const fileTitleIndex = fileInstances.findIndex(instance =>
    Array.isArray(instance) && instance[2] === 900210);
if (fileTitleIndex >= 0) fileInstances.splice(fileTitleIndex, 1);
fileInstances.push(makeText(900210, 40, 16, 64, 'ARQUIVOS', true));

const pausePtUids = [
    900300, 900301, 900302, 900303, 900304,
    900320, 900321, 900322, 900323, 900324,
    900330, 900331, 900332, 900333, 900334,
    900335, 900336, 900337, 900338
];
for (const layout of project[5]) {
    let hasPauseSettings = false;
    try {
        findInstance(layout, 2379);
        hasPauseSettings = true;
    } catch (e) {}
    if (!hasPauseSettings) continue;

    const instances = findInstanceList(layout, 2379);
    for (const uid of pausePtUids) {
        const existing = instances.findIndex(instance =>
            Array.isArray(instance) && instance[2] === uid);
        if (existing >= 0) instances.splice(existing, 1);
    }
    instances.push(
        makeText(900300, 744, 32, 56, 'EFEITOS', true),
        makeText(900301, 744, 48, 48, 'MÚSICA', true),
        makeText(900302, 744, 64, 48, 'ESCALA', true),
        makeText(900303, 744, 80, 80, 'TELA CHEIA', true),
        makeText(900304, 816, 12, 48, 'OPÇÕES', true),
        makeText(900320, 636, 28, 72, 'PRESSIONE', true),
        makeText(900321, 636, 44, 72, 'PRESSIONE', true),
        makeText(900322, 636, 60, 72, 'PRESSIONE', true),
        makeText(900323, 636, 76, 72, 'PRESSIONE', true),
        makeText(900324, 636, 92, 72, 'PRESSIONE', true),
        [
            [318, 0, 0, 140, 128, 0, 0, 0, 0, 0, 0, 0, []],
            146,
            900330,
            [],
            [],
            [0, 0]
        ],
        makeText(900331, 320, 4, 120, 'PARTE DA CABEÇA', true),
        makeText(900332, 320, 16, 128, 'CARREGA AS ARMAS', true),
        makeText(900333, 320, 34, 112, 'PARTE DO CORPO', true),
        makeText(900334, 320, 46, 120, 'AMPLIA O ESCUDO', true),
        makeText(900335, 320, 64, 112, 'PARTE DO BRAÇO', true),
        makeText(900336, 320, 76, 136, 'CARREGA ESPECIAIS', true),
        makeText(900337, 320, 94, 104, 'PARTE DOS PÉS', true),
        makeText(900338, 320, 106, 104, 'ESQUIVA NO AR', true)
    );
}

const menuType = project[3].find(type => type[0] === 't522');
const extraAnimation = menuType[7].find(animation => animation[0] === 'EXTRA');
if (extraAnimation[7].length === 5)
    extraAnimation[7].push(JSON.parse(JSON.stringify(extraAnimation[7][4])));
if (extraAnimation[7].length !== 6)
    throw new Error(`EXTRA deveria ter 6 frames, tem ${extraAnimation[7].length}`);

const extraEvents = project[6].find(sheet => sheet[0] === 'Extra Event');
let loopBoundsPatched = 0;
function patchLoopBounds(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 6 && value[0] === 20 && value[1] === 524 &&
        value[2] === 462 && Array.isArray(value[5])) {
        const params = value[5];
        const loopValue = JSON.stringify(params[0]);
        const upper = params[params.length - 1];
        if (loopValue.includes('LoopValue') && Array.isArray(upper) &&
            upper[0] === 0 && (upper[1] === 5 || upper[1] === 6)) {
            upper[1] = 6;
            loopBoundsPatched++;
        }
    }
    value.forEach(patchLoopBounds);
}
patchLoopBounds(extraEvents);
if (loopBoundsPatched !== 2)
    throw new Error(`Esperados 2 limites de cursor, encontrados ${loopBoundsPatched}`);

let exitPatched = false;
function patchExitEvent(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 7 && value[0] === 0 &&
        value[4] === 750528056939472 && Array.isArray(value[5])) {
        for (const condition of value[5]) {
            if (Array.isArray(condition) && condition[0] === 465 &&
                condition[1] === 79) {
                const serialized = JSON.stringify(condition);
                if (!serialized.includes('[0,5]') &&
                    !serialized.includes('[0,6]'))
                    throw new Error('Condicao EXIT inesperada');
                function replaceIndex(node) {
                    if (!Array.isArray(node)) return;
                    if (node.length === 2 && node[0] === 0 &&
                        (node[1] === 5 || node[1] === 6)) {
                        node[1] = 6;
                    } else {
                        node.forEach(replaceIndex);
                    }
                }
                replaceIndex(condition);
                exitPatched = true;
            }
        }
    }
    value.forEach(patchExitEvent);
}
patchExitEvent(extraEvents);
if (!exitPatched) throw new Error('Evento EXIT de Extras nao encontrado');

const output = JSON.stringify(root);
fs.writeFileSync(dataPath, (hadBom ? '\uFEFF' : '') + output, 'utf8');

console.log('OPTIONS_PT_Y=' + optionY.join(','));
console.log('EXTRA_CURSOR_MAX=6');
console.log('EXTRA_FPS_INDEX=5');
console.log('EXTRA_EXIT_INDEX=6');
