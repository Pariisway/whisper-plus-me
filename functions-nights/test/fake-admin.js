// Minimal in-memory stand-ins for firebase-admin (Firestore, Realtime Database, Messaging),
// good enough to run the Dates money logic end to end in tests.
const store = new Map();        // Firestore: path -> data
const rtdbStore = {};           // Realtime Database: nested object
// Same checks real FCM does, so a payload Google would reject fails the tests too.
function checkFcm(m) {
  for (const [k, v] of Object.entries(m.data || {})) {
    if (/^(from|notification|message_type)$/.test(k) || /^(google|gcm)/i.test(k)) throw new Error(`Invalid data payload key: ${k}`);
    if (typeof v !== "string") throw new Error(`Data value for ${k} must be a string`);
  }
}
const pushes = [];
const authState = {};

class Timestamp {
  constructor(m) { this._m = m; }
  static now() { return new Timestamp(Date.now()); }
  static fromMillis(m) { return new Timestamp(m); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toMillis() { return this._m; }
  toDate() { return new Date(this._m); }
}
const INC = Symbol("inc"), DEL = Symbol("del"), STS = Symbol("sts"), AU = Symbol("au"), AR = Symbol("ar");
const FieldValue = {
  increment: n => ({ [INC]: n }),
  delete: () => ({ [DEL]: true }),
  serverTimestamp: () => ({ [STS]: true }),
  arrayUnion: (...v) => ({ [AU]: v }),
  arrayRemove: (...v) => ({ [AR]: v })
};
const clone = v => (v instanceof Timestamp ? v : Array.isArray(v) ? v.map(clone) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);

function applyValue(cur, val) {
  if (val && typeof val === "object" && INC in val) return (Number(cur) || 0) + val[INC];
  if (val && typeof val === "object" && STS in val) return Timestamp.now();
  if (val && typeof val === "object" && AU in val) return [...new Set([...(Array.isArray(cur) ? cur : []), ...val[AU]])];
  if (val && typeof val === "object" && AR in val) return (Array.isArray(cur) ? cur : []).filter(x => !val[AR].includes(x));
  return clone(val);
}
function setPath(obj, path, val) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === "object" ? o[parts[i]] : {}; o = o[parts[i]]; }
  const k = parts.at(-1);
  if (val && typeof val === "object" && DEL in val) delete o[k];
  else o[k] = applyValue(o[k], val);
}
function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !(v instanceof Timestamp) && !Array.isArray(v) && !(INC in v) && !(DEL in v) && !(STS in v) && !(AU in v)) {
      target[k] = target[k] && typeof target[k] === "object" ? target[k] : {};
      merge(target[k], v);
    } else setPath(target, k, v);
  }
}

