import * as path from "https://deno.land/std@0.152.0/path/mod.ts";
import { yamlParse } from "https://esm.sh/yaml-cfn@0.3.1";
import { z } from "https://deno.land/x/zod@v3.18.0/mod.ts";

type RawResource = {
  Type: string;
  Properties?: unknown | undefined;
}

type CfnGetAtt = {
  "Fn::GetAtt": [string, string];
}

type CfnFunction = CfnGetAtt;

type CfnScalar<T> = T | CfnFunction;

type StateMachineResource = {
  Type: "AWS::Serverless::StateMachine";
  Properties: {
    DefinitionUri: string;
    DefinitionSubstitutions?: Record<string, CfnScalar<string>> | undefined;
  }
}

type FunctionResource = {
  Type: "AWS::Serverless::Function";
}

type ResolvedResource = StateMachineResource | FunctionResource;

type CfnSchema<T = ResolvedResource> = {
  Resources?: Record<string, T> | undefined;
}

const zRawResource: z.Schema<RawResource> = z.object({
  Type: z.string(),
  Properties: z.unknown().optional(),
});

const zCfnGetAtt: z.Schema<CfnGetAtt> = z.object({
  "Fn::GetAtt": z.tuple([z.string(), z.string()]),
});

const zCfnFunction: z.Schema<CfnFunction> = zCfnGetAtt;

function zCfnScalar<T extends z.Schema>(val: T): z.Schema<CfnScalar<z.infer<T>>> {
  return z.union([val, zCfnFunction]);
}

const zStateMachineResource: z.Schema<StateMachineResource> = z.object({
  Type: z.literal("AWS::Serverless::StateMachine"),
  Properties: z.object({
    DefinitionUri: z.string(),
    DefinitionSubstitutions: z.record(z.string(), zCfnScalar(z.string())),
  }),
});

const zFunctionResource: z.Schema<FunctionResource> = z.object({
  Type: z.literal("AWS::Serverless::Function"),
});

const zResolvedResource: z.Schema<ResolvedResource> = z.union([zStateMachineResource, zFunctionResource]);

const zRawCfnSchema: z.Schema<CfnSchema<RawResource>> = z.object({
  Resources: z.record(z.string(), zRawResource).optional(),
});

async function parseAsCfn(input: ReadableStream<Uint8Array>): Promise<CfnSchema> {
  const reader = input.getReader();
  try {
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: "text/plain" }));
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error(response.statusText);
      }

      const text = await response.text();
      const raw = zRawCfnSchema.parse(yamlParse(text));
      if (typeof raw.Resources === "undefined") {
        return {}
      }

      const filtered: Awaited<ReturnType<typeof parseAsCfn>> = {
        Resources: {
        },
      }
      for (const [k, v] of Object.entries(raw.Resources)) {
        const parsed = zResolvedResource.safeParse(v);
        if (!parsed.success) {
          continue;
        }
        filtered.Resources![k] = parsed.data;
      }
      return filtered;

    } finally {
      URL.revokeObjectURL(blobUrl);
    }

  } finally {
    reader.releaseLock();
  }
}

function filterStateMachine(schema: CfnSchema): StateMachineResource[] {
  return Object.entries(schema.Resources ?? []).flatMap(([_, v]) => v.Type === "AWS::Serverless::StateMachine" ? [v] : []);
}

async function readAsl(base: URL, stateMachine: StateMachineResource): Promise<unknown> {
  const uri = new URL(stateMachine.Properties.DefinitionUri, base);
  const asl = await Deno.readTextFile(uri);
  return JSON.parse(asl);
}

function expandString(val: string, stateMachine: StateMachineResource, template: CfnSchema): string {
  return val.replaceAll(/\$\{([^\}]*)\}/gm, (m, x) => {
    const sub = stateMachine.Properties.DefinitionSubstitutions;
    if (typeof sub === "undefined") {
      return m;
    }
    const val = sub[x];
    if (typeof val === "undefined") {
      return m;
    }
    if (typeof val === "string") {
      return val;
    }

    const [res, attr] = val["Fn::GetAtt"];
    if (attr !== "Arn") {
      return m;
    }
    const item = (template.Resources ?? {})[res];
    if (typeof item === "undefined") {
      return m;
    }

    const region = "us-east-1";
    const account = "123456789012";
    return `arn:aws:lambda:${region}:${account}:function:${x}`;
  });
}

function expand(asl: unknown, stateMachine: StateMachineResource, template: CfnSchema): unknown {
  if (typeof asl === "number" || typeof asl === "boolean" || asl === null) {
    return asl;
  }

  if (typeof asl === "string") {
    return expandString(asl, stateMachine, template); // TODO expand
  }

  if (Array.isArray(asl)) {
    const result = [];
    for (const item of asl) {
      result.push(expand(item, stateMachine, template));
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(asl as Record<any, unknown>)) {
    if (typeof key !== "string") {
      throw new Error();
    }
    result[key] = expand(val, stateMachine, template);
  }
  return result;
}

async function main() {
  const [fname] = Deno.args; // TODO stdin

  const base = path.toFileUrl(path.resolve(fname));

  let template;
  const fp = (await Deno.open(base)).readable;
  try {
    template = await parseAsCfn(fp);
  } finally {
    await fp.cancel();
  }
  const stateMachines = filterStateMachine(template);
  const asl = await readAsl(base, stateMachines[0]);
  const expanded = expand(asl, stateMachines[0], template);
  console.log(JSON.stringify(expanded, null, 2));
}

main().catch(console.error);
