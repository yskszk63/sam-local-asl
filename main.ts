import {
  path,
} from "./deps.ts";

import { parse as cfnParse } from "./cfn.ts";
import type * as cfn from "./cfn.ts";

async function readAsCfn(input: ReadableStream<Uint8Array>): Promise<cfn.CfnSchema> {
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
      return cfnParse(text);

    } finally {
      URL.revokeObjectURL(blobUrl);
    }

  } finally {
    reader.releaseLock();
  }
}

function filterStateMachine(schema: cfn.CfnSchema): cfn.StateMachineResource[] {
  return Object.entries(schema.Resources ?? []).flatMap(([_, v]) => v.Type === "AWS::Serverless::StateMachine" ? [v] : []);
}

async function readAsl(base: URL, stateMachine: cfn.StateMachineResource): Promise<unknown> {
  const uri = new URL(stateMachine.Properties.DefinitionUri, base);
  const asl = await Deno.readTextFile(uri);
  return JSON.parse(asl);
}

function expandString(val: string, stateMachine: cfn.StateMachineResource, template: cfn.CfnSchema): string {
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

function expand(asl: unknown, stateMachine: cfn.StateMachineResource, template: cfn.CfnSchema): unknown {
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
    template = await readAsCfn(fp);
  } finally {
    await fp.cancel();
  }
  const stateMachines = filterStateMachine(template);
  const asl = await readAsl(base, stateMachines[0]);
  const expanded = expand(asl, stateMachines[0], template);
  console.log(JSON.stringify(expanded, null, 2));
}

main().catch(console.error);