let autoId = 0;
class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").at(-1); }
  async get() { const d = store.get(this.path); return snap(this, d); }
  async set(data, opts) { writeSet(this.path, data, opts); }
  async update(data) { writeUpdate(this.path, data); }
  async delete() { store.delete(this.path); }
  collection(name) { return new ColRef(`${this.path}/${name}`); }
}
function snap(ref, d) { return { exists: d !== undefined, id: ref.id, ref, data: () => (d === undefined ? undefined : clone(d)) }; }
function writeSet(path, data, opts) {
  if (opts && opts.merge) { const cur = clone(store.get(path) || {}); merge(cur, data); store.set(path, cur); }
  else { const cur = {}; merge(cur, data); store.set(path, cur); }
}
function writeUpdate(path, data) {
  if (!store.has(path)) throw new Error("No document to update: " + path);
  const cur = clone(store.get(path));
  for (const [k, v] of Object.entries(data)) setPath(cur, k, v);
  store.set(path, cur);
}
const valOf = v => (v instanceof Timestamp ? v.toMillis() : v);
class Query {
  constructor(col, filters = [], lim = Infinity) { this.col = col; this.filters = filters; this.lim = lim; }
  where(f, op, v) { return new Query(this.col, [...this.filters, [f, op, v]], this.lim); }
  limit(n) { return new Query(this.col, this.filters, n); }
  orderBy() { return this; }
  async get() {
    const prefix = this.col + "/";
    const docs = [...store.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .filter(([, d]) => this.filters.every(([f, op, v]) => {
        const x = f.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
        if (op === "==") return valOf(x) === valOf(v);
        if (op === "<") return valOf(x) < valOf(v);
        if (op === ">=") return valOf(x) >= valOf(v);
        if (op === "array-contains") return Array.isArray(x) && x.includes(v);
        if (op === "in") return v.includes(valOf(x));
        throw new Error("op " + op);
      })).slice(0, this.lim).map(([p, d]) => snap(new DocRef(p), d));
    return { empty: !docs.length, size: docs.length, docs };
  }
}
class ColRef extends Query {
  constructor(path) { super(path); this.path = path; }
  doc(id) { return new DocRef(`${this.path}/${id || "auto" + (++autoId)}`); }
  async add(data) { const r = this.doc(); writeSet(r.path, data); return r; }
}
const firestore = {
  doc: p => new DocRef(p),
  collection: p => new ColRef(p),
  batch() { const ops = []; return { update: (r, d) => ops.push(() => writeUpdate(r.path, d)), set: (r, d, o) => ops.push(() => writeSet(r.path, d, o)), commit: async () => ops.forEach(f => f()) }; },
  async runTransaction(fn) {
    // Serialize transactions; apply writes only if fn succeeds.
    const writes = [];
    const tx = {
      get: r => r.get(),
      set: (r, d, o) => writes.push(() => writeSet(r.path, d, o)),
      update: (r, d) => writes.push(() => writeUpdate(r.path, d))
    };
    const res = await fn(tx);
    writes.forEach(w => w());
    return res;
  }
};

function rtGet(path) { return path.split("/").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), rtdbStore); }
function rtSet(path, v) { const parts = path.split("/").filter(Boolean); let o = rtdbStore; parts.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[parts.at(-1)] = v; }
const database = {
  ref: path => ({
    orderByChild: k => ({ equalTo: want => ({ once: async () => { const all = rtGet(path) || {}; const out = {}; Object.keys(all).forEach(id => { if (all[id] && all[id][k] === want) out[id] = clone(all[id]); }); return { val: () => out, exists: () => Object.keys(out).length > 0 }; } }), startAt: min => ({ once: async () => { const all = rtGet(path) || {}; const out = {}; Object.keys(all).forEach(id => { if (all[id] && Number(all[id][k]) >= min) out[id] = clone(all[id]); }); return { val: () => out, exists: () => Object.keys(out).length > 0 }; } }) }),
    once: async () => ({ val: () => clone(rtGet(path)), exists: () => rtGet(path) !== undefined }),
    set: async v => rtSet(path, v),
    transaction: async fn => { const nv = fn(clone(rtGet(path))); if (nv !== undefined) rtSet(path, nv); return { committed: nv !== undefined }; },
    update: async obj => Object.entries(obj).forEach(([k, v]) => {
      const full = [path || "", k].filter(Boolean).join("/");
      if (v === null) { const parts = full.split("/").filter(Boolean); const parent = rtGet(parts.slice(0, -1).join("/")); if (parent) delete parent[parts.at(-1)]; }
      else rtSet(full, v);
    })
  })
};

const firestoreFn = () => firestore;
firestoreFn.FieldValue = FieldValue;
firestoreFn.Timestamp = Timestamp;
module.exports = {
  initializeApp: () => {},
  firestore: firestoreFn,
  database: () => database,
  messaging: () => ({ send: async m => { checkFcm(m); pushes.push(m); } }),
  __checkFcm: m => checkFcm(m),
  auth: () => ({ updateUser: async (uid, o) => { authState[uid] = Object.assign(authState[uid] || {}, o); }, revokeRefreshTokens: async uid => { authState[uid] = Object.assign(authState[uid] || {}, { revoked: true }); }, getUser: async () => { throw new Error("no auth user"); } }),
  __auth: authState,
  __store: store, __rtdb: rtdbStore, __pushes: pushes, __Timestamp: Timestamp
};
