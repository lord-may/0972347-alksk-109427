import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const H = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};
const E = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const L = "d/l.json";
const K = ["w", "l", "q", "tr", "n", "a", "s"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ent = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => {
    const l = c.toLowerCase();
    if (l[0] !== "#") return E[l] ?? m;
    return String.fromCodePoint(
      l[1] === "x" ? parseInt(l.slice(2), 16) : +l.slice(1),
    );
  });
const plain = (t) =>
  ent(
    t
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const num = (v) => (v === "" || v == null ? NaN : +v);

async function get(u, o = {}) {
  let e;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, {
        method: o.m ?? "GET",
        headers: {
          ...H,
          ...o.h,
          ...(o.b && { "content-type": "application/json; charset=utf-8" }),
        },
        body: o.b ? JSON.stringify(o.b) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return { t: (await r.text()).replace(/^\uFEFF/, ""), h: r.headers };
    } catch (x) {
      e = x;
      if (i < 2) await sleep(5000 * (i + 1));
    }
  }
  throw e;
}
const json = async (u, o) => JSON.parse((await get(u, o)).t);

const TZ = {};
const fmt = (z = "America/Toronto") =>
  (TZ[z] ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: z,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }));
const parts = (ms, z) =>
  Object.fromEntries(fmt(z).formatToParts(ms).map((x) => [x.type, +x.value]));
const off = (ms, z) => {
  const p = parts(ms, z);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(ms / 1000) * 1000
  );
};
const local = (z, y, mo, d, h, mi, s) => {
  const g = Date.UTC(y, mo, d, h, mi, s);
  return g - off(g - off(g, z), z);
};
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const MON = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

function when(v, z) {
  if (typeof v === "number") v = new Date(v < 1e11 ? v * 1000 : v);
  if (v instanceof Date) return iso(v.getTime());
  let s = String(v).trim();
  if (/^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)$/i.test(s))
    return iso(Date.parse(s.replace(/(\.\d{3})\d+/, "$1")));
  s = s.toLowerCase().replace(/([ap])\.m\./g, "$1m");
  const now = Date.now();
  const p = parts(now, z);
  let y, mo, d;
  let m = /(\d{4})-(\d\d)-(\d\d)/.exec(s);
  if (m) [y, mo, d] = [+m[1], m[2] - 1, +m[3]];
  else if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)))
    [y, mo, d] = [+m[3], m[1] - 1, +m[2]];
  else if ((m = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b(?:,?\s+(\d{4})\b)?/.exec(s)) && MON.includes(m[1]))
    [y, mo, d] = [m[3] ? +m[3] : undefined, MON.indexOf(m[1]), +m[2]];
  const t = [...s.matchAll(/(\d{1,2}):(\d\d)(?::(\d\d))?(?:\.\d+)?\s*(am|pm)?/g)].pop();
  if (!t && d == null) return undefined;
  let h = t ? +t[1] : 0;
  if (t?.[4] === "pm" && h < 12) h += 12;
  if (t?.[4] === "am" && h === 12) h = 0;
  const [mi, se] = t ? [+t[2], +(t[3] ?? 0)] : [0, 0];
  let r = local(z, y ?? p.year, mo ?? p.month - 1, d ?? p.day, h, mi, se);
  if (d == null && r > now + 3600e3) r -= 864e5;
  if (y == null && d != null && r > now + 864e5)
    r = local(z, p.year - 1, mo, d, h, mi, se);
  return iso(r);
}

function dur(v) {
  if (typeof v === "number") return Math.round(v);
  const s = String(v).toLowerCase().split(/\bto\b/)[0];
  let m = /^\s*(\d+):(\d\d)\s*$/.exec(s);
  if (m) return +m[1] * 60 + +m[2];
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(s);
  m = /(\d+)\s*m/.exec(s);
  if (!h && !m) return NaN;
  return Math.round((h ? +h[1] * 60 : 0) + (m ? +m[1] : 0));
}

