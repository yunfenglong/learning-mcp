export interface GradeDefinition {
  readonly id: string;
  readonly value: number;
  readonly name: string;
  readonly abbreviation: string;
}

const fallback = new Map<number, GradeDefinition>([
  [-1, { id: "legacy-f", value: -1, name: "Fail", abbreviation: "F" }],
  [0, { id: "legacy-p", value: 0, name: "Pass", abbreviation: "P" }],
  [1, { id: "legacy-c", value: 1, name: "Credit", abbreviation: "C" }],
  [2, { id: "legacy-d", value: 2, name: "Distinction", abbreviation: "D" }],
  [3, { id: "legacy-hd", value: 3, name: "High Distinction", abbreviation: "HD" }],
]);

export function readGradeDefinitions(value: unknown): GradeDefinition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("grade_definitions must be an array");
  if (value.length === 0) throw new TypeError("grade_definitions must not be empty when present");
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new TypeError("grade definition must be an object");
    const data = item as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.value !== "number") throw new TypeError("Grade id must be a string and value must be a number");
    const name = data.name ?? data.label ?? fallback.get(data.value)?.name;
    if (typeof name !== "string" || typeof data.abbreviation !== "string") throw new TypeError("Grade name and abbreviation must be strings");
    return { id: data.id, value: data.value, name, abbreviation: data.abbreviation };
  });
}

export function gradeLabel(value: number | null, definitions: readonly GradeDefinition[]): string {
  if (value === null) return "-";
  const match = definitions.find((definition) => definition.value === value) ?? (definitions.length === 0 ? fallback.get(value) : undefined);
  return match ? `${match.abbreviation} (${match.name})` : String(value);
}
