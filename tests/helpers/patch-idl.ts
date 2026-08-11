/**
 * ENRG — хелпер совместимости IDL (Anchor 1.x) с JS-клиентом @coral-xyz/anchor 0.32.1.
 * Чинит IDL: подставляет type.fields из "types" по имени аккаунта и вычисляет
 * size (space) рекурсивно. Для динамических структур (vec/string) size=0 —
 * эти аккаунты в текущих тестах не создаются и не читаются по layout.
 */
const SIZE_OF = {
  u8:1, i8:1, bool:1, u16:2, i16:2, u32:4, i32:4,
  u64:8, i64:8, f64:8, publicKey:8, u128:16, i128:16,
} as Record<string, number>;

function sizeOfKind(kind: string): number | null {
  return SIZE_OF[kind] ?? null;
}

function computeSpace(fields: any[], defs: any[]): number | null {
  let total = 0;
  for (const f of fields) {
    if (!f || !f.type) return null;
    const t = f.type;
    if (typeof t === "string") {
      const s = sizeOfKind(t);
      if (s === null) return null;
      total += s; continue;
    }
    if (Array.isArray(t)) {
      const s = sizeOfKind(t[0] as string);
      if (s === null) return null;
      total += s * (t[1] as number); continue;
    }
    if (typeof t === "object") {
      const keys = Object.keys(t);
      if (keys.includes("vec")) return null;
      if (keys.includes("option")) {
        const s = typeof t.option === "string" ? sizeOfKind(t.option) : null;
        if (s === null) return null;
        total += 1 + s; continue;
      }
      if (keys.includes("array")) {
        const s = sizeOfKind(t.array[0] as string);
        if (s === null) return null;
        total += s * (t.array[1] as number); continue;
      }
      if (keys.includes("defined")) {
        const def = defs.find((x: any) => x.name === t.defined);
        if (!def || !def.type || !Array.isArray(def.type.fields)) return null;
        const n = computeSpace(def.type.fields, defs);
        if (n === null) return null;
        total += n; continue;
      }
      return null;
    }
    return null;
  }
  return total;
}

export function patchIdl(idl: any): any {
  if (!idl || !Array.isArray(idl.accounts) || !Array.isArray(idl.types)) return idl;
  const defs = idl.types as any[];
  const typeByName = new Map<string, any>();
  for (const t of defs) typeByName.set(t.name, t);

  for (const acc of idl.accounts) {
    const t = typeByName.get(acc.name);
    if (!t || !t.type || !Array.isArray(t.type.fields)) continue;
    acc.type = { kind: "struct", fields: t.type.fields };
    const fieldsSize = computeSpace(t.type.fields, defs);
    // Всегда число: точный space для статических, 0 для динамических.
    acc.size = fieldsSize !== null ? 8 + fieldsSize : 0;
  }
  return idl;
}

export default patchIdl;
