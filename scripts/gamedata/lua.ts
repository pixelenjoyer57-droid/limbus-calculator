// Parser for the Lua table literals used by the wiki's data modules
// (`return { ["Name"] = { key = "value", n = 3 }, ... }`).

type LuaValue = string | number | boolean | null | LuaTable;
export interface LuaTable {
  [key: string]: LuaValue;
}

export function parseLuaTable(src: string): LuaTable {
  let i = 0;
  const s = src;
  const ws = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith("--[[", i)) {
        const e = s.indexOf("]]", i);
        i = e < 0 ? s.length : e + 2;
      } else if (s.startsWith("--", i)) {
        const e = s.indexOf("\n", i);
        i = e < 0 ? s.length : e + 1;
      } else break;
    }
  };
  const str = (): string => {
    const q = s[i++];
    let out = "";
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\\") {
        const n = s[i + 1];
        out += n === "n" ? "\n" : n === "t" ? "\t" : n;
        i += 2;
      } else out += s[i++];
    }
    i++;
    return out;
  };
  const longStr = (): string => {
    const m = /^\[(=*)\[/.exec(s.slice(i));
    const close = "]" + (m?.[1] ?? "") + "]";
    const start = i + (m?.[0].length ?? 2);
    const e = s.indexOf(close, start);
    i = e < 0 ? s.length : e + close.length;
    return s.slice(start, e < 0 ? s.length : e);
  };
  const value = (): LuaValue => {
    ws();
    const c = s[i];
    if (c === "{") return table();
    if (c === '"' || c === "'") return str();
    if (c === "[" && /^\[=*\[/.test(s.slice(i, i + 10))) return longStr();
    const m = /^(-?\d+(\.\d+)?|true|false|nil)/.exec(s.slice(i, i + 40));
    if (m) {
      i += m[0].length;
      if (m[0] === "true") return true;
      if (m[0] === "false") return false;
      if (m[0] === "nil") return null;
      return Number(m[0]);
    }
    // bare identifier / expression we do not understand: skip to separator
    const e = s.slice(i).search(/[,;}]/);
    i += e < 0 ? s.length - i : e;
    return null;
  };
  const table = (): LuaTable => {
    const t: LuaTable = {};
    let n = 1;
    i++; // {
    for (;;) {
      ws();
      if (s[i] === "}") {
        i++;
        return t;
      }
      let key: string | null = null;
      if (s[i] === "[" && !/^\[=*\[/.test(s.slice(i, i + 10))) {
        i++;
        const k = value();
        ws();
        i++; // ]
        ws();
        i++; // =
        key = String(k);
      } else {
        const m = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(i, i + 100));
        if (m) {
          key = m[1];
          i += m[0].length;
        }
      }
      const v = value();
      t[key ?? String(n++)] = v;
      ws();
      if (s[i] === "," || s[i] === ";") i++;
    }
  };
  const start = s.indexOf("{", s.indexOf("return") >= 0 ? s.indexOf("return") : 0);
  i = start;
  return table();
}

/** For modules written as `local p = {} p.A = {...} return p`. */
export function parseLuaModuleFields(src: string): Record<string, LuaTable> {
  const out: Record<string, LuaTable> = {};
  const re = /^p\.(\w+)\s*=\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = parseLuaTable("return " + src.slice(m.index + m[0].length - 1));
  return out;
}