function norm(z, id, o) {
  const r = { id };
  const x = { ...o.x };
  for (const [k, v] of Object.entries(o)) {
    if (k === "x" || v == null || v === "") continue;
    if (k === "w" || k === "l") {
      const n = dur(v);
      if (Number.isFinite(n)) r[k] = n;
      if (typeof v === "string" && /not currently available/i.test(v)) x.est = 1;
    } else if (k === "q" || k === "tr" || k === "n") {
      const n = Math.round(num(typeof v === "string" ? v.replace(/,/g, "") : v));
      if (Number.isFinite(n)) r[k] = n;
    } else if (k === "a") r.a = when(v, z);
    else if (k === "s")
      r.s = /clos|ferm/i.test(v)
        ? "closed"
        : /down|unavail/i.test(v)
          ? "down"
          : /open|ouvert/i.test(v)
            ? "open"
            : String(v).toLowerCase();
    else x[k] = v;
  }
  for (const k of Object.keys(x)) if (x[k] == null || x[k] === "") delete x[k];
  if (Object.keys(x).length) r.x = x;
  if (!["w", "l", "q", "tr", "n"].some((k) => k in r) && !r.s)
    throw new Error("parse");
  return r;
}
const hrs = (v) => (v == null ? undefined : +v * 60);

const PBI = "https://wabi-canada-central-api.analysis.windows.net";
const swap = (o, m) => {
  if (Array.isArray(o)) return o.map((x) => swap(x, m));
  if (o && typeof o === "object") {
    const r = {};
    for (const [a, b] of Object.entries(o))
      r[a] = a === "Source" && typeof b === "string" && m[b] ? m[b] : swap(b, m);
    return r;
  }
  return o;
};
const find = (o, k) => {
  if (!o || typeof o !== "object") return undefined;
  if (k in o) return o[k];
  for (const v of Object.values(o)) {
    const r = find(v, k);
    if (r !== undefined) return r;
  }
};
function pbq(q, fl) {
  q = structuredClone(q);
  const from = q.From;
  const where = [...(q.Where ?? [])];
  for (const f of fl) {
    if (!f.filter?.Where) continue;
    const m = {};
    for (const e of f.filter.From) {
      let x = from.find(
        (y) =>
          y.Entity === e.Entity &&
          y.Schema === e.Schema &&
          (y.Type ?? 0) === (e.Type ?? 0),
      );
      if (!x) {
        let n = e.Name;
        for (let i = 1; from.some((y) => y.Name === n); i++) n = e.Name + i;
        x = { ...e, Name: n };
        from.push(x);
      }
      m[e.Name] = x.Name;
    }
    where.push(...swap(f.filter.Where, m));
  }
  delete q.OrderBy;
  if (where.length) q.Where = where;
  const used = new Set(
    (JSON.stringify([q.Select, q.Where ?? []]).match(/"Source":"[^"]+"/g) ?? []).map(
      (x) => x.slice(10, -1),
    ),
  );
  q.From = from.filter((x) => used.has(x.Name));
  return q;
}
function pbv(t) {
  const ds = t?.result?.data?.dsr?.DS?.[0];
  const row = ds?.PH?.[0]?.DM0?.[0];
  if (!row) return undefined;
  const s = row.S?.[0];
  let v = row.M0 ?? row.G0 ?? row.C?.[0];
  if (s?.DN && typeof v === "number") v = ds.ValueDicts[s.DN][v];
  return v;
}
const pbt = (v) =>
  typeof v === "number" ? new Date(v).toISOString().slice(0, 19) : v;

