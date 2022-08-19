import { path } from "./deps.ts";

export class Options {
  static usage(exit = -1): never {
    const usage = `
usage: %prog TEMPLATE [TARGET]

args:
  TEMPLATE: Template path.
  TARGET: Target StateMachine. If only one, it can be omitted.
`.trim();
    console.error(usage);
    Deno.exit(exit);
  }

  static from(args: string[]): Options {
    const [template, target] = args;
    if (typeof template === "undefined") {
      Options.usage();
    }
    return new Options(path.toFileUrl(path.resolve(template)), target ?? null);
  }

  template: URL;

  target: string | null;

  constructor(template: URL, target: string | null) {
    this.template = template;
    this.target = target;
  }
}
