import {
  z,
  yamlParse,
} from "./deps.ts";

type RawResource = {
  Type: string;
  Properties?: unknown | undefined;
}

type CfnGetAtt = {
  "Fn::GetAtt": [string, string];
}

type CfnFunction = CfnGetAtt;

type CfnScalar<T> = T | CfnFunction;

export type StateMachineResource = {
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

export type CfnSchema<T = ResolvedResource> = {
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

export function parse(text: string): CfnSchema {
  const yaml = yamlParse(text);
  const parsed = zRawCfnSchema.parse(yaml);

  if (typeof parsed.Resources === "undefined") {
    return {}
  }

  const filtered: ReturnType<typeof parse> = {
    Resources: {
    },
  }
  for (const [k, v] of Object.entries(parsed.Resources)) {
    const parsed = zResolvedResource.safeParse(v);
    if (!parsed.success) {
      continue;
    }
    filtered.Resources![k] = parsed.data;
  }
  return filtered;
}