const P = {
  o: async (s) => {
    const j = await json(s.u);
    return Object.entries(s.v).map(([id, k]) => {
      const x = j.sites.find((y) => y.siteId === k);
      if (!x) throw new Error("parse");
      return norm(s.z, id, {
        w: hrs(x.estimatedWaitTime),
        l: hrs(x.longestCurrentWaitTime),
        q: x.patientsWaiting,
        tr: x.patientsInTreatment,
        n: x.totalPatients,
        a: x.lastUpdate,
        s: x.isDown ? "down" : undefined,
        x: {
          dm: x.downtimeMessage,
          t: x.trend?.map((h) => Math.round(h * 60)),
        },
      });
    });
  },
  m: (s) =>
    Promise.all(
      Object.entries(s.v).map(async ([id, k]) => {
        const [o, t] = k.split("/");
        const j = await json(
          `${s.u}/GetWaitTime?organization=${o}&site=${t}&languageCode=en`,
        );
        const c = j.currentSixHourAverageWaitTime;
        return norm(s.z, id, {
          w: c?.averageMinutes,
          a: c?.asOf,
          s: j.currentlyOpen === false ? "closed" : undefined,
          x: {
            p: j.thirtyDayAverageWaitTime?.averageWaitValues?.map(
              (y) => y.averageWait,
            ),
          },
        });
      }),
    ),
  p: (s) =>
    Promise.all(
      Object.entries(s.v).map(async ([id, k]) => {
        const j = await json(`${s.u}/${k}`);
        return norm(s.z, id, {
          w: hrs(j.averageTimeToSeeDoctor),
          q: j.patientsWaitingToSeeDoctor,
          n: j.activePatients,
          a: j.lastUpdated,
          x: {
            p80: hrs(j.averageTimeToSeeDoctor80th),
            adm: j.activeNoBedAdmits,
            p: j.dataSets?.find((y) => y.name === "PIA_GEN")?.data?.map(
              (h) => Math.round(h * 60),
            ),
          },
        });
      }),
    ),
  f: async (s) => {
    const [mj, xr] = await Promise.all([json(`${s.u}/metrics.json`), get(`${s.u}/all_fnedwaittimes_fnlog.xml`)]);
    const lm = xr.h.get("last-modified");
    const recs = [...xr.t.matchAll(/<CCLREC name="REP\d+">([\s\S]*?)<\/CCLREC>/g)].map((m) => m[1]);
    const xv = (r, g, k) => {
      const b = new RegExp(`<${g}\\b[^>]*>([\\s\\S]*?)</${g}>`).exec(r)?.[1] ?? "";
      const m = new RegExp(`<${k}\\b[^>]*?(?:value="([^"]*)"\\s*/>|>(?:<!\\[CDATA\\[([^\\]]*)\\]\\]>)?</${k}>)`).exec(b);
      return m ? num(m[1] ?? m[2] ?? 0) : undefined;
    };
    return Object.entries(s.v).map(([id, k]) => {
      const r = recs.find((y) => new RegExp(`<TRACKGROUPDISP[^>]*><!\\[CDATA\\[ED ${k} `).test(y));
      if (!r) throw new Error("parse");
      const m = mj[k.toLowerCase()];
      const ed = xv(r, "EDVOL", "PATCNT") ?? 0;
      const wr = xv(r, "WAITROOM", "WAITROOMCNT") ?? 0;
      const q = m ? m.waiting_count : wr;
      return norm(s.z, id, {
        w: m ? m.mean : xv(r, "WAITROOM", "MEANWAIT"),
        l: m ? m.longest : xv(r, "WAITROOM", "LONGESTWAIT"),
        q,
        n: ed + wr,
        tr: ed + wr - q >= 0 ? ed + wr - q : undefined,
        a: m ? mj.timestamp : lm && new Date(lm),
        x: {
          ed,
          adm: xv(r, "PENDADMIT", "ADMITCNT"),
          los: xv(r, "LOS", "LOSMIN"),
          med: xv(r, "WAITROOM", "MEDIANWAIT"),
        },
      });
    });
  },
  e: async (s) => {
    const t = plain((await get(s.u)).t);
    const pick = (l) => {
      const o = {};
      for (const re of [l].flat()) {
        const m = new RegExp(re, "i").exec(t);
        if (!m) throw new Error("parse");
        Object.assign(o, m.groups);
      }
      return o;
    };
    const c = s.r ? pick(s.r) : {};
    return Object.entries(s.v).map(([id, l]) => norm(s.z, id, { ...c, ...pick(l) }));
  },
  s: async (s) => {
    const r = await get(s.u);
    const lm = r.h.get("last-modified");
    return Object.keys(s.v).map((id) =>
      norm(s.z, id, { l: r.t.trim(), a: lm && new Date(lm) }),
    );
  },
  u: async (s) => {
    const j = await json(`${s.u}?nocache=${Date.now()}`);
    return Object.keys(s.v).map((id) =>
      norm(s.z, id, { w: j.averageWaitTime, l: j.longestWaitTime, a: j.calculatedAt }),
    );
  },
  g: async (s) => {
    const j = await json(s.u);
    const x = j.reduce((a, b) => (b.timeStamp > a.timeStamp ? b : a));
    return Object.keys(s.v).map((id) =>
      norm(s.z, id, { w: x.aveWaitMin, l: x.longestWaitMin, a: x.timeStamp }),
    );
  },
  a: async (s) => {
    const j = await json(s.u);
    const m = new Map();
    for (const c of Object.values(j))
      for (const l of Object.values(c))
        for (const x of [l].flat()) {
          if (!x?.Name) continue;
          const sp = (k) => String(x[k] ?? "").split("[;]");
          sp("Name").forEach((n, i) =>
            m.set(n.trim(), { w: sp("WaitTime")[i], u: sp("TimesUnavailable")[i] }),
          );
        }
    return Object.entries(s.v).map(([id, k]) => {
      const x = m.get(k);
      if (!x) throw new Error("parse");
      const na = /true/i.test(x.u) || !Number.isFinite(dur(x.w));
      return norm(s.z, id, { w: na ? undefined : x.w, s: na ? "down" : undefined });
    });
  },
  j: async (s) => {
    const l = await json(s.u);
    return Object.entries(s.v).map(([id, k]) => {
      const x = l.find((y) => y.slug === k);
      if (!x) throw new Error("parse");
      const w = x.showWaitTimes ? x.waitTime : undefined;
      return norm(s.z, id, {
        w: w?.waitTimeMinutes,
        a: w?.createdAt,
        s: w?.waitTimeMinutes == null ? "down" : undefined,
        x: {
          elos: w?.elosMinutes,
          st: w?.status && w.status !== "normal" ? w.status : undefined,
        },
      });
    });
  },
  r: async (s) => {
    const t = (await get(s.u)).t;
    const m = new Map();
    for (const c of t.split(new RegExp(s.d))) {
      const k = new RegExp(s.k).exec(c)?.[1];
      if (!k) continue;
      const p = plain(c);
      const o = {};
      for (const re of [s.f].flat()) Object.assign(o, new RegExp(re).exec(p)?.groups);
      m.set(k, o);
    }
    return Object.entries(s.v).map(([id, k]) => {
      if (!m.has(k)) throw new Error("parse");
      return norm(s.z, id, m.get(k));
    });
  },
  n: async (s) => {
    const [l, c] = await Promise.all([json(s.u), json(s.c)]);
    const now = Date.now();
    return Object.entries(s.v).map(([id, k]) => {
      const x = l.find((y) => y.siteCode === k);
      const p = x?.predictions?.find((y) => y.predictionHour === 1);
      const cl = c.find(
        (y) =>
          y.siteCode === k &&
          Date.parse(when(y.tempClosureStart, s.z)) <= now &&
          now < Date.parse(when(y.tempClosureEnd, s.z)),
      );
      return norm(s.z, id, {
        w: hrs(p?.predictedWaitTime),
        a: p?.predictionTime,
        s: cl ? "closed" : "open",
        x: {
          lo: hrs(p?.predictedWaitTimeLower),
          hi: hrs(p?.predictedWaitTimeUpper),
          cu: cl ? when(cl.tempClosureEnd, s.z) : undefined,
        },
      });
    });
  },
  q: async (s) => {
    const r = await fetch(s.u, { headers: H, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const [h, ...rows] = new TextDecoder("latin1")
      .decode(await r.arrayBuffer())
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split(",").map((c) => c.replace(/"/g, "").trim()));
    const ix = (re) => h.findIndex((c) => re.test(c));
    const c = {
      p: ix(/^No_permis/),
      cf: ix(/civieres_fonctionnelles/),
      co: ix(/civieres_occupees/),
      h24: ix(/plus_de_24/),
      h48: ix(/plus_de_48/),
      n: ix(/presents/),
      q: ix(/attente_de_PEC/),
      dc: ix(/^DMS_sur_civiere$/),
      da: ix(/^DMS_ambulatoire$/),
      a: ix(/Mise_a_jour/),
    };
    if (Object.values(c).some((i) => i < 0)) throw new Error("parse");
    const m = new Map(rows.map((x) => [x[c.p], x]));
    const v = (x, k) => {
      const n = num(x[c[k]]);
      return Number.isFinite(n) ? n : undefined;
    };
    return Object.entries(s.v).map(([id, k]) => {
      const x = m.get(k);
      if (!x) throw new Error("parse");
      const ok = v(x, "n") != null;
      return norm(s.z, id, {
        w: hrs(v(x, "da")),
        n: v(x, "n"),
        q: v(x, "q"),
        a: x[c.a],
        s: ok ? undefined : "down",
        x: {
          cf: v(x, "cf"),
          co: v(x, "co"),
          h24: v(x, "h24"),
          h48: v(x, "h48"),
          dc: dur(hrs(v(x, "dc"))),
        },
      });
    });
  },
  b: async (s) => {
    const c = s.c ?? PBI;
    const h = { "X-PowerBI-ResourceKey": s.k };
    const j = await json(
      `${c}/public/reports/${s.k}/modelsAndExploration?preferReadOnlySession=true`,
      { h },
    );
    const rf = JSON.parse(j.exploration.filters ?? "[]");
    const vis = {};
    for (const sec of j.exploration.sections) {
      const sf = JSON.parse(sec.filters ?? "[]");
      for (const v of sec.visualContainers) {
        const g = JSON.parse(v.config);
        const sv = g.singleVisual;
        const q =
          sv?.prototypeQuery?.Select?.length === 1
            ? sv.prototypeQuery
            : find(sv?.objects?.values, "Subquery")?.Query;
        if (q && !vis[g.name])
          vis[g.name] = pbq(q, [...rf, ...sf, ...JSON.parse(v.filters ?? "[]")]);
      }
    }
    const want = [...new Set(Object.values(s.v).flatMap((f) => Object.values(f).flat()))];
    if (want.some((n) => !vis[n])) throw new Error("parse");
    const t = await json(`${c}/public/reports/querydata?synchronous=true`, {
      m: "POST",
      h,
      b: {
        version: "1.0.0",
        queries: want.map((n) => ({
          Query: {
            Commands: [
              {
                SemanticQueryDataShapeCommand: {
                  Query: vis[n],
                  Binding: { Primary: { Groupings: [{ Projections: [0] }] }, Version: 1 },
                },
              },
            ],
          },
          QueryId: "",
        })),
        cancelQueries: [],
        modelId: j.models[0].id,
      },
    });
    const job = new Map((t.results ?? []).map((r) => [r.jobId, r]));
    const got = Object.fromEntries(want.map((n, i) => [n, pbv(job.get(t.jobIds?.[i]))]));
    return Object.entries(s.v).map(([id, f]) => {
      const o = {};
      for (const [k, n] of Object.entries(f)) {
        const l = [n].flat().map((x) => got[x]);
        o[k] =
          k === "a"
            ? l.map(pbt).map((x, i) => (i === 0 && l.length > 1 ? String(x).slice(0, 10) : x)).join(" ")
            : l[0];
      }
      return norm(s.z, id, o);
    });
  },
};

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
const core = ({ x, ...r }) => stable(r);
const ids = (s) => Object.keys(s.v);
const why = (e) => {
  const m = String(e?.message ?? "");
  const c = e?.cause?.code ?? e?.cause?.name ?? "";
  return `fail ${e?.name ?? ""} ${/https?:|\/\/|\.[a-z]{2,}\//i.test(m) ? "" : m.slice(0, 80)} ${c}`
    .replace(/\s+/g, " ")
    .trim();
};
let S;
try {
  S = JSON.parse(process.env.S);
  if (!Array.isArray(S) || !S.length) throw 0;
} catch {
  console.log("S missing or invalid");
  process.exit(1);
}
const old = new Map();
try {
  for (const r of JSON.parse(await readFile(L, "utf8"))) old.set(r.id, r);
} catch {}

const R = await Promise.allSettled(S.map((s) => P[s.t](s)));
const out = [];
let bad = 0;
R.forEach((r, i) => {
  const s = S[i];
  if (r.status === "fulfilled") {
    out.push(...r.value);
    console.log(`${ids(s)[0]} ${r.value.length}`);
  } else {
    bad++;
    for (const id of ids(s)) if (old.has(id)) out.push(old.get(id));
    console.log(`${ids(s)[0]} ${why(r.reason)}`);
  }
});

out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
const now = new Date();
const t = now.toISOString().slice(0, 16) + "Z";
const csv = `d/h/${t.slice(0, 7)}.csv`;
const rows = out
  .filter((r) => !old.has(r.id) || core(old.get(r.id)) !== core(r))
  .map((r) => [t, r.id, ...K.map((k) => r[k] ?? "")].join(","));
await mkdir(dirname(csv), { recursive: true });
if (rows.length) {
  const head = await stat(csv).then(
    () => "",
    () => `t,id,${K.join(",")}\n`,
  );
  await appendFile(csv, head + rows.join("\n") + "\n");
}
await writeFile(`${L}.tmp`, `[\n${out.map(stable).join(",\n")}\n]\n`);
await rename(`${L}.tmp`, L);
console.log(`${out.length} ers, ${rows.length} rows`);
if (bad) process.exitCode = 1;
