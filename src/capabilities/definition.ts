import { z } from "zod";
import type { Config } from "../config.ts";
import type { Adapters } from "../mcp/server.ts";
import type { Platform } from "../domain/units.ts";
import { resolveUnit } from "../domain/units.ts";
import { SuiteError } from "../errors.ts";
export interface ReadServices {
  config: Config;
  adapters: Adapters;
}
export interface ReadRegistrar {
  <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    manage?: boolean,
    meta?: Record<string, unknown>,
  ): void;
}
export interface ReadCapability<
  P extends Platform | undefined = Platform | undefined,
  O extends string = string,
  S extends z.ZodRawShape = z.ZodRawShape,
> {
  readonly name: string;
  readonly platform: P;
  readonly operation: O;
  readonly description: string;
  readonly input: z.ZodObject<S>;
  register(registrar: ReadRegistrar, services: ReadServices): void;
}
export function defineRead<
  S extends z.ZodRawShape,
  P extends Platform | undefined,
  O extends string,
>(
  name: string,
  description: string,
  schema: S,
  platform: P,
  operation: O,
  run: (
    args: z.infer<z.ZodObject<S>>,
    services: ReadServices,
  ) => Promise<unknown>,
  meta?: Record<string, unknown>,
): ReadCapability<P, O, S> {
  return {
    name,
    platform,
    operation,
    description,
    input: z.object(schema).strict(),
    register: (registrar, services) =>
      registrar(
        name,
        description,
        schema,
        (args) => run(args, services),
        false,
        meta,
      ),
  };
}
export type ReadInput = Record<string, unknown>;
export function invokeRead(
  services: ReadServices,
  platform: Platform,
  operation: string,
  args: ReadInput,
  scope: "course" | "courses" | "account" = "course",
) {
  const { config, adapters } = services;
  const selected =
    scope === "account"
      ? undefined
      : typeof args.unit === "string"
        ? resolveUnit(config.units, args.unit)
        : undefined;
  if (scope === "course" && !selected)
    throw new SuiteError("INVALID_INPUT", "Choose a linked course.");
  if (
    platform === "ed" &&
    operation === "file" &&
    (args.lesson_id === undefined) === (args.thread_id === undefined)
  )
    throw new SuiteError(
      "INVALID_INPUT",
      "Provide exactly one lesson_id or thread_id.",
    );
  if (
    platform === "ed" &&
    operation === "read_thread" &&
    (args.thread_id === undefined) === (args.number === undefined)
  )
    throw new SuiteError(
      "INVALID_INPUT",
      "Provide exactly one thread_id or course-local number.",
    );
  if (platform === "ed")
    return adapters.ed.read(operation, selected, {
      ...args,
      lessonId: args.lesson_id,
      threadId: args.thread_id,
      slideId: args.slide_id,
    });
  if (platform === "moodle")
    return adapters.moodle.read(
      operation,
      selected ?? (scope === "courses" ? config.units : undefined),
      args,
    );
  if (
    ["get_task", "task_file", "task_read"].includes(operation) &&
    (args.task_definition_id === undefined) === (args.task === undefined)
  )
    throw new SuiteError(
      "INVALID_INPUT",
      "Provide exactly one task_definition_id or task abbreviation.",
    );
  return adapters.ontrack.read(operation, selected, args);
}

export function definePlatformRead<
  S extends z.ZodRawShape,
  P extends Platform,
  O extends string,
>(
  name: string,
  description: string,
  schema: S,
  platform: P,
  operation: O,
  scope: "course" | "courses" | "account",
  meta?: Record<string, unknown>,
): ReadCapability<P, O, S> {
  return defineRead(
    name,
    description,
    schema,
    platform,
    operation,
    (args, services) => invokeRead(services, platform, operation, args, scope),
    meta,
  );
}
