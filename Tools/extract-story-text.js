const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const dataPath = path.join(workspace, 'GameFiles', 'data.js');
const outputDir = path.join(workspace, 'Translation', 'Story_EN');
const raw = fs.readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, '');
const project = JSON.parse(raw).project;

const eventSheetNames = new Set([
    'Boss',
    'Weapon Get Events',
    'Boss Intro Events',
    'Dialog System',
    'Stage Specific',
    'Startup Events',
    'Cutscenes Events',
    'Auto Save Events',
    'Credits Events'
]);

const layoutNames = new Set([
    'Disclaimer',
    'Startup',
    'Title Screen',
    'Files Menu',
    'Dialog',
    'Stage Select',
    'Boss Intro',
    'Weapon Get'
]);

const speakerNames = new Set([
    'X', 'ZERO', 'VILE', 'SIGMA', 'SERGES', 'TECHNO', 'GEEMEL',
    'DR. LIGHT', 'DR. CAIN'
]);

function isStoryCandidate(value) {
    const text = value.trim();
    if (!text || !/[A-Za-z]/.test(text)) return false;
    if (speakerNames.has(text.toUpperCase())) return true;
    if (text.startsWith('{') || text.startsWith('[')) return false;
    if (/\.(png|jpg|jpeg|ogg|m4a|wav|json|xml|js)$/i.test(text)) return false;
    if (/^(Layout|DialogEnd|Spawn|RemoveTrigger|Boss|Player)\s*:/i.test(text))
        return false;
    if (/^(Player|Stage|Boss|Enemy|Main|Global|Dialog|Input)[A-Za-z _/-]*$/.test(text))
        return false;
    if (/^[A-Za-z0-9_]+$/.test(text) && !/[!?.,'"]/g.test(text)) return false;
    if (/[A-Za-z]+ \*[+-]?\d|[A-Za-z]+ [+-]\d/.test(text)) return false;
    if (/value o |duration |rgba\(|^<C #[0-9a-f]+>\s*Press Any/i.test(text))
        return false;
    return text.length >= 3 &&
        (/\s/.test(text) || /[!?.,'"]/.test(text));
}

const entriesByText = new Map();

function addText(text, section, dataLocation) {
    if (!isStoryCandidate(text)) return;
    const english = text.trim();
    let entry = entriesByText.get(english);
    if (!entry) {
        const hash = crypto.createHash('sha1').update(english).digest('hex').slice(0, 12);
        entry = {
            id: `story_${hash}`,
            section,
            english,
            portuguese: '',
            notes: '',
            references: []
        };
        entriesByText.set(english, entry);
    }
    if (!entry.references.includes(dataLocation))
        entry.references.push(dataLocation);
}

function walk(value, section, dataLocation) {
    if (typeof value === 'string') {
        addText(value, section, dataLocation);
    } else if (Array.isArray(value)) {
        value.forEach((child, index) =>
            walk(child, section, `${dataLocation}[${index}]`));
    } else if (value && typeof value === 'object') {
        Object.keys(value).forEach(key =>
            walk(value[key], section, `${dataLocation}.${key}`));
    }
}

project[6].forEach((sheet, index) => {
    if (eventSheetNames.has(sheet[0]))
        walk(sheet, `Event Sheet: ${sheet[0]}`, `project[6][${index}]`);
});

project[5].forEach((layout, index) => {
    if (layoutNames.has(layout[0]))
        walk(layout, `Layout: ${layout[0]}`, `project[5][${index}]`);
});

const entries = Array.from(entriesByText.values()).sort((a, b) =>
    a.section.localeCompare(b.section) ||
    a.references[0].localeCompare(b.references[0]) ||
    a.english.localeCompare(b.english));

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
    path.join(outputDir, 'context_en.json'),
    JSON.stringify({
        formatVersion: 1,
        source: 'GameFiles/data.js',
        generatedAt: new Date().toISOString(),
        entryCount: entries.length,
        entries
    }, null, 2) + '\n',
    'utf8'
);

function csv(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

const csvRows = [
    ['id', 'section', 'english', 'portuguese', 'notes'].map(csv).join(',')
];
entries.forEach(entry => {
    csvRows.push([
        entry.id,
        entry.section,
        entry.english,
        entry.portuguese,
        entry.notes
    ].map(csv).join(','));
});
fs.writeFileSync(
    path.join(outputDir, 'context_en.csv'),
    '\uFEFF' + csvRows.join('\r\n') + '\r\n',
    'utf8'
);

const textLines = [];
entries.forEach(entry => {
    textLines.push(`[${entry.id}] ${entry.section}`);
    textLines.push(entry.english);
    textLines.push('');
    textLines.push('PT-BR:');
    textLines.push('');
    textLines.push('='.repeat(72));
});
fs.writeFileSync(
    path.join(outputDir, 'context_en.txt'),
    textLines.join('\n') + '\n',
    'utf8'
);

console.log(`STORY_ENTRIES=${entries.length}`);
console.log(`OUTPUT=${outputDir}`);
