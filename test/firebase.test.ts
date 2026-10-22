import { describe, it, expect } from "vitest";
import {
  buildWhere,
  fieldPath,
  fromFirestoreDocument,
  fromFirestoreValue,
  toFirestoreFields,
  toFirestoreValue,
  writesAllowed
} from "../src/social/firebase";

const ROOT = "projects/demo/databases/(default)/documents";

describe("toFirestoreValue", () => {
  it("types scalars", () => {
    expect(toFirestoreValue(null)).toEqual({ nullValue: null });
    expect(toFirestoreValue(true)).toEqual({ booleanValue: true });
    expect(toFirestoreValue(42)).toEqual({ integerValue: "42" });
    expect(toFirestoreValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(toFirestoreValue("x")).toEqual({ stringValue: "x" });
  });

  it("sends unsafe integers as doubles and refuses non-finite numbers", () => {
    expect(toFirestoreValue(2 ** 60)).toEqual({ doubleValue: 2 ** 60 });
    expect(() => toFirestoreValue(Number.NaN)).toThrow(/Unsupported number/);
  });

  it("nests arrays and maps", () => {
    expect(toFirestoreValue({ tags: ["a", 1], address: { city: "SP" } })).toEqual({
      mapValue: {
        fields: {
          tags: { arrayValue: { values: [{ stringValue: "a" }, { integerValue: "1" }] } },
          address: { mapValue: { fields: { city: { stringValue: "SP" } } } }
        }
      }
    });
  });

  it("understands the $timestamp and $ref escapes", () => {
    expect(toFirestoreValue({ $timestamp: "2026-01-02T03:04:05Z" })).toEqual({
      timestampValue: "2026-01-02T03:04:05.000Z"
    });
    expect(toFirestoreValue({ $ref: "users/alice" }, ROOT)).toEqual({
      referenceValue: `${ROOT}/users/alice`
    });
    expect(toFirestoreValue({ $ref: `${ROOT}/users/bob` })).toEqual({
      referenceValue: `${ROOT}/users/bob`
    });
    expect(() => toFirestoreValue({ $timestamp: "not a date" })).toThrow(/Invalid \$timestamp/);
  });

  it("treats an escape key next to other keys as a plain map", () => {
    expect(toFirestoreValue({ $ref: "x", other: 1 })).toHaveProperty("mapValue");
  });
});

describe("fromFirestoreValue", () => {
  it("round-trips through plain JSON", () => {
    const data = {
      name: "Alice",
      age: 30,
      score: 9.5,
      active: false,
      nothing: null,
      tags: ["a", "b"],
      address: { city: "SP" },
      createdAt: { $timestamp: "2026-01-02T03:04:05.000Z" },
      friend: { $ref: "users/bob" }
    };
    const fields = toFirestoreFields(data, ROOT);
    expect(fromFirestoreValue({ mapValue: { fields } })).toEqual(data);
  });

  it("keeps integers beyond 2^53 as strings", () => {
    expect(fromFirestoreValue({ integerValue: "9007199254740993" })).toBe("9007199254740993");
    expect(fromFirestoreValue({ integerValue: "7" })).toBe(7);
  });

  it("reads empty arrays and maps", () => {
    expect(fromFirestoreValue({ arrayValue: {} })).toEqual([]);
    expect(fromFirestoreValue({ mapValue: {} })).toEqual({});
  });

  it("flattens a document", () => {
    expect(
      fromFirestoreDocument({
        name: `${ROOT}/users/alice`,
        fields: { n: { integerValue: "1" } },
        updateTime: "t"
      })
    ).toEqual({ id: "alice", path: "users/alice", createTime: undefined, updateTime: "t", data: { n: 1 } });
  });
});

describe("fieldPath", () => {
  it("quotes segments that are not plain identifiers", () => {
    expect(fieldPath("address.city")).toBe("address.city");
    expect(fieldPath("meta.first-name")).toBe("meta.`first-name`");
    expect(fieldPath("a`b")).toBe("`a\\`b`");
  });
});

describe("buildWhere", () => {
  it("returns nothing without filters", () => {
    expect(buildWhere(undefined)).toBeUndefined();
    expect(buildWhere([])).toBeUndefined();
  });

  it("sends a single filter bare", () => {
    expect(buildWhere([{ field: "age", op: ">=", value: 18 }])).toEqual({
      fieldFilter: {
        field: { fieldPath: "age" },
        op: "GREATER_THAN_OR_EQUAL",
        value: { integerValue: "18" }
      }
    });
  });

  it("ANDs several filters", () => {
    const where = buildWhere([
      { field: "status", op: "in", value: ["a", "b"] },
      { field: "tags", op: "array-contains", value: "vip" }
    ]);
    expect(where).toEqual({
      compositeFilter: {
        op: "AND",
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: "status" },
              op: "IN",
              value: { arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] } }
            }
          },
          {
            fieldFilter: {
              field: { fieldPath: "tags" },
              op: "ARRAY_CONTAINS",
              value: { stringValue: "vip" }
            }
          }
        ]
      }
    });
  });

  it("maps every operator", () => {
    const ops = {
      "==": "EQUAL",
      "!=": "NOT_EQUAL",
      "<": "LESS_THAN",
      "<=": "LESS_THAN_OR_EQUAL",
      ">": "GREATER_THAN",
      ">=": "GREATER_THAN_OR_EQUAL",
      "array-contains": "ARRAY_CONTAINS"
    } as const;
    for (const [op, expected] of Object.entries(ops)) {
      const where = buildWhere([{ field: "f", op: op as keyof typeof ops, value: 1 }]) as {
        fieldFilter: { op: string };
      };
      expect(where.fieldFilter.op).toBe(expected);
    }
    for (const [op, expected] of [
      ["in", "IN"],
      ["not-in", "NOT_IN"],
      ["array-contains-any", "ARRAY_CONTAINS_ANY"]
    ] as const) {
      const where = buildWhere([{ field: "f", op, value: [1] }]) as { fieldFilter: { op: string } };
      expect(where.fieldFilter.op).toBe(expected);
    }
  });

  it("turns equality with null into a unary filter", () => {
    expect(buildWhere([{ field: "deletedAt", op: "==", value: null }])).toEqual({
      unaryFilter: { op: "IS_NULL", field: { fieldPath: "deletedAt" } }
    });
    expect(buildWhere([{ field: "deletedAt", op: "!=", value: null }])).toEqual({
      unaryFilter: { op: "IS_NOT_NULL", field: { fieldPath: "deletedAt" } }
    });
  });

  it("refuses list operators without an array", () => {
    expect(() => buildWhere([{ field: "f", op: "in", value: "x" }])).toThrow(/needs an array/);
  });

  it("resolves $ref values against the database root", () => {
    expect(buildWhere([{ field: "owner", op: "==", value: { $ref: "users/alice" } }], ROOT)).toEqual({
      fieldFilter: {
        field: { fieldPath: "owner" },
        op: "EQUAL",
        value: { referenceValue: `${ROOT}/users/alice` }
      }
    });
  });
});

describe("writesAllowed", () => {
  it('only opens on the exact string "true"', () => {
    expect(writesAllowed({} as Env)).toBe(false);
    expect(writesAllowed({ FIREBASE_ALLOW_WRITES: "1" } as Env)).toBe(false);
    expect(writesAllowed({ FIREBASE_ALLOW_WRITES: "true" } as Env)).toBe(true);
  });
});
