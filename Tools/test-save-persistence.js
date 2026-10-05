'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname,
    '../GameFiles/xbox-bridge-uwp.js'), 'utf8');
const persistence = source.slice(source.indexOf('    function saveState('),
    source.indexOf('    installPersistentSaveBridge();'));

function session() {
    const keys = new Map();
    const timers = new Map();
    const listeners = {};
    const messages = [];
    let nextTimer = 0;
    class Storage {
        get length() { return keys.size; }
        key(i) { return Array.from(keys.keys())[i]; }
        getItem(k) { return keys.has(k) ? keys.get(k) : null; }
        setItem(k, v) { keys.set(k, String(v)); }
        removeItem(k) { keys.delete(k); }
        clear() { keys.clear(); }
    }
    const document = {
        addEventListener(name, fn) { listeners[name] = fn; },
        dispatchEvent(e) { if (listeners[e.type]) listeners[e.type](e); }
    };
    const ctx = {
        Storage, localStorage: new Storage(), document,
        addEventListener() {}, _log() {},
        notifyUWP(message) { messages.push(JSON.parse(JSON.stringify(message))); },
        setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        CustomEvent: function (type, init) { this.type = type; this.detail = init.detail; }
    };
    ctx.global = ctx;
    vm.createContext(ctx);
    vm.runInContext(persistence + '\ninstallPersistentSaveBridge();', ctx);
    return {
        ctx, messages,
        restore(data) { document.dispatchEvent({ type: 'uwpStateLoaded', detail: data }); },
        tick() { const pending = Array.from(timers.values()); timers.clear(); pending.forEach(fn => fn()); }
    };
}

const first = session();
first.ctx.localStorage.setItem('dx_language', 'pt');
first.tick();
assert.equal(first.messages.filter(m => m.type === 'saveState').length, 0,
    'Must not overwrite disk before restoration');
first.restore(null);
first.ctx.localStorage.setItem('File0', '{"c2dictionary":true,"data":{"StagesCompleted":4}}');
first.ctx.localStorage.setItem('SETTINGS', '40;20;2');
first.tick();
const saved = first.messages.filter(m => m.type === 'saveState').pop().data;
assert(saved.localStorage.File0, 'Progress keys must trigger persistence');
const reopened = session();
reopened.restore(saved);
assert.equal(reopened.ctx.localStorage.getItem('File0'), saved.localStorage.File0);
assert.equal(reopened.ctx.localStorage.getItem('SETTINGS'), '40;20;2');
reopened.ctx.localStorage.removeItem('File0');
reopened.tick();
assert(!reopened.messages.filter(m => m.type === 'saveState').pop().data.localStorage.File0,
    'Explicit slot deletion must persist');
const broken = session();
broken.ctx.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
broken.restore(saved);
assert(!broken.ctx.__uwpSaveRestored, 'Failed restoration must not start the game');
assert.equal(broken.ctx.__uwpGetPersistentSave(), '');
reopened.ctx.localStorage.getItem = () => { throw new Error('Read failed'); };
assert.equal(reopened.ctx.__uwpGetPersistentSave(), '', 'Partial snapshots must not overwrite disk');
const index = fs.readFileSync(path.join(__dirname, '../GameFiles/index.html'), 'utf8');
assert(!/setTimeout\(startRuntime,/.test(index), 'Startup must await restoration');
console.log('PASS: progress, reopen, settings, deletion, startup gate, storage failures');
