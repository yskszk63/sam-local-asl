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
    await reader.cancel();
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

async function main() {
  const fname = path.toFileUrl("xxx");

  const template = await parseAsCfn(Deno.stdin.readable);
  const stateMachines = filterStateMachine(template);
  const asl = await readAsl(fname, stateMachines[0]);
  console.log(JSON.stringify(asl, null, 2));
}

main().catch(console.error);
